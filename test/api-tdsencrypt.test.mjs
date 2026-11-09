import assert from 'assert'
import { createRequire } from 'module'
import wo from '../src/WOrmReladb.mjs'
import { startFakeTds, ENC, TDS, obfuscatePassword } from './tools/fakeTds.mjs'


//rulebook R21(td01, 2026-11-09): MSSQL連線預設加密; 伺服器於PRELOGIN不協商加密(回報不支援、不加密, 或省略ENCRYPTION選項)時, 連線須失敗, 不得靜默以明文送出登入封包(LOGIN7, 內含帳密)
//背景: tedious 20.3.7前(GHSA-wj7m-ffj3-574h)預設encrypt:true下若伺服器不協商加密, 驅動仍以明文送出LOGIN7; 20.3.7起改為報錯(EENCRYPT)
//本檔不需docker: 以假TDS伺服器(test/tools/fakeTds.mjs)只回應PRELOGIN, 以「伺服器是否收到LOGIN7(0x10)與編碼後之密碼位元組」判定是否以明文登入
//  R21-1 對照(偵測器非空轉): 驅動直連並顯式encrypt:false → 伺服器確會收到LOGIN7與密碼位元組(證明下列「沒收到」之綠非空轉; 亦是不加密連線須顯式退出之證明)
//  R21-2 驅動預設(不設encrypt): 伺服器不協商加密 → 連線失敗(EENCRYPT), 伺服器只收到PRELOGIN
//  R21-3 經本套件各連線函數(預設連線選項): 同上; 各函數皆reject(createStorage為既有之固定訊息), 伺服器只收到PRELOGIN, 無LOGIN7、無密碼位元組
//註: 本檔以createRequire載入tedious, 使修前對照(node --require 把tedious導向19.2.2)能生效; 本檔不寫入任何檔案


let require = createRequire(import.meta.url)
let tedious = require('tedious')

let USER = 'u1'
let PW = 'Zp9-td01-Pw' //獨特密碼, 供於收到之位元組中搜尋

let BEHAVIORS = [
    ['不支援加密(NOT_SUP)', ENC.NOT_SUP],
    ['不加密(OFF)', ENC.OFF],
    ['省略ENCRYPTION選項', null],
]


//withServer, 起假伺服器執行fn後關閉
let withServer = async (enc, fn) => {
    let s = await startFakeTds({ enc })
    try {
        return await fn(s)
    }
    finally {
        await s.close()
    }
}

//assertNoPlainLogin, 伺服器只收到PRELOGIN(0x12): 無LOGIN7、無編碼後與未編碼之密碼位元組
let assertNoPlainLogin = (seen, label) => {
    assert.strictEqual(seen.login7, false, `${label}: 伺服器不應收到LOGIN7(明文登入)`)
    assert.ok(seen.types.length >= 1 && seen.types.every((t) => t === TDS.PRELOGIN), `${label}: 伺服器只應收到PRELOGIN: ${JSON.stringify(seen.types)}`)
    assert.ok(!seen.bytes.includes(obfuscatePassword(PW)), `${label}: 不應收到編碼後之密碼位元組`)
    assert.ok(!seen.bytes.includes(Buffer.from(PW, 'utf16le')) && !seen.bytes.includes(Buffer.from(PW, 'utf8')), `${label}: 不應收到未編碼之密碼`)
}

//direct, 以驅動直連假伺服器, 回傳連線結果之錯誤(成功者null)
let direct = (port, options) => new Promise((resolve) => {
    let c = new tedious.Connection({
        server: '127.0.0.1',
        authentication: { type: 'default', options: { userName: USER, password: PW } },
        options: { port, database: 'worm', trustServerCertificate: true, connectTimeout: 10000, ...options },
    })
    c.on('error', () => {})
    c.connect((err) => {
        resolve(err ? { code: err.code, message: String(err.message) } : null)
        try {
            c.close()
        }
        catch (e) {} // eslint-disable-line no-empty
    })
})


describe('伺服器不協商加密時不得以明文登入(R21)', function() {

    describe('R21-1 對照: 驅動顯式關閉加密 → 伺服器會收到明文登入(偵測器有效)', function() {
        for (let [name, enc] of BEHAVIORS) {
            it(`${name}: 伺服器收到LOGIN7與編碼後之密碼位元組`, async function() {
                await withServer(enc, async (s) => {
                    //R21-8 encrypt:false: 對照案, 故意讓驅動接受不加密之連線, 以證明偵測器(LOGIN7與密碼位元組)確能抓到明文登入; 本套件之連線選項不外露此設定
                    await direct(s.port, { encrypt: false })
                    assert.deepStrictEqual(s.seen.types, [TDS.PRELOGIN, TDS.LOGIN7])
                    assert.strictEqual(s.seen.login7, true)
                    assert.ok(s.seen.bytes.includes(obfuscatePassword(PW)), '偵測器應能於LOGIN7中找到編碼後之密碼')
                })
            })
        }
    })

    describe('R21-2 驅動預設(不設encrypt): 伺服器不協商加密 → 連線失敗(EENCRYPT), 不送LOGIN7', function() {
        for (let [name, enc] of BEHAVIORS) {
            it(name, async function() {
                await withServer(enc, async (s) => {
                    let r = await direct(s.port, {})
                    assertNoPlainLogin(s.seen, 'tedious預設') //核心性質先判: 不得以明文送出登入封包
                    assert.ok(r !== null, '連線應失敗而非成功')
                    assert.strictEqual(r.code, 'EENCRYPT', JSON.stringify(r))
                })
            })
        }
    })

    describe('R21-3 經本套件各連線函數(預設連線選項): 皆失敗, 不送LOGIN7', function() {

        //各連線函數; 需連線者於第一個查詢時才連線(init()只建立sequelize, 不連線), createStorage之sync會連線, genTransaction於呼叫時取連線
        let callers = [
            ['select', (w) => w.select({})],
            ['selectByPk', (w) => w.selectByPk('td01a')],
            ['insert', (w) => w.insert({ id: 'td01a', name: 'x' })],
            ['insertBulk', (w) => w.insertBulk([{ id: 'td01a', name: 'x' }])],
            ['save', (w) => w.save([{ id: 'td01a', name: 'x' }])],
            ['del', (w) => w.del([{ id: 'td01a' }])],
            ['delAll', (w) => w.delAll({})],
            ['createStorage', (w) => w.createStorage()],
            ['genTransaction', async (w) => {
                let si = await w.init() //init不連線; genTransaction取連線時才連
                try {
                    return await w.genTransaction()
                }
                finally {
                    await si.close()
                }
            }],
            ['genModelsByDB', (w, port) => w.genModelsByDB({ dialect: 'mssql', host: '127.0.0.1', port, username: USER, password: PW })],
        ]

        //codeOf, 驅動錯誤碼(sequelize包裝後置於parent/original)
        let codeOf = (e) => (e && ((e.parent && e.parent.code) || (e.original && e.original.code) || e.code)) || null

        for (let [name, enc] of BEHAVIORS) {
            for (let [fn, call] of callers) {
                it(`${name} × ${fn}`, async function() {
                    await withServer(enc, async (s) => {
                        let w = wo({ url: `mssql://${USER}:${PW}@127.0.0.1:${s.port}`, db: 'worm', cl: 'users', fdModels: './models' })
                        let r = await call(w, s.port).then((v) => ({ ok: v }), (e) => ({ rej: e }))
                        assert.ok(s.seen.conns >= 1, `${fn}應有連線到假伺服器(否則未觸及連線路徑)`)
                        assertNoPlainLogin(s.seen, fn) //核心性質先判: 不得以明文送出登入封包
                        assert.ok('rej' in r, `${fn}應reject而非resolve: ${JSON.stringify(r)}`)
                        if (fn === 'createStorage') {
                            //既有之固定訊息(連線錯誤於model同步時被轉成此訊息, 見CLAUDE.md除錯要點), 驅動錯誤碼只在診斷輸出
                            assert.ok(/^can not import model: users/.test(String(r.rej)), String(r.rej))
                        }
                        else {
                            assert.strictEqual(codeOf(r.rej), 'EENCRYPT', `${fn}之錯誤應為驅動拒絕不加密之連線(EENCRYPT): ${String(r.rej && r.rej.message)}`)
                        }
                    })
                })
            }
        }

    })

})

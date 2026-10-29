import fs from 'fs'
import path from 'path'
import util from 'util'
import Module from 'module'
import assert from 'assert'
import Sequelize from 'sequelize'
import diagCases from 'wsemi/src/_diagCases.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
import wo from '../src/WOrmReladb.mjs'
import genModelsByTabs from '../src/genModelsByTabs.mjs'
import captureConsole from './tools/captureConsole.mjs'


//R-DIAG接線測試(dspec〈診斷輸出與遮罩〉、wsemi之R-DIAG-01; rulebook R17-8): 本套件之真實站點接上wsemi之getDiag, 僅以sqlite驗證(不動docker容器)
//  ①共用語料(wsemi/src/_diagCases.mjs)之wire案經本套件之站點重跑: 外來值由change訂閱函數拋出(emitChange之catch → 診斷細節)或由model檔之hook拋出(後端之外來值 → 整批reject與error事件)
//  ②整批reject之7站、逐筆err(save、del)、snap、closeSequelize、genTransaction、initSequelize之外來值經diag.err/diag.mask: 含憑證者為遮罩後之副本(instanceof同類), 無則原物件
//  ③本套件之固定詞彙(invalid find…、invalid data…、can not import model…、instance is closed…)原樣: 密碼恰為其子字串時亦不被切碎(語料R07)
//  ④宣告: codes、nested、types、paths(sqlite檔案路徑)、patterns(pragmaKey); genModelsByTabs之diag參數契約


let { cases, mkCtx, verify } = diagCases
let SEC = diagCases.secrets() //{ url, username: 'dbuser', password: 'Pw9xQ!z7', ... }

let dir = './test/_tmp/api-diaglog-wire'
let storage = `${dir}/wire.sqlite`
let dirModels = `${dir}/models`
let dirGen = `${dir}/gen`

let URL_ = `sqlite://${SEC.username}:${SEC.password}@:`


let getOpt = (ex = {}) => {
    return {
        url: URL_,
        db: 'worm',
        cl: 'users',
        fdModels: dirModels,
        storage,
        ...ex,
    }
}


//model檔: 各hook呼叫globalThis.__wormWire(hook名), 回傳非undefined者即由hook拋出(模擬後端或model檔拋出之外來值)
let MODEL = `module.exports = function(sequelize, DataTypes) {
    let fire = (name) => {
        let f = globalThis.__wormWire
        if (typeof f === 'function') {
            let v = f(name)
            if (v !== undefined) {
                throw v
            }
        }
    }
    return sequelize.define('users', {
        id: { type: DataTypes.STRING, primaryKey: true },
        name: { type: DataTypes.STRING },
    }, {
        tableName: 'users',
        timestamps: false,
        hooks: {
            beforeFind() { fire('find') },
            beforeCreate() { fire('create') },
            beforeBulkCreate() { fire('bulkCreate') },
            beforeBulkDestroy() { fire('destroy') },
        },
    })
}
`


//withHook, 於fn期間令指定hook拋出v
let withHook = async (hook, v, fn) => {
    globalThis.__wormWire = (name) => (name === hook ? v : undefined)
    try {
        return await fn()
    }
    finally {
        globalThis.__wormWire = undefined
    }
}


//settle, 取resolve值或reject值(原值, 不轉字串)
let settle = async (pm) => {
    try {
        return { ok: await pm }
    }
    catch (err) {
        return { err }
    }
}


//capRaw, 擷取console.log與console.error之原始引數(供語料之collect走訪)
let capRaw = async (fn) => {
    let rs = []
    let ol = console.log
    let oe = console.error
    console.log = (...args) => rs.push({ m: 'log', args })
    console.error = (...args) => rs.push({ m: 'error', args })
    try {
        await fn()
    }
    finally {
        console.log = ol
        console.error = oe
    }
    return rs
}


let seq = 0


//viaListener, 外來值v由change訂閱函數拋出(emitChange之catch站點) → funLog收到之(label, safe, detail)
let viaListener = async (v, ex = {}) => {
    let got = []
    let w = wo(getOpt({ funLog: (...a) => got.push(a), ...ex }))
    w.on('change', () => {
        throw v
    })
    let r = await w.insert({ id: `L${seq++}`, name: 'n' })
    assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
    let g = got.filter((x) => x[0] === 'change handler threw')
    assert.strictEqual(g.length, 1, JSON.stringify(got.map((x) => x[0])))
    return { safe: g[0][1], detail: g[0][2], n: g[0].length }
}


//viaHook, 外來值v由model檔之beforeFind拋出 → select之reject值與error事件之訊息
let viaHook = async (v, ex = {}) => {
    let evs = []
    let w = wo(getOpt(ex))
    w.on('error', (m, d, e) => evs.push([m, d, e]))
    let r = await withHook('find', v, () => settle(w.select({})))
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'err'), 'select應reject')
    assert.strictEqual(evs.length, 1)
    return { r: r.err, evs }
}


//class DbErr, 模擬驅動之錯誤類別
class DbErr extends Error {}


//mkSecretErr, 含憑證之外來錯誤(訊息、自有屬性sql與巢狀parent皆含密碼與帳號:密碼)
let mkSecretErr = (Cls = DbErr) => {
    let e = new Cls(`login failed for ${SEC.username}:${SEC.password} at db`)
    e.code = 'ELOGIN'
    e.sql = `PRAGMA key = '${SEC.username}:${SEC.password}'`
    e.parent = new Error(`pw ${SEC.password}`)
    return e
}


//noPw, 字串不含密碼與帳號:密碼
let noPw = (s, msg = '') => {
    for (let x of [SEC.password, `${SEC.username}:${SEC.password}`]) {
        assert.ok(String(s).indexOf(x) < 0, `${msg}含憑證[${x}]: ${String(s).slice(0, 300)}`)
    }
}


//WIRE_APPLIED, 經本套件站點重跑之語料案; WIRE_NA, 不適用(理由)
let WIRE_APPLIED = ['T01', 'T07', 'K01', 'K09', 'V02', 'E01', 'E07', 'P01', 'S07', 'C01', 'R01', 'R04', 'R07', 'R11', 'R12', 'O01', 'A07']
let WIRE_NA = {
    R02: '需以畸形網址(帳密含未編碼之@與/)為秘密來源; 本套件之opt.url為此形時建構即拋出(invalid port), 無從以其為秘密建立實例',
    O15: 'safe之鍵皆為本套件固定之stmt、mode、cl、name、type與errType、errCode, 無呼叫端可控之鍵(原始碼盤點鎖定於unit-diaglog)',
    A01: 'genDiagFunLog自身不讀第3引數之行為; 經本套件之路徑即A07接線(getDetail不被呼叫, 細節不產生)',
}


describe('diaglog wire(R-DIAG接線)', function() {

    before(async function() {
        fs.mkdirSync(dirModels, { recursive: true })
        fs.writeFileSync(`${dirModels}/users.js`, MODEL, 'utf8')
        if (fs.existsSync(storage)) {
            fs.unlinkSync(storage)
        }
        await wo(getOpt()).createStorage()
    })

    after(function() {
        globalThis.__wormWire = undefined
        fs.rmSync(dir, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅在空資料夾時移除
        }
        catch (err) {}
    })


    describe('共用語料之wire案', function() {

        it('語料之wire案皆已分類(適用或不適用附理由): 語料新增wire案時此處失敗而須歸類', function() {
            let ids = cases.filter((c) => c.wire === true).map((c) => c.id).sort()
            assert.deepStrictEqual([...WIRE_APPLIED, ...Object.keys(WIRE_NA)].sort(), ids)
        })

        for (let id of ['T01', 'T07', 'K01', 'K09', 'V02', 'E01', 'E07', 'P01', 'S07']) {
            it(`${id} 外來值由change訂閱函數拋出 → funLog之detail符合語料期望(遮罩、不執行使用端程式)`, async function() {
                let c = cases.find((x) => x.id === id)
                let ctx = mkCtx({ util: true, isNativeError: util.types.isNativeError })
                let { detail, n } = await viaListener(c.make(ctx))
                assert.strictEqual(n, 3, 'funLog應收到detail')
                assert.strictEqual(verify(c, detail, ctx), null)
            })
        }

        it('C01 錯誤代碼ECONNREFUSED、EAI_AGAIN、E2BIG經change訂閱函數拋出 → safe之errCode照列', async function() {
            let c = cases.find((x) => x.id === 'C01')
            let ctx = mkCtx({ util: true })
            let out = []
            for (let e of c.make(ctx)) {
                let { safe } = await viaListener(e)
                assert.strictEqual(safe.mode, 'insert')
                out.push({ errType: safe.errType, errCode: safe.errCode })
            }
            assert.strictEqual(verify(c, out, ctx), null)
        })

        it('R01 不含憑證之外來錯誤由hook拋出 → select之reject為同一物件, error事件為其訊息', async function() {
            let c = cases.find((x) => x.id === 'R01')
            let ctx = mkCtx({ util: true })
            let e = c.make(ctx)
            let { r, evs } = await viaHook(e)
            assert.strictEqual(verify(c, [e, r], ctx), null)
            assert.deepStrictEqual(evs, [['select', null, 'timeout']])
        })

        it('R04 含密碼之字串由hook拋出 → select之reject為遮罩後字串, error事件同', async function() {
            let c = cases.find((x) => x.id === 'R04')
            let ctx = mkCtx({ util: true })
            let { r, evs } = await viaHook(c.make(ctx))
            assert.strictEqual(verify(c, r, ctx), null)
            assert.deepStrictEqual(evs, [['select', null, 'failed ***']])
        })

        it('R11 錯誤自帶path為儲存路徑: reject(hook)為同一物件(不遮路徑, Q3), detail(change訂閱函數)遮之', async function() {
            let c = cases.find((x) => x.id === 'R11')
            let ctx = mkCtx({ util: true })
            let e = c.make(ctx)
            let { r } = await viaHook(e)
            let { detail } = await viaListener(e)
            assert.strictEqual(verify(c, { p: e.path, e, r, c: detail }, ctx), null)
        })

        it('R12 單獨帳號出現於後端訊息: reject(hook)為同一物件(不遮), detail(change訂閱函數)遮之', async function() {
            let c = cases.find((x) => x.id === 'R12')
            let ctx = mkCtx({ util: true })
            let e = c.make(ctx)
            let { r } = await viaHook(e)
            let { detail } = await viaListener(e)
            assert.strictEqual(verify(c, { e, r, c: detail }, ctx), null)
        })

        it('O01 logDetail:true且無funLog: console.log(固定標籤, 遮罩後之錯誤副本)一次, 不含detail類秘密', async function() {
            let c = cases.find((x) => x.id === 'O01')
            let ctx = mkCtx({ util: true })
            let { detail } = c.make(ctx)
            let w = wo(getOpt({ logDetail: true }))
            w.on('change', () => {
                throw detail
            })
            let rs = await capRaw(() => w.insert({ id: `O${seq++}`, name: 'n' }))
            assert.ok(rs.length === 1 && rs[0].m === 'log' && rs[0].args[0] === 'change handler threw' && rs[0].args[1] instanceof Error, JSON.stringify(rs.map((v) => [v.m, v.args[0]])))
            assert.strictEqual(verify({ expect: { noSecret: 'detail' } }, rs, ctx), null)
        })

        it('A07 opt.funLog為genDiagFunLog所產生者: 只寫{ event, label, safe }, 細節不產生(不含秘密)', async function() {
            let ctx = mkCtx({ util: true })
            let rs = []
            let { funLog } = genDiagFunLog((o) => rs.push(o))
            let w = wo(getOpt({ funLog }))
            w.on('change', () => {
                throw new Error(`auth ${SEC.password} for ${SEC.username}`)
            })
            await w.insert({ id: `A${seq++}`, name: 'n' })
            assert.deepStrictEqual(rs, [{ event: 'orm-diag', label: 'change handler threw', safe: { mode: 'insert', errType: 'Error' } }])
            assert.strictEqual(verify({ expect: { noSecret: 'detail' } }, rs, ctx), null)
        })

    })


    describe('整批reject、逐筆err與其他外來值站點(diag.err、diag.mask)', function() {

        //batch, 各函數之整批reject: hook拋出含憑證之ConnectionError(sequelize之連線層錯誤, save與del亦視為整批性錯誤)
        let batch = [
            ['select', 'find', (w) => w.select({})],
            ['selectByPk', 'find', (w) => w.selectByPk('k1')],
            ['insert', 'create', (w) => w.insert({ id: 'b1', name: `n ${SEC.password}` })],
            ['insertBulk', 'bulkCreate', (w) => w.insertBulk([{ id: 'b2', name: 'n' }])],
            ['save', 'find', (w) => w.save({ id: 'b3', name: 'n' })],
            ['del', 'destroy', (w) => w.del({ id: 'b4' })],
            ['delAll', 'destroy', (w) => w.delAll({})],
        ]
        for (let [mode, hook, fn] of batch) {
            it(`${mode} 外來錯誤含憑證 → reject為遮罩後之副本(instanceof同類、code與巢狀保留), error事件之訊息同源`, async function() {
                let e = mkSecretErr(DbErr)
                let ce = new Sequelize.ConnectionError(e)
                let evs = []
                let w = wo(getOpt())
                w.on('error', (m, d, msg) => evs.push([m, d, msg]))
                let r = await withHook(hook, ce, () => settle(fn(w)))
                let x = r.err
                assert.ok(x !== undefined, `${mode}應reject`)
                assert.notStrictEqual(x, ce, '含憑證者須為副本')
                assert.ok(x instanceof Sequelize.ConnectionError && x instanceof Error, '副本須instanceof同類')
                assert.strictEqual(x.name, 'SequelizeConnectionError')
                assert.ok(x.message.indexOf('login failed for ***') === 0, x.message)
                noPw(x.message, 'message ')
                noPw(x.stack, 'stack ')
                noPw(util.inspect(x, { depth: 6, showHidden: true }), 'inspect ')
                assert.ok(x.parent instanceof DbErr && x.parent.code === 'ELOGIN', '巢狀錯誤保留')
                assert.ok(x.parent.sql.indexOf('PRAGMA key = ') === 0 && x.parent.sql.indexOf('***') >= 0)
                assert.ok(ce.message.indexOf(SEC.password) >= 0, '不得改動原物件')
                assert.strictEqual(evs.length, 1)
                assert.strictEqual(evs[0][0], mode)
                assert.strictEqual(evs[0][2], x.message, 'error事件之訊息須與reject同源')
                if (mode === 'insert') {
                    assert.deepStrictEqual(evs[0][1], [{ id: 'b1', name: `n ${SEC.password}` }], 'error事件之data為呼叫端之輸入(回傳契約, 不遮罩)')
                }
            })
        }

        it('save逐筆err: findOne之外來錯誤含憑證 → 該筆ok為0且err為遮罩後之訊息, error事件同源; 整批resolve', async function() {
            let evs = []
            let w = wo(getOpt())
            w.on('error', (m, d, msg) => evs.push([m, d, msg]))
            let r = await withHook('find', mkSecretErr(), () => settle(w.save([{ id: 's1', name: 'n' }])))
            assert.deepStrictEqual(r.ok, [{ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'login failed for *** at db' }])
            assert.deepStrictEqual(evs, [['save', [{ id: 's1', name: 'n' }], 'login failed for *** at db']])
        })

        it('del逐筆err: destroy之外來錯誤含憑證 → 該筆ok為0且err為遮罩後之訊息, error事件同源; 整批resolve', async function() {
            let evs = []
            let w = wo(getOpt())
            w.on('error', (m, d, msg) => evs.push([m, d, msg]))
            let r = await withHook('destroy', `driver says ${SEC.password}`, () => settle(w.del([{ id: 'd1' }])))
            assert.deepStrictEqual(r.ok, [{ n: 1, nDeleted: 0, ok: 0, err: 'driver says ***' }])
            assert.deepStrictEqual(evs, [['del', [{ id: 'd1' }], 'driver says ***']])
        })

        it('逐筆err之外來錯誤不含憑證者原文照列(只遮憑證: 單獨帳號與sqlite檔案路徑不遮, Q3)', async function() {
            let w = wo(getOpt())
            let msg = `row is locked by ${SEC.username} in ${storage}`
            let r = await withHook('find', new DbErr(msg), () => settle(w.save([{ id: 's2', name: 'n' }])))
            assert.strictEqual(r.ok[0].err, msg)
        })

        it('snap: 呼叫端數據之getter拋出含憑證之錯誤 → insert之reject為遮罩後之副本', async function() {
            let w = wo(getOpt())
            let data = {
                id: 'g1',
                get name() {
                    throw new DbErr(`getter ${SEC.password}`)
                },
            }
            let r = await settle(w.insert(data))
            assert.ok(r.err instanceof DbErr && r.err.message === 'getter ***', String(r.err && r.err.message))
        })

        it('closeSequelize: 驅動之關閉錯誤含憑證 → select(finally關閉)之reject為遮罩後之副本', async function() {
            let old = Sequelize.prototype.close
            Sequelize.prototype.close = async function(...a) {
                await old.apply(this, a)
                throw new DbErr(`close ${SEC.password}`)
            }
            try {
                let r = await settle(wo(getOpt()).select({}))
                assert.ok(r.err instanceof DbErr && r.err.message === 'close ***', String(r.err && r.err.message))
            }
            finally {
                Sequelize.prototype.close = old
            }
        })

        it('genTransaction: 開啟交易之外來錯誤含憑證 → reject為遮罩後之副本; 未init者為固定詞彙invalid sequelize', async function() {
            let w = wo(getOpt())
            assert.deepStrictEqual(await settle(w.genTransaction()), { err: 'invalid sequelize' })
            let si = await w.init()
            let old = Sequelize.prototype.transaction
            Sequelize.prototype.transaction = function() {
                return Promise.reject(new DbErr(`tx ${SEC.username}:${SEC.password}`))
            }
            try {
                let r = await settle(w.genTransaction())
                assert.ok(r.err instanceof DbErr && r.err.message === 'tx ***', String(r.err && r.err.message))
            }
            finally {
                Sequelize.prototype.transaction = old
                await si.close()
            }
        })

        it('initSequelize: sqlite加密設定(PRAGMA key)失敗之錯誤含帳號:密碼 → init與createStorage之reject為遮罩後之副本', async function() {
            //@journeyapps/sqlcipher未安裝: 暫以sqlite3代之(Module._resolveFilename), 並令加密設定之查詢失敗(錯誤之message與sql含PRAGMA key之帳號:密碼, 同sequelize之DatabaseError形態);
            //於Sequelize.prototype.query層即失敗, 不開啟sqlite連線(避免殘留檔案控制代碼)
            let oldRes = Module._resolveFilename
            let oldQuery = Sequelize.prototype.query
            let sqlite3Path = Module.createRequire(path.resolve('package.json')).resolve('sqlite3')
            let stmt = `PRAGMA key = '${SEC.username}:${SEC.password}'`
            Module._resolveFilename = function(request, ...rest) {
                return request === '@journeyapps/sqlcipher' ? sqlite3Path : oldRes.call(this, request, ...rest)
            }
            Sequelize.prototype.query = function(sql, ...rest) {
                if (typeof sql === 'string' && sql.indexOf('PRAGMA ') === 0) {
                    let e = new DbErr(`SQLITE_NOTADB: file is not a database: ${stmt}`)
                    e.sql = stmt
                    return Promise.reject(e)
                }
                return oldQuery.call(this, sql, ...rest)
            }
            try {
                let w = wo(getOpt({ useEncryption: true }))
                let a = await settle(w.init())
                assert.ok(a.err instanceof DbErr, String(a.err))
                assert.strictEqual(a.err.message, 'SQLITE_NOTADB: file is not a database: PRAGMA key = \'***\'')
                assert.strictEqual(a.err.sql, 'PRAGMA key = \'***\'')
                noPw(util.inspect(a.err, { showHidden: true }))
                let b = await settle(w.createStorage())
                assert.ok(b.err instanceof DbErr && b.err.sql === 'PRAGMA key = \'***\'', String(b.err))
                let evs = []
                w.on('error', (m, d, msg) => evs.push(msg))
                let c = await settle(w.select({}))
                assert.ok(c.err instanceof DbErr && c.err.sql === 'PRAGMA key = \'***\'', String(c.err))
                assert.deepStrictEqual(evs, [c.err.message])
            }
            finally {
                Module._resolveFilename = oldRes
                Sequelize.prototype.query = oldQuery
            }
        })

    })


    describe('本套件之固定詞彙原樣(語料R07: 密碼恰為其子字串)', function() {

        it('密碼為invalid: invalid find(cvOrmFind與cvFind)、invalid data、逐筆invalid data皆原樣; 同一實例之外來錯誤含invalid者仍遮罩', async function() {
            let w = wo(getOpt({ url: `sqlite://${SEC.username}:invalid@:`, autoGenPk: false }))
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            let a = await settle(w.select({ $foo: 1 }))
            assert.ok(a.err instanceof Error && a.err.message.indexOf('invalid find: ') === 0 && a.err.message.indexOf('***') < 0, a.err.message)
            let b = await settle(w.select({ nocol: 1 }))
            assert.ok(b.err.message.indexOf('invalid find: unknown column name [nocol]') === 0, b.err.message)
            let b2 = await settle(w.select(null))
            assert.ok(b2.err.message.indexOf('invalid find: ') === 0 && b2.err.message.indexOf('***') < 0, b2.err.message)
            let c = await settle(w.insert({ name: 'x' }))
            assert.strictEqual(c.err.message, 'invalid data[0].id, autoGenPk is false')
            let d = await settle(w.del([{ name: 'x' }]))
            assert.deepStrictEqual(d.ok, [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].id' }])
            let f = await settle(w.insert({ id: 'a\uD800' }))
            assert.ok(f.err.message.indexOf('invalid ') === 0 && f.err.message.indexOf('***') < 0, f.err.message)
            assert.deepStrictEqual(evs.map((v) => v[1]), [a.err.message, b.err.message, b2.err.message, c.err.message, 'invalid data[0].id', f.err.message])
            let g = await withHook('find', new DbErr('invalid row'), () => settle(w.select({})))
            assert.strictEqual(g.err.message, '*** row', '對照: 外來錯誤仍經遮罩')
        })

        it('密碼為import: can not import model之reject與error事件原樣', async function() {
            let w = wo(getOpt({ url: `sqlite://${SEC.username}:import@:`, cl: 'nomodel' }))
            let evs = []
            w.on('error', (m, d, msg) => evs.push(msg))
            let r = await captureConsole(() => settle(w.select({})))
            assert.deepStrictEqual(r.res, { err: 'can not import model: nomodel, need to use genModelsByDB, genModelsByTabs or create nomodel.js' })
            assert.deepStrictEqual(evs, [r.res.err])
            let r2 = await captureConsole(() => settle(w.createStorage()))
            assert.deepStrictEqual(r2.res, { err: r.res.err })
        })

        it('密碼為closed: instance is closed之reject原樣(selectByPk之入口與select之catch站點)', async function() {
            let w = wo(getOpt({ url: `sqlite://${SEC.username}:closed@:` }))
            let si = await w.init()
            await si.close()
            let a = await settle(w.select({}, { instance: si }))
            assert.strictEqual(a.err.message, 'instance is closed, need to use init() to get a new instance')
            let b = await settle(w.selectByPk('k', { instance: si }))
            assert.strictEqual(b.err.message, a.err.message)
        })

    })


    describe('宣告(codes、nested、types、paths、patterns)', function() {

        it('codes: sqlite、mysql、mssql(含明列整數)、sqlstate之代碼照列, 未宣告者不列', async function() {
            let rows = [['SQLITE_BUSY', 'SQLITE_BUSY'], ['ER_DUP_ENTRY', 'ER_DUP_ENTRY'], ['ELOGIN', 'ELOGIN'], ['23505', '23505'], [2627, 2627], ['ENOENT', 'ENOENT'], ['ZZ_SECRET', undefined], [123456789, undefined]]
            for (let [code, expect] of rows) {
                let { safe } = await viaListener(Object.assign(new Error('x'), { code }))
                assert.strictEqual(safe.errCode, expect, String(code))
            }
        })

        it('nested: original、parent之code照列(sequelize包裝驅動錯誤)', async function() {
            let a = await viaListener(Object.assign(new Error('x'), { original: { code: 'SQLITE_CONSTRAINT' } }))
            assert.strictEqual(a.safe.errCode, 'SQLITE_CONSTRAINT')
            let b = await viaListener(Object.assign(new Error('x'), { parent: { code: '23505' } }))
            assert.strictEqual(b.safe.errCode, '23505')
        })

        it('types: sequelize之錯誤類別名照列(UniqueConstraintError、ConnectionError、DatabaseError), 使用端自訂類別為Error', async function() {
            let a = await viaListener(new Sequelize.UniqueConstraintError({}))
            assert.strictEqual(a.safe.errType, 'SequelizeUniqueConstraintError')
            let b = await viaListener(new Sequelize.ConnectionError(new Error('x')))
            assert.strictEqual(b.safe.errType, 'SequelizeConnectionError')
            let parent = Object.assign(new Error('y'), { sql: 'SELECT 1' })
            let c = await viaListener(new Sequelize.DatabaseError(parent))
            assert.deepStrictEqual([c.safe.errType, Object.keys(c.safe)], ['SequelizeDatabaseError', ['mode', 'errType']])
            let d = await viaListener(new DbErr('z'))
            assert.strictEqual(d.safe.errType, 'Error')
        })

        it('paths: sqlite檔案路徑(呼叫端所給之相對形式與絕對形式)於細節遮罩; 對外之reject不遮(Q3)', async function() {
            let abs = path.resolve(storage)
            let msg = `open ${storage} | ${abs} | ${abs.replace(/\\/g, '/')}`
            let { detail } = await viaListener(new Error(msg))
            assert.strictEqual(detail.message, 'open *** | *** | ***')
            let e = new DbErr(msg)
            let { r } = await viaHook(e)
            assert.strictEqual(r, e)
            let other = await viaListener(new Error('open ./elsewhere/x.sqlite'))
            assert.strictEqual(other.detail.message, 'open ./elsewhere/x.sqlite', '非本實例之路徑不遮')
        })

        it('patterns(pragmaKey): PRAGMA key之未登錄金鑰值於sql紀錄之細節遮罩; 預設只列PRAGMA', async function() {
            let got = []
            let w = wo(getOpt({ logging: true, funLog: (...a) => got.push(a) }))
            let si = await w.init()
            try {
                await si.mds.users.sequelize.query('PRAGMA key = \'zzUnknownKey9\'')
                await si.mds.users.sequelize.query('PRAGMA rekey("zzUnknownKey8")')
            }
            finally {
                await si.close()
            }
            let g = got.filter((x) => x[1] && x[1].stmt === 'PRAGMA')
            assert.strictEqual(g.length, 2, JSON.stringify(got.map((x) => x[1])))
            let full = g.map((x) => String(x[2])).join('\n')
            assert.ok(full.indexOf('zzUnknownKey') < 0 && full.indexOf('PRAGMA key = \'***\'') >= 0, full)
        })

        it('sqlite以外之方言不宣告儲存路徑: 預設storage之路徑不被當成秘密(不多遮); 帳密仍遮', async function() {
            let got = []
            let w = wo({ url: `mssql://${SEC.username}:${SEC.password}@127.0.0.1:1`, cl: 'users', fdModels: dirModels, funLog: (...a) => got.push(a) })
            let p = path.resolve('./worm.db')
            w.on('error', () => {
                throw new Error(`see ${p} ${SEC.password}`)
            })
            await settle(w.select({ $foo: 1 })) //條件形狀不合法者於連線前即reject, 不連線
            let g = got.filter((x) => x[0] === 'error handler threw')
            assert.strictEqual(g.length, 1)
            assert.strictEqual(String(g[0][2].message), `see ${p} ***`)
        })

    })


    describe('genModelsByTabs之diag參數(跨套件契約)', function() {

        it('傳入wsemi之getDiag實例: 只以固定標籤呼叫, safe依呼叫端之safeKeys(須含name、type), 細節交其funLog', function() {
            let got = []
            let diag = getDiag({ funLog: (...a) => got.push(a) }, { safeKeys: ['name', 'type'] })
            genModelsByTabs(dirGen, { tw1: { id: { type: 'STRING', pk: true } } }, { type: 'json' }, diag)
            assert.deepStrictEqual(got.map((x) => [x[0], x[1]]), [['generate file:', { name: 'tw1', type: 'json' }]])
            assert.ok(String(got[0][2]).indexOf('tw1.json') >= 0)
            let got2 = []
            genModelsByTabs(dirGen, { tw2: { id: { type: 'STRING', pk: true } } }, {}, getDiag({ funLog: (...a) => got2.push(a) }, {}))
            assert.deepStrictEqual(got2.map((x) => [x[0], x[1]]), [['generate file:', {}]], '呼叫端未宣告name、type者由wsemi丟棄')
        })

        it('不合契約者(非函數、無brief之函數)改用預設出口: console只輸出固定標籤與摘要, 傳入之函數不被呼叫', async function() {
            let n = 0
            let bad = () => {
                n++
            }
            for (let d of [bad, null, 'x', {}]) {
                let { all } = await captureConsole(() => genModelsByTabs(dirGen, { tw3: { id: { type: 'STRING', pk: true } } }, {}, d))
                assert.deepStrictEqual(all, ['generate file: { name: \'tw3\', type: \'js\' }'], String(d))
            }
            assert.strictEqual(n, 0)
        })

    })

})

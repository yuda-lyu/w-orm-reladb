import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'


//rulebook R21(td01, 2026-11-09): MSSQL連線預設加密之依賴與站點盤點(不連線; 行為見api-tdsencrypt、api-mssql之api-tdsencrypt-real)
//  R21-4 依賴: 已安裝之tedious與package.json宣告之下限皆不低於20.3.7(GHSA-wj7m-ffj3-574h之修正版; 之前於伺服器不協商加密時仍以明文送出登入封包)
//  R21-5 預設選項之來源(升級哨): sequelize 6之mssql connection-manager只設trustServerCertificate:true、不設encrypt, tedious預設encrypt:true; 任一變動即須重新判斷本套件之預設是否仍加密
//  R21-6 站點全集: src只有一處new Sequelize(WOrmReladb.mjs之initSequelize), 且src(含經w-auto-sequelize之genModelsByDB)不設定也不外露任何連線加密選項
//        (不出現dialectOptions、encrypt、trustServerCertificate、tedious); 判定式附負向對照(證明掃描不空轉)
//註: 測試設定(測試檔)若須對驅動顯式encrypt:false, 僅限對照案或不支援加密之後端, 並於該處註明原因(見R21-8之測試檔盤點)


let require = createRequire(import.meta.url)

let MIN = '20.3.7' //GHSA-wj7m-ffj3-574h之修正版

//cmp, 比較x.y.z版號(只含數字之版本)
let cmp = (a, b) => {
    let x = String(a).split('.').map(Number)
    let y = String(b).split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        let d = (x[i] || 0) - (y[i] || 0)
        if (d !== 0) {
            return d < 0 ? -1 : 1
        }
    }
    return 0
}

let readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

//src, 讀程式檔(註解以空白取代, 保留行號): 區塊註解只認行首之/*(JSDoc), 行內//註解中出現之/*不視為區塊註解起點(同unit-diaglog之寫法, 見R17-9)
let strip = (s) => {
    s = s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ' '))
    return s.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, ''))
}
let src = (f) => strip(fs.readFileSync(f, 'utf8'))

//BAD, 連線加密選項之設定或外露(程式碼, 註解不算)
let BAD = /\bdialectOptions\b|\bencrypt\b|\btrustServerCertificate\b|\btedious\b/

//hits, 回傳含BAD之行(行號與內容)
let hits = (lines) => lines.map((l, k) => [k + 1, l]).filter(([, l]) => BAD.test(l)).map(([k, l]) => `${k}: ${l.trim()}`)

let dirOf = (name) => path.dirname(require.resolve(`${name}/package.json`))


describe('MSSQL連線預設加密之依賴與站點盤點(R21)', function() {

    describe('R21-4 tedious不低於20.3.7(GHSA-wj7m-ffj3-574h)', function() {

        it('已安裝之tedious版本 >= 20.3.7', function() {
            let ver = readJson(path.join(dirOf('tedious'), 'package.json')).version
            assert.ok(cmp(ver, MIN) >= 0, `已安裝tedious ${ver} < ${MIN}: 預設encrypt:true下伺服器不協商加密時仍以明文送出登入封包`)
        })

        it('package.json宣告之tedious下限 >= 20.3.7(使新安裝不會解到修正前之版本)', function() {
            let rng = readJson('./package.json').dependencies.tedious
            let m = /^\^(\d+\.\d+\.\d+)$/.exec(rng)
            assert.ok(m, `tedious宣告應為^x.y.z形式: ${rng}`)
            assert.ok(cmp(m[1], MIN) >= 0, `tedious宣告 ${rng} 之下限低於${MIN}`)
        })

        it('判定式之負向對照: 20.3.6、19.2.2判定為低於下限, 20.3.7、20.3.8、21.0.0判定為不低於', function() {
            assert.deepStrictEqual(['20.3.6', '19.2.2', '20.3.7', '20.3.8', '21.0.0'].map((v) => cmp(v, MIN) >= 0), [false, false, true, true, true])
        })

    })

    describe('R21-5 預設選項之來源(升級哨): 本套件不設加密選項, 採sequelize與tedious之預設', function() {

        it('sequelize之mssql connection-manager只設trustServerCertificate:true, 不設encrypt(故由tedious之預設決定)', function() {
            let f = path.join(dirOf('sequelize'), 'lib', 'dialects', 'mssql', 'connection-manager.js')
            let code = fs.readFileSync(f, 'utf8')
            assert.ok(/trustServerCertificate:\s*true/.test(code), 'sequelize之預設trustServerCertificate應為true(README之說明依此; 變動須同步文件並重新判斷)')
            assert.ok(!/\bencrypt\b/.test(code), 'sequelize之mssql connection-manager出現encrypt: 預設加密與否已不由tedious決定, 須重新判斷')
        })

        it('tedious預設encrypt為true', function() {
            let code = fs.readFileSync(path.join(dirOf('tedious'), 'lib', 'connection.js'), 'utf8')
            assert.ok(/\n\s*encrypt:\s*true,\n/.test(code), 'tedious之預設encrypt應為true(Connection之預設選項)')
        })

    })

    describe('R21-6 站點全集: 只有一處new Sequelize, 不設定也不外露連線加密選項', function() {

        let srcFiles = fs.readdirSync('./src').filter((f) => /\.(mjs|js)$/.test(f))

        it('canary: 去註解後之src仍含initSequelize之建構(否則掃描已失明)', function() {
            assert.ok(src('./src/WOrmReladb.mjs').some((l) => l.indexOf('new Sequelize(opt.db, username, password, optSeq)') >= 0))
        })

        it('src之new Sequelize(只有WOrmReladb.mjs一處', function() {
            let sites = []
            for (let f of srcFiles) {
                src(`./src/${f}`).forEach((l, k) => {
                    if (/new Sequelize\(/.test(l)) {
                        sites.push(`${f}:${k + 1}`)
                    }
                })
            }
            assert.strictEqual(sites.length, 1, JSON.stringify(sites))
            assert.ok(sites[0].indexOf('WOrmReladb.mjs:') === 0, sites[0])
        })

        it('src之程式碼不出現dialectOptions、encrypt、trustServerCertificate、tedious(不設定、不外露、不直接建立驅動連線)', function() {
            let bads = []
            for (let f of srcFiles) {
                hits(src(`./src/${f}`)).forEach((h) => bads.push(`${f}:${h}`))
            }
            assert.deepStrictEqual(bads, [])
        })

        it('genModelsByDB所經之w-auto-sequelize(已安裝版本): new Sequelize只有一處, 其程式碼不設定連線加密選項', function() {
            let d = dirOf('w-auto-sequelize')
            let sites = []
            let bads = []
            for (let sub of ['src']) {
                for (let f of fs.readdirSync(path.join(d, sub)).filter((x) => /\.(mjs|js)$/.test(x))) {
                    src(path.join(d, sub, f)).forEach((l, k) => {
                        if (/new Sequelize\(/.test(l)) {
                            sites.push(`${f}:${k + 1}`)
                        }
                        if (BAD.test(l)) {
                            bads.push(`${f}:${k + 1}: ${l.trim()}`)
                        }
                    })
                }
            }
            assert.strictEqual(sites.length, 1, JSON.stringify(sites))
            assert.deepStrictEqual(bads, [])
        })

        it('判定式之負向對照: 設定或外露加密選項之寫法皆被抓到, 註解與無關程式碼不被抓', function() {
            let t = (s) => hits(strip(s)).length
            assert.strictEqual(t('let o = { dialectOptions: { options: { encrypt: false } } }'), 1)
            assert.strictEqual(t('o.dialectOptions = opt.dialectOptions'), 1)
            assert.strictEqual(t('let x = { trustServerCertificate: true }'), 1)
            assert.strictEqual(t('import tedious from \'tedious\''), 1)
            assert.strictEqual(t('    //dialectOptions: { encrypt: false }'), 0)
            assert.strictEqual(t('/**\n * encrypt tedious dialectOptions\n */\nlet a = 1'), 0)
            assert.strictEqual(t('let useEncryption = false'), 0)
        })

    })

    describe('R21-8 測試設定之encrypt:false須註明原因, 且僅限對照案', function() {

        let MARK = /R21-8 encrypt:false:/
        let ALLOWED = ['api-tdsencrypt.test.mjs', 'api-tdsencrypt-real.mjs'] //僅此二檔得對驅動顯式encrypt:false(皆為對照案: 證明偵測器有效、證明查詢能分辨加密與否)

        //scan, 回傳(檔內)以程式碼設定encrypt:false且其行與前3行皆無註明標記者
        let scan = (raw) => {
            let rawLines = raw.split(/\r?\n/)
            return strip(raw).map((l, k) => [k, l]).filter(([, l]) => /\bencrypt\s*:\s*false\b/.test(l)).filter(([k]) => !rawLines.slice(Math.max(0, k - 3), k + 1).some((x) => MARK.test(x))).map(([k]) => k + 1)
        }

        let files = fs.readdirSync('./test', { recursive: true })
            .map((f) => String(f).replace(/\\/g, '/'))
            .filter((f) => /\.(mjs|js)$/.test(f) && !/^(_tmp|pics)\//.test(f) && f !== 'unit-tdsencrypt.test.mjs') //本檔為掃描者, 內含判定式之範例字串

        it('test/下以程式碼設定encrypt:false者, 該行或其前3行須有「R21-8 encrypt:false: 原因」註明', function() {
            let bads = []
            for (let f of files) {
                for (let n of scan(fs.readFileSync(`./test/${f}`, 'utf8'))) {
                    bads.push(`${f}:${n}`)
                }
            }
            assert.deepStrictEqual(bads, [])
        })

        it('encrypt:false只出現於對照案之測試檔(api-tdsencrypt.test.mjs、api-tdsencrypt-real.mjs)', function() {
            let bads = files.filter((f) => !ALLOWED.includes(path.basename(f)) && strip(fs.readFileSync(`./test/${f}`, 'utf8')).some((l) => /\bencrypt\s*:\s*false\b/.test(l)))
            assert.deepStrictEqual(bads, [])
        })

        it('canary: 掃描涵蓋之檔含api-tdsencrypt.test.mjs, 且其encrypt:false確被偵測到(有註明者不列入違規)', function() {
            assert.ok(files.includes('api-tdsencrypt.test.mjs'))
            let raw = fs.readFileSync('./test/api-tdsencrypt.test.mjs', 'utf8')
            assert.ok(strip(raw).some((l) => /\bencrypt\s*:\s*false\b/.test(l)), '掃描失明: 應偵測到對照案之encrypt:false')
        })

        it('判定式之負向對照: 無註明者被抓到、前3行內有註明者通過、註明在4行之前者被抓到、註解內之encrypt:false不算', function() {
            assert.deepStrictEqual(scan('let a = { encrypt: false }'), [1])
            assert.deepStrictEqual(scan('//R21-8 encrypt:false: 對照案\nlet a = { encrypt: false }'), [])
            assert.deepStrictEqual(scan('let a = { encrypt: false } //R21-8 encrypt:false: 對照案'), [])
            assert.deepStrictEqual(scan('//R21-8 encrypt:false: x\n1\n2\n3\nlet a = { encrypt: false }'), [5])
            assert.deepStrictEqual(scan('//encrypt: false\nlet b = { encrypt: true }'), [])
        })

    })

})

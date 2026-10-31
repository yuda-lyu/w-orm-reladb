import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'


//sqlite 之 opt.storage 於建構時拒收之測試(不連線, rulebook R20, 第 213 項)
//  R20-1 sqlite 之 opt.storage 含 NUL: 建構時 throw `invalid opt.storage: string contains NUL`(sqlite3 於 NUL 截斷檔名, 不同名稱會指向同一檔)
//  R20-2 sqlite 之 opt.storage 恰為 ':memory:': 建構時 throw `invalid opt.storage: must be a file path, an in-memory database is not supported`
//        (opt.storage 經 path.resolve, 故不是記憶體資料庫; 各函數每次 init＋close, 記憶體庫無法跨呼叫保留)
//  R20-3 訊息為固定詞彙, 不回顯值(dspec 輸入參數之檢測機制 §6 V20); useEncryption 之 sqlite 同
//  R20-4 邊界: 只拒「含 NUL」與「恰為 ':memory:'」; 其他名稱(含形似者、明確之檔案路徑寫法)照常接受; 預設 storage 照常
//  R20-5 其他方言(mssql、mysql、mariadb、postgres)不檢(opt.storage 只供 sqlite 使用)
//  R20-6 順序: 孤立代理碼元(R13)與 opt.db、opt.cl 之檢核先於本規則; url 之 dialect 無效者先報 url 之錯
//  R20-7 拒收時不改動呼叫端之 opt.storage、不建立任何檔案或資料夾
//  R20-8 接線站點掃描: chkOrmStr 於 WOrmReladb.mjs 兩處(建構迴圈、sqlite 之 storage NUL), 程式碼中 ':memory:' 字面只在拒收處
//行為之端到端驗證(各函數不得被呼叫到、不建立檔案)見 api-sqlite-open 之 R20


let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)

let WHY_NUL = 'invalid opt.storage: string contains NUL'
let WHY_MEM = 'invalid opt.storage: must be a file path, an in-memory database is not supported'

let dir = './test/_tmp/unit-storage'
let root = path.resolve(dir)

let urls = {
    sqlite: 'sqlite://:',
    sqliteEnc: 'sqlite://tuser:S3cretPw@:', //useEncryption 時須帳號與密碼
    mssql: 'mssql://username:password@localhost:1433',
    mysql: 'mysql://username:password@localhost:3306',
    mariadb: 'mariadb://username:password@localhost:3306',
    postgres: 'postgres://username:password@localhost:5432',
}

let mk = (storage, kind = 'sqlite', extra = {}) => {
    let opt = { url: urls[kind], db: 'worm', cl: 'users', fdModels: './models', ...extra }
    if (storage !== undefined) {
        opt.storage = storage
    }
    return wo(opt)
}


describe('opt.storage 建構時拒收(unit)', function() {

    before(function() {
        fs.rmSync(root, { recursive: true, force: true })
    })

    after(function() {
        fs.rmSync(root, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅在空資料夾時移除
        }
        catch (err) {}
    })


    describe('R20-1 sqlite: opt.storage 含 NUL', function() {

        let nulForms = {
            middle: 'a\u0000b.sqlite',
            end: 'a.sqlite\u0000',
            start: '\u0000a.sqlite',
            only: '\u0000',
            twice: 'a\u0000b\u0000c.sqlite',
            afterDirectory: './sub/dir/a\u0000b.sqlite', //截斷後為 ./sub/dir/a
            absolute: path.join(root, 'a\u0000b.sqlite'),
            afterExtension: 'a.sqlite\u0000.txt', //截斷後仍為 a.sqlite, 副檔名之別名
            withEmoji: 'a\u{1F600}\u0000b.sqlite',
        }

        for (let [k, s] of Object.entries(nulForms)) {
            it(`${k} → throw ${WHY_NUL}`, function() {
                assert.throws(() => mk(s), (err) => err instanceof Error && msgOf(err) === WHY_NUL)
            })
        }

        it('互為別名之兩個名稱(a\\0b、a\\0c)皆拒收, 不會建出指向同一檔之兩個實例', function() {
            let ws = []
            for (let s of ['a\u0000b.sqlite', 'a\u0000c.sqlite']) {
                try {
                    ws.push(mk(path.join(root, s)))
                }
                catch (err) {
                    ws.push(msgOf(err))
                }
            }
            assert.deepStrictEqual(ws, [WHY_NUL, WHY_NUL])
        })

    })


    describe('R20-2 sqlite: opt.storage 恰為 :memory:', function() {

        it(`':memory:' → throw ${WHY_MEM}`, function() {
            assert.throws(() => mk(':memory:'), (err) => err instanceof Error && msgOf(err) === WHY_MEM)
        })

        it('不論 opt 其他設定(logDetail、funLog、useStable、autoGenPk)皆拒收', function() {
            for (let extra of [{ logDetail: true }, { funLog: () => {} }, { useStable: false }, { autoGenPk: false }, { logging: true }]) {
                assert.throws(() => mk(':memory:', 'sqlite', extra), (err) => msgOf(err) === WHY_MEM, JSON.stringify(Object.keys(extra)))
            }
        })

    })


    describe('R20-3 訊息固定詞彙、不回顯值; useEncryption 之 sqlite 同', function() {

        it('NUL: 訊息不含 storage 之任何片段', function() {
            let s = 'secretdir/sec\u0000ret.sqlite'
            assert.throws(() => mk(s), (err) => {
                let m = msgOf(err)
                return m === WHY_NUL && m.indexOf('secret') < 0 && m.indexOf('\u0000') < 0 && m.indexOf('sec') < 0
            })
        })

        it(':memory: 之訊息不含值本身', function() {
            assert.throws(() => mk(':memory:'), (err) => msgOf(err).indexOf(':memory:') < 0 && msgOf(err).indexOf('memory:') < 0)
        })

        it('url 含帳密之 useEncryption: NUL 與 :memory: 照拒, 訊息不含帳密', function() {
            for (let [s, why] of [['a\u0000b.sqlite', WHY_NUL], [':memory:', WHY_MEM]]) {
                assert.throws(() => mk(s, 'sqliteEnc', { useEncryption: true }), (err) => {
                    let m = msgOf(err)
                    return m === why && m.indexOf('S3cretPw') < 0 && m.indexOf('tuser') < 0
                })
            }
        })

        it('固定詞彙之前綴為 invalid opt.storage: 與其他 invalid opt.<名>: 同形(R13)', function() {
            for (let s of ['a\u0000b', ':memory:']) {
                assert.throws(() => mk(s), (err) => /^invalid opt\.storage: [a-z]/.test(msgOf(err)))
            }
        })

    })


    describe('R20-4 邊界: 只拒含 NUL 者與恰為 :memory: 者', function() {

        let okForms = {
            default: undefined, //不給: 預設 ./worm.db
            plain: 'a.sqlite',
            relative: './data/a.sqlite',
            absolute: path.join(root, 'a.sqlite'),
            memorySuffix: ':memory:x',
            memoryPrefix: 'x:memory:',
            memoryUpper: ':MEMORY:',
            memorySpaceBefore: ' :memory:',
            memorySpaceAfter: ':memory: ',
            memoryExplicitPath: './:memory:', //明確之檔案路徑寫法(POSIX 下為檔案名稱 :memory:), 不同於哨兵值 ':memory:'
            memoryInDir: ':memory:/a.sqlite',
            fileUri: 'file::memory:',
            emptyFallsBackToDefault: '', //非空字串才算有給, 空字串用預設值
            nonStringFallsBackToDefault: 5, //非字串用預設值
            replacementChar: 'a�b.sqlite',
            emoji: 'a\u{1F600}b.sqlite',
            cjk: '資料庫.sqlite',
            noExtension: 'worm',
            backslashZero: 'a\\0b.sqlite', //字面反斜線加 0, 非 NUL
        }

        for (let [k, s] of Object.entries(okForms)) {
            it(`${k} → 不 throw`, function() {
                assert.doesNotThrow(() => mk(s))
            })
        }

        it('已建構之合格實例取得完整之 API(select 等為函數)', function() {
            let w = mk(path.join(root, 'ok.sqlite'))
            for (let f of ['select', 'selectByPk', 'insert', 'insertBulk', 'save', 'del', 'delAll', 'createStorage', 'genTransaction', 'init']) {
                assert.strictEqual(typeof w[f], 'function', f)
            }
        })

    })


    describe('R20-5 其他方言不檢 opt.storage', function() {

        for (let kind of ['mssql', 'mysql', 'mariadb', 'postgres']) {
            for (let [k, s] of [['NUL', 'a\u0000b.sqlite'], [':memory:', ':memory:']]) {
                it(`${kind} 之 opt.storage 為 ${k} → 不 throw(建構不連線)`, function() {
                    assert.doesNotThrow(() => mk(s, kind))
                })
            }
        }

    })


    describe('R20-6 順序', function() {

        it('孤立代理碼元(R13)先於 NUL 與 :memory: 之檢核: 同含孤立代理與 NUL 者回報孤立代理', function() {
            assert.throws(() => mk('a\uD800\u0000b'), (err) => msgOf(err) === 'invalid opt.storage: string contains lone surrogate')
        })

        it('opt.db、opt.cl 之孤立代理先於 opt.storage 之 NUL', function() {
            assert.throws(() => mk('a\u0000b', 'sqlite', { db: 'x\uD800' }), (err) => msgOf(err) === 'invalid opt.db: string contains lone surrogate')
            assert.throws(() => mk(':memory:', 'sqlite', { cl: 'x\uD800' }), (err) => msgOf(err) === 'invalid opt.cl: string contains lone surrogate')
        })

        it('url 之 dialect 無效者先報 url 之錯(非 sqlite, 不適用本規則)', function() {
            assert.throws(() => mk('a\u0000b', 'sqlite', { url: 'nodialect://:' }), (err) => msgOf(err).startsWith('invalid dialect in opt.url'))
        })

    })


    describe('R20-7 拒收時不改動呼叫端之 opt.storage、不建立檔案', function() {

        it('opt.storage 維持呼叫端所給之字串(未被 path.resolve 改寫)', function() {
            for (let s of ['a\u0000b.sqlite', ':memory:']) {
                let opt = { url: urls.sqlite, db: 'worm', cl: 'users', fdModels: './models', storage: s }
                assert.throws(() => wo(opt))
                assert.strictEqual(opt.storage, s)
            }
        })

        it('拒收之路徑不建立任何檔案或資料夾(含截斷後之上層)', function() {
            let sub = path.join(root, 'never', 'created')
            for (let s of [path.join(sub, 'a\u0000b.sqlite')]) {
                assert.throws(() => mk(s))
            }
            assert.strictEqual(fs.existsSync(path.join(root, 'never')), false)
        })

    })


    describe('R20-8 接線站點掃描', function() {

        //src, 讀原始碼並去除註解(行首起算之區塊註解與行尾註解), 掃描對象為程式碼而非說明文字
        //註: 區塊註解只認行首者(src 內區塊註解皆自行首起); 不可用不限位置之 /\/\*[\s\S]*?\*\//: 行註解內之 `<scheme>://***` 含 `/*`, 會把其後至下一個 `*/` 之程式碼整段吃掉(第 213 項實測: 建構段之新程式碼因此被略過)
        let src = (fn) => fs.readFileSync(`./src/${fn}`, 'utf8').replace(/\r\n/g, '\n').replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/\/\/.*$/gm, '')
        let count = (s, re) => (s.match(re) || []).length

        it(':memory: 字面於 src 程式碼中只出現在 WOrmReladb.mjs 之拒收判斷一處', function() {
            let n = 0
            for (let fn of fs.readdirSync('./src').filter((v) => /\.(mjs|js)$/.test(v))) {
                n += count(src(fn), /:memory:/g)
            }
            assert.strictEqual(n, 1)
            assert.strictEqual(count(src('WOrmReladb.mjs'), /:memory:/g), 1)
        })

        it('sqlite 之拒收判斷在 dialect 確定之後、opt.storage 被 path.resolve 之前', function() {
            let w = src('WOrmReladb.mjs')
            let iDialect = w.indexOf(`throwUrlErr('invalid dialect in opt.url')`)
            let iMem = w.indexOf(`':memory:'`)
            let iResolve = w.indexOf('path.resolve(opt.storage)')
            assert.ok(iDialect > 0 && iMem > 0 && iResolve > 0)
            assert.ok(iDialect < iMem, 'dialect 確定後才檢(僅 sqlite)')
            assert.ok(iMem < iResolve, '須於 path.resolve 之前判斷(之後即非哨兵值)')
        })

    })

})

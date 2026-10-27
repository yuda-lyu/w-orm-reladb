import util from 'util'
import assert from 'assert'
import { getOptLog, getDiag, getBriefErr, getSecrets, maskText, maskUrl, cpMask, getSqlStmt } from '../src/getDiag.mjs'


//rulebook R17: 診斷輸出單一出口(src/getDiag.mjs)之純函數測試, 不連線
//對應: 預設只輸出標籤與不含個資之摘要(R17-1)、logDetail還原細節且憑證遮罩(R17-2)、funLog收完整細節(R17-3)、輸出不得使呼叫端拋錯(R17-4)


let PW = 'S3cretPw'
let USER = 'tuser'
let URL = `mssql://${USER}:${PW}@db.example.local:1433`
let ID = 'u-secret-001@example.com'


//cap, 擷取console各方法之輸出
function cap(fn) {
    let lines = []
    let ks = ['log', 'info', 'warn', 'error', 'debug']
    let olds = ks.map((k) => console[k])
    ks.forEach((k) => {
        console[k] = (...a) => lines.push(a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v, (kk, vv) => (typeof vv === 'bigint' ? String(vv) : vv)))).join(' '))
    })
    try {
        fn()
    }
    finally {
        ks.forEach((k, i) => {
            console[k] = olds[i]
        })
    }
    return lines
}


describe('getOptLog', function() {

    it('R17-3 未給或型別錯誤者忽略並用預設(與本套件其他選項型別錯誤之處理一致: 不拋錯)', function() {
        for (let o of [undefined, null, {}, 1, 'x', { logDetail: 'true' }, { logDetail: 1 }, { logDetail: {} }, { funLog: 'x' }, { funLog: {} }, { funLog: null }]) {
            assert.deepStrictEqual(getOptLog(o), { logDetail: false, funLog: null }, JSON.stringify(o))
        }
    })

    it('R17-3 logDetail為true、funLog為函數才生效', function() {
        let f = () => {}
        assert.deepStrictEqual(getOptLog({ logDetail: true, funLog: f }), { logDetail: true, funLog: f })
        assert.deepStrictEqual(getOptLog({ logDetail: false }), { logDetail: false, funLog: null })
    })

    it('R17-3 讀取選項拋錯者忽略該選項, 不連累另一個有效選項', function() {
        let f = () => {}
        let o1 = {
            get logDetail() {
                throw new Error('x')
            },
            funLog: f
        }
        assert.deepStrictEqual(getOptLog(o1), { logDetail: false, funLog: f })
        let o2 = {
            logDetail: true,
            get funLog() {
                throw new Error('x')
            }
        }
        assert.deepStrictEqual(getOptLog(o2), { logDetail: true, funLog: null })
    })

})


describe('getDiag', function() {

    it('R17-1 預設只輸出標籤與摘要, 不呼叫getDetail(細節在預設路徑不被取得)', function() {
        let n = 0
        let diag = getDiag(getOptLog({}))
        let lines = cap(() => {
            diag('L1', { mode: 'insert', errType: 'Error' }, () => {
                n++
                return `detail ${ID}`
            })
            diag('L2', undefined, () => {
                n++
                return ID
            })
            diag('L3')
        })
        assert.deepStrictEqual(lines, ['L1 {"mode":"insert","errType":"Error"}', 'L2', 'L3'])
        assert.strictEqual(n, 0)
    })

    it('R17-2 logDetail為true時還原細節: 標籤加細節; bare者只輸出細節(與舊版該站之console.log(細節)相同)', function() {
        let diag = getDiag(getOptLog({ logDetail: true }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => `detail ${ID}`)
            diag('L2', { a: 1 }, () => `bare ${ID}`, true)
            diag('L3', undefined)
        })
        assert.deepStrictEqual(lines, [`L1 detail ${ID}`, `bare ${ID}`, 'L3'])
    })

    it('R17-3 funLog收(label, safe, detail), 不寫console; 無細節者只收兩個引數', function() {
        let got = []
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => ({ id: ID }))
            diag('L2', undefined)
        })
        assert.deepStrictEqual(lines, [])
        assert.strictEqual(got.length, 2)
        assert.deepStrictEqual(got[0], ['L1', { a: 1 }, { id: ID }])
        assert.strictEqual(got[1].length, 2)
        assert.deepStrictEqual(got[1], ['L2', undefined])
    })

    it('R17-1 摘要(safe)亦防禦性遮罩: 值含已知憑證(表名恰為密碼、錯誤代碼恰為數字密碼)者以***取代, 不含者原樣', function() {
        let got = []
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }), getSecrets('sqlite://u:12345@:', 'u', '12345'))
        diag('L', { cl: '12345', errType: 'Error', errCode: 12345, other: 7 })
        diag('L', { cl: 'users', errCode: 'ENOENT' })
        assert.deepStrictEqual(got[0][1], { cl: '***', errType: 'Error', errCode: '***', other: 7 })
        assert.deepStrictEqual(got[1][1], { cl: 'users', errCode: 'ENOENT' })
        let lines = cap(() => {
            getDiag(getOptLog({}), getSecrets('sqlite://u:12345@:', 'u', '12345'))('L', { cl: '12345' })
        })
        assert.deepStrictEqual(lines, ['L {"cl":"***"}'])
    })

    it('R17-3 funLog存在時logDetail不另寫console(funLog取代console)', function() {
        let got = []
        let diag = getDiag(getOptLog({ logDetail: true, funLog: (...a) => got.push(a) }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => 'd')
        })
        assert.deepStrictEqual(lines, [])
        assert.deepStrictEqual(got, [['L1', { a: 1 }, 'd']])
    })

    it('R17-4 輸出不得使呼叫端拋錯: funLog拋錯、getDetail拋錯、console拋錯皆吞下', function() {
        let diag1 = getDiag(getOptLog({
            funLog: () => {
                throw new Error('x')
            }
        }))
        diag1('L', { a: 1 }, () => 'd')

        let got = []
        let diag2 = getDiag(getOptLog({ logDetail: true }))
        let lines = cap(() => {
            diag2('L', { a: 1 }, () => {
                throw new Error('boom')
            })
        })
        got.push(...lines)
        assert.deepStrictEqual(got, ['L (unprintable)'])

        let diag3 = getDiag(getOptLog({ funLog: (l, s, d) => got.push(d) }))
        diag3('L', undefined, () => {
            throw new Error('boom')
        })
        assert.strictEqual(got[got.length - 1], '(unprintable)')

        let diag4 = getDiag(getOptLog({}))
        let old = console.log
        console.log = () => {
            throw new Error('console broken')
        }
        try {
            diag4('L', { a: 1 })
        }
        finally {
            console.log = old
        }
    })

    it('R17-4 funLog回傳reject之promise不成為unhandledRejection', async function() {
        let bad = []
        let fn = (e) => bad.push(e)
        process.on('unhandledRejection', fn)
        try {
            let diag = getDiag(getOptLog({ funLog: () => Promise.reject(new Error('rej')) }))
            diag('L', { a: 1 }, () => 'd')
            let diag2 = getDiag(getOptLog({ funLog: () => ({ then: (a, b) => Promise.reject(new Error('rej2')) }) }))
            diag2('L', { a: 1 }, () => 'd')
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        finally {
            process.off('unhandledRejection', fn)
        }
        assert.deepStrictEqual(bad.map((v) => v.message), [])
    })

    it('R17-2 憑證遮罩: 細節(console與funLog)中之密碼、帳密、連線字串一律以***取代, 其餘細節保留', function() {
        let secrets = getSecrets(URL, USER, PW)
        let err = new Error(`connect ${URL} failed for ${USER}:${PW} id=${ID}`)
        err.code = 'ELOGIN'
        err.original = { message: `pw=${PW}`, nested: [PW, { deep: `x${PW}y` }] }

        let got = []
        let diag1 = getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)
        diag1('L', { a: 1 }, () => ({ state: 'error', msg: err }))
        let d = got[0][2]
        let s = JSON.stringify(d) + String(d.msg.message) + String(d.msg.stack)
        assert.ok(s.indexOf(PW) < 0, '密碼未遮罩')
        assert.ok(s.indexOf(`${USER}:${PW}`) < 0 && s.indexOf(URL) < 0, '帳密或連線字串未遮罩')
        assert.ok(d.msg.message.indexOf(ID) >= 0, '非憑證之細節被誤遮')
        assert.strictEqual(d.msg.code, 'ELOGIN')
        assert.ok(d.msg instanceof Error && d.msg !== err)
        assert.strictEqual(err.message.indexOf('***'), -1, '不得改動呼叫端之原物件')
        assert.ok(err.message.indexOf(PW) >= 0)

        let diag2 = getDiag(getOptLog({ logDetail: true }), secrets)
        let lines = cap(() => {
            diag2('L', { a: 1 }, () => ({ state: 'error', msg: err }))
            diag2('L', { a: 1 }, () => `Executing (default): SELECT * FROM t WHERE pw = '${PW}'`, true)
        })
        let all = lines.join('\n')
        assert.ok(all.indexOf(PW) < 0, `console輸出含密碼: ${all.slice(0, 300)}`)
        assert.ok(all.indexOf('***') >= 0)
    })

})


describe('getBriefErr', function() {

    it('R17-1 只列類別與機器代碼, 不含訊息文字', function() {
        let e = new Error(`failed for ${ID} ${PW}`)
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        class SequelizeDatabaseError extends Error {}
        let e2 = new SequelizeDatabaseError(`dup ${ID}`)
        e2.code = 'SQLITE_CONSTRAINT'
        assert.deepStrictEqual(getBriefErr(e2), { errType: 'SequelizeDatabaseError', errCode: 'SQLITE_CONSTRAINT' })
        let e3 = new Error('x')
        e3.original = { code: 'ELOGIN' }
        assert.deepStrictEqual(getBriefErr(e3), { errType: 'Error', errCode: 'ELOGIN' })
        let e4 = new Error('x')
        e4.parent = { code: 18456 }
        assert.deepStrictEqual(getBriefErr(e4), { errType: 'Error', errCode: 18456 })
    })

    it('R17-1 字串或非物件之reject值只列型別(字串內容可能夾帶資料)', function() {
        assert.deepStrictEqual(getBriefErr(`fail ${ID}`), { errType: 'string' })
        assert.deepStrictEqual(getBriefErr(null), { errType: 'null' })
        assert.deepStrictEqual(getBriefErr(undefined), { errType: 'undefined' })
        assert.deepStrictEqual(getBriefErr(12), { errType: 'number' })
        assert.deepStrictEqual(getBriefErr({ message: ID }), { errType: 'object' })
    })

    it('R17-1 code須為機器代碼樣式, 資料值樣式者不列(含過大整數、一般字串、電郵)', function() {
        for (let c of [ID, 'alice', 'U-0001', 99999999, 1.5, NaN, {}, [], 'E', 'ERR_', 'sqlite_busy', '', 'a'.repeat(60)]) {
            let e = new Error('x')
            e.code = c
            assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' }, String(c))
        }
        for (let c of ['ENOENT', 'ERR_INVALID_ARG_TYPE', 'SQLITE_CANTOPEN', 'ELOGIN', 18456, 0, -1]) {
            let e = new Error('x')
            e.code = c
            assert.deepStrictEqual(getBriefErr(e), { errType: 'Error', errCode: c }, String(c))
        }
    })

    it('R17-1 建構子名稱不合識別字樣式者列為Error; 不執行getter與使用端程式', function() {
        let e = new Error('x')
        function Weird() {}
        Object.defineProperty(Weird, 'name', { value: `bad name ${ID}` })
        Object.defineProperty(e, 'constructor', { value: Weird, configurable: true })
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        function Okay() {}
        Object.defineProperty(e, 'constructor', { value: Okay, configurable: true })
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Okay' })

        let called = 0
        let e2 = new Error('x')
        Object.defineProperty(e2, 'code', {
            get() {
                called++
                return 'ENOENT'
            },
            configurable: true
        })
        Object.defineProperty(e2, 'original', {
            get() {
                called++
                return { code: 'ELOGIN' }
            },
            configurable: true
        })
        assert.deepStrictEqual(getBriefErr(e2), { errType: 'Error' })
        assert.strictEqual(called, 0)
    })

    it('R17-4 Proxy與陷阱拋錯之值不使其拋錯', function() {
        let p = new Proxy({}, {
            getOwnPropertyDescriptor() {
                throw new Error('trap')
            },
            getPrototypeOf() {
                throw new Error('trap')
            }
        })
        let r = getBriefErr(p)
        assert.ok(r !== null && typeof r === 'object' && typeof r.errType === 'string')
        assert.ok(JSON.stringify(r).indexOf('trap') < 0)
    })

})


describe('maskText 與 getSecrets', function() {

    it('R17-2 getSecrets: 略過空值, 含連線字串、帳密、密碼與其URL編碼、單引號加倍形式, 長者在前; 無帳密者仍列連線字串', function() {
        assert.deepStrictEqual(getSecrets('', '', ''), [])
        let nc = getSecrets('sqlite://:', '', '')
        assert.ok(nc.includes('sqlite://:') && nc.every((v) => v !== ''), JSON.stringify(nc))
        assert.strictEqual(maskText('connect sqlite://: failed', nc), 'connect *** failed')
        let ss = getSecrets(URL, USER, PW)
        for (let v of [URL, USER, PW, `${USER}:${PW}`]) {
            assert.ok(ss.includes(v), v)
        }
        let enc = getSecrets('x://a b:p@ss@h:1', 'a b', 'p@ss')
        assert.ok(enc.includes(encodeURIComponent('p@ss')))
        let q = getSecrets('x://u:pa\'ss@h:1', 'u', 'pa\'ss')
        assert.ok(q.includes('pa\'\'ss'), JSON.stringify(q))
        assert.strictEqual(maskText('SELECT \'pa\'\'ss\' FROM t', q), 'SELECT \'***\' FROM t')
        for (let k = 1; k < ss.length; k++) {
            assert.ok(ss[k - 1].length >= ss[k].length)
        }
    })

    it('R17-2 maskText: 連線字串內嵌之帳密、PRAGMA key、含@之URL亦遮罩(不依賴已知秘密)', function() {
        assert.strictEqual(maskText(`a ${URL} b`, getSecrets(URL, USER, PW)), 'a *** b')
        assert.strictEqual(maskText('connect postgres://who:pw@host:5432/db now', []), 'connect postgres://***@host:5432/db now')
        assert.strictEqual(maskText('Executing (default): PRAGMA key = \'u:p\'', []), 'Executing (default): PRAGMA key = \'***\'')
        assert.strictEqual(maskText('PRAGMA rekey="x y"', []), 'PRAGMA rekey=\'***\'')
        assert.strictEqual(maskText('plain text no secret', getSecrets(URL, USER, PW)), 'plain text no secret')
    })

    it('R17-2 maskText: PRAGMA key之其他有效語法(schema名稱、括號、rekey、hexkey)之值皆遮罩, 其餘敘述不動', function() {
        assert.strictEqual(maskText('PRAGMA main.key = \'schema-secret\'', []), 'PRAGMA main.key = \'***\'')
        assert.strictEqual(maskText('PRAGMA key(\'parenthesized-secret\')', []), 'PRAGMA key(\'***\')')
        assert.strictEqual(maskText('PRAGMA rekey = \'new secret\'', []), 'PRAGMA rekey = \'***\'')
        assert.strictEqual(maskText('PRAGMA hexkey = "x\'AB12\'"', []), 'PRAGMA hexkey = \'***\'')
        assert.strictEqual(maskText('PRAGMA key=plain; SELECT 1', []), 'PRAGMA key=\'***\'; SELECT 1')
        assert.strictEqual(maskText('PRAGMA table_info(`users`)', []), 'PRAGMA table_info(`users`)')
        assert.strictEqual(maskText('PRAGMA cipher_compatibility = 4', []), 'PRAGMA cipher_compatibility = 4')
    })

    it('R17-2 maskText: 帳密含未編碼之@時取至最後一個@(不留密碼後半段); 不吞掉其後以空白分隔之文字', function() {
        assert.strictEqual(maskText('connect postgres://alice:secret@part@host/db', []), 'connect postgres://***@host/db')
        assert.strictEqual(maskText('see http://example.com:80 and mail me@x.com', []), 'see http://example.com:80 and mail me@x.com')
    })

    it('R17-2 maskText: 帳號或密碼恰為key時, PRAGMA key之未知金鑰值仍遮罩(先辨識語法再取代已知秘密)', function() {
        let r = maskText('PRAGMA key = \'independent-secret\'', getSecrets('sqlite://key:abc@:', 'key', 'abc'))
        assert.ok(r.indexOf('independent-secret') < 0, r)
    })

})


describe('cpMask', function() {

    it('R17-2 不改動原物件, 循環參照與過深/過大結構有界, 函數與二進位以標記字串代替', function() {
        let a = { name: ID, pw: PW, list: [PW, 1, null, undefined], fn() {}, buf: Buffer.from(PW), d: new Date(0) }
        a.self = a
        let deep = { v: PW }
        let cur = deep
        for (let k = 0; k < 30; k++) {
            cur.next = { v: PW }
            cur = cur.next
        }
        a.deep = deep
        let secrets = getSecrets(URL, USER, PW)
        let r = cpMask(a, secrets)
        assert.notStrictEqual(r, a)
        assert.strictEqual(a.pw, PW)
        assert.strictEqual(r.name, ID)
        assert.strictEqual(r.pw, '***')
        assert.deepStrictEqual(r.list, ['***', 1, null, undefined])
        assert.strictEqual(r.fn, '[Function]')
        assert.ok(String(r.buf).startsWith('[Binary'))
        assert.strictEqual(r.d.getTime(), 0)
        assert.strictEqual(r.self, r)
        let n = 0
        for (let x = r.deep; typeof x === 'object' && x !== null; x = x.next) {
            n++
            assert.ok(JSON.stringify(x.v).indexOf(PW) < 0)
        }
        assert.ok(n < 30, `過深結構未截斷: ${n}`)
        assert.ok(JSON.stringify(r, (k, v) => (k === 'self' ? undefined : v)).indexOf(PW) < 0)
    })

    it('R17-2 Error之副本仍為Error: message、stack、cause、自有屬性皆遮罩', function() {
        let e = new Error(`m ${PW}`, { cause: new Error(`c ${PW}`) })
        e.extra = `x ${PW}`
        let r = cpMask(e, getSecrets(URL, USER, PW))
        assert.ok(r instanceof Error)
        assert.strictEqual(r.message, 'm ***')
        assert.ok(typeof r.stack === 'string' && r.stack.indexOf(PW) < 0 && r.stack.indexOf('m ***') >= 0)
        assert.strictEqual(r.cause.message, 'c ***')
        assert.strictEqual(r.extra, 'x ***')
        assert.strictEqual(e.message, `m ${PW}`)
    })

    it('R17-2 屬性鍵與Symbol描述含憑證者亦遮罩; 數字密碼之同值數字亦遮罩(至少4位)', function() {
        let secrets = getSecrets('sqlite://u:12345@:', 'u', '12345')
        let e = new Error('x')
        e[PW] = 'v'
        e[Symbol(PW)] = 'w'
        e.parameters = { password: 12345, count: 7, big: 12345n }
        let r = cpMask(Object.assign(e, {}), getSecrets(URL, USER, PW))
        let keys = Reflect.ownKeys(r).map((k) => String(k))
        assert.ok(keys.every((k) => k.indexOf(PW) < 0), keys.join('|'))
        assert.ok(keys.includes('***') && keys.includes('Symbol(***)'), keys.join('|'))
        let r2 = cpMask({ password: 12345, count: 7, big: 12345n, s: '12345' }, secrets)
        assert.deepStrictEqual(r2, { password: '***', count: 7, big: '***', s: '***' })
    })

    it('R17-2 副本不沿用原型: 繼承屬性不外帶, 繼承之util.inspect.custom不被執行; Error之name取原型鏈上之資料屬性', function() {
        class MyErr extends Error {}
        MyErr.prototype.token = PW
        MyErr.prototype.name = 'MyErrName'
        MyErr.prototype[Symbol.for('nodejs.util.inspect.custom')] = () => `PW=${PW}`
        let r = cpMask(new MyErr('m'), getSecrets(URL, USER, PW))
        assert.ok(r instanceof Error)
        assert.strictEqual(r.token, undefined)
        assert.strictEqual(r.name, 'MyErrName')
        assert.ok(!util.inspect(r).includes(PW), util.inspect(r))
        class Foo {
            constructor() {
                this.a = 1
            }
        }
        Foo.prototype.b = PW
        Foo.prototype[Symbol.for('nodejs.util.inspect.custom')] = () => `PW=${PW}`
        let r2 = cpMask(new Foo(), getSecrets(URL, USER, PW))
        assert.deepStrictEqual(r2, { a: 1 })
        assert.ok(!util.inspect(r2).includes(PW))
    })

    it('R17-4 不執行使用端程式: Symbol.toStringTag之getter、自訂stack與message存取器皆不被執行', function() {
        let called = []
        let e = new Error('m')
        Object.defineProperty(e, Symbol.toStringTag, {
            get() {
                called.push('tag')
                return 'Error'
            }
        })
        Object.defineProperty(e, 'stack', {
            get() {
                called.push('stack')
                return `stack ${PW}`
            },
            configurable: true
        })
        Object.defineProperty(e, 'message', {
            get() {
                called.push('message')
                return `msg ${PW}`
            },
            configurable: true
        })
        let r = cpMask(e, getSecrets(URL, USER, PW))
        assert.ok(r instanceof Error)
        assert.deepStrictEqual(called, [])
        assert.ok(!util.inspect(r).includes(PW))
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        assert.deepStrictEqual(called, [])
    })

    it('R17-4 getter不被執行(以標記字串代替), 拋錯之getter不使其拋錯', function() {
        let called = 0
        let o = {
            get a() {
                called++
                return PW
            },
            b: 1
        }
        let r = cpMask(o, getSecrets(URL, USER, PW))
        assert.strictEqual(called, 0)
        assert.strictEqual(r.a, '[Getter/Setter]')
        assert.strictEqual(r.b, 1)
    })

})


describe('getSqlStmt', function() {

    it('R17-1 只取敘述種類(白名單), 不含表名與值', function() {
        assert.strictEqual(getSqlStmt(`Executing (default): SELECT * FROM t WHERE id = '${ID}'`), 'SELECT')
        assert.strictEqual(getSqlStmt('Executing (3f2c-aa): insert into t values ($1)'), 'INSERT')
        assert.strictEqual(getSqlStmt('Executing (default): UPDATE t SET a=$1'), 'UPDATE')
        assert.strictEqual(getSqlStmt('Executing (default): DELETE FROM t'), 'DELETE')
        assert.strictEqual(getSqlStmt('Executing (default): PRAGMA key = \'u:p\''), 'PRAGMA')
        assert.strictEqual(getSqlStmt('BEGIN TRANSACTION;'), 'BEGIN')
        assert.strictEqual(getSqlStmt(`Executing (default): ${ID} oops`), 'OTHER')
        assert.strictEqual(getSqlStmt('Executing (default): '), 'OTHER')
        assert.strictEqual(getSqlStmt(null), 'OTHER')
        assert.strictEqual(getSqlStmt({ a: 1 }), 'OTHER')
    })

})


describe('maskUrl', function() {

    it('R17-6 有@: ://與最後一個@之間換成***, @後取至/?#為止且須合主機位址樣式', function() {
        let t = [
            ['mssql://u:p@db.local:1433', 'mssql://***@db.local:1433'],
            ['mssql://u:p@ss@db.local:1433', 'mssql://***@db.local:1433'],
            ['mssql://u:p@@db.local', 'mssql://***@db.local'],
            ['mssql://u:p@', 'mssql://***@'],
            ['mssql://u:p@:1433', 'mssql://***@:1433'],
            ['mssql://u:p@db.local:', 'mssql://***@db.local:'],
            ['mssql://u:p@db.local/db?x=1#y', 'mssql://***@db.local'],
            ['mssql://u:p@db.local?pw=secret', 'mssql://***@db.local'],
            ['mssql://u:p@[::1]:1433', 'mssql://***@[::1]:1433'],
            ['mssql://u:p@db local', 'mssql://***@***'],
            ['mssql://u:p@db.local:1433x', 'mssql://***@***'],
            ['mssql://u:p@db.local:123456', 'mssql://***@***'],
            ['oracle://db.local:1433@user:pass', 'oracle://***@***'],
            ['://u:p@db.local:1433', '://***@db.local:1433'],
        ]
        for (let [from, to] of t) {
            assert.strictEqual(maskUrl(from), to, from)
        }
    })

    it('R17-6 無@: 只回<scheme>://***(host:1433會被解析成帳密, 故其後不回顯); 無://或非字串: 整段***', function() {
        assert.strictEqual(maskUrl('mssql://host:1433'), 'mssql://***')
        assert.strictEqual(maskUrl('mssql://onlypw'), 'mssql://***')
        assert.strictEqual(maskUrl('sqlite://:'), 'sqlite://***')
        assert.strictEqual(maskUrl('://x'), '://***')
        assert.strictEqual(maskUrl('u:p@db.local:1433'), '***')
        assert.strictEqual(maskUrl('onlypw'), '***')
        assert.strictEqual(maskUrl(''), '***')
        for (let v of [undefined, null, 1, {}, [], Symbol('x')]) {
            assert.strictEqual(maskUrl(v), '***')
        }
    })

    it('R17-6 scheme須為識別字(最多20字元), 否則換成***; 第一個://之前若夾帶帳密(如u:p@host://)亦不回顯', function() {
        assert.strictEqual(maskUrl('oracle://u:p@h:1'), 'oracle://***@h:1')
        assert.strictEqual(maskUrl('a.b+c-d://u:p@h:1'), 'a.b+c-d://***@h:1')
        assert.strictEqual(maskUrl('bad scheme://u:p@h:1'), '***://***@h:1')
        assert.strictEqual(maskUrl('u:p@h://x'), '***://***')
        assert.strictEqual(maskUrl(`${'a'.repeat(21)}://u:p@h:1`), '***://***@h:1')
        assert.strictEqual(maskUrl(`${'a'.repeat(20)}://u:p@h:1`), `${'a'.repeat(20)}://***@h:1`)
    })

    it('R17-6 已知限制(文件化,README與rulebook R17-6): 反向筆誤 host:port@帳號:純數字(≤5位)密碼 時,@後的 帳號:密碼 合於 主機:port 樣式而被回顯; 非數字密碼不受影響', function() {
        assert.strictEqual(maskUrl('oracle://db.local:1433@user:12345'), 'oracle://***@user:12345')
        assert.strictEqual(maskUrl('oracle://db.local:1433@user:pass'), 'oracle://***@***')
        assert.strictEqual(maskUrl('oracle://db.local:1433@user:123456'), 'oracle://***@***')
    })

    it('R17-6 組合掃描: scheme × 帳密段 × 主機段,帳密段(含QQ標記)不論夾帶 @ : / ? # 或空白,輸出皆不含QQ', function() {
        let schemes = ['mssql', 'oracle', '', 'sqlite']
        let uis = ['QQu:QQp', 'QQu', 'QQu:QQp:QQr', ':QQp', 'QQu:', 'QQp@QQs', 'QQ?x', 'QQ/x', 'QQ x', 'QQ#y', 'QQ:', ':QQ', 'QQ@@QQ']
        let hosts = ['', 'host', 'h.local:1433', ':1433', 'host:', '[::1]', 'h x', 'h/p', 'h?q=1', 'h#z', 'h@']
        let n = 0
        let forms = (sc, ui, h) => {
            let r = [`${sc}://${ui}@${h}`, `${ui}@${h}`, ui]
            if (ui.indexOf('@') < 0) {
                r.push(`${sc}://${ui}`)
            }
            return r
        }
        for (let sc of schemes) {
            for (let ui of uis) {
                for (let h of hosts) {
                    for (let s of forms(sc, ui, h)) {
                        let out = maskUrl(s)
                        n++
                        if (h === 'h@' && s.indexOf('://') >= 0 && s.endsWith('@')) {
                            //主機段以@結尾時,最後一個@之後為空字串
                            assert.ok(out.endsWith('@'), `輸入[${s}]輸出[${out}]`)
                        }
                        assert.ok(out.indexOf('QQ') < 0, `輸入[${s}]輸出[${out}]含帳密標記`)
                    }
                }
            }
        }
        assert.ok(n > 1500, `組合數 ${n}`)
    })

})

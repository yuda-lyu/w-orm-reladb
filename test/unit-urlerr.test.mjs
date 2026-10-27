import assert from 'assert'
import { execFile } from 'child_process'
import wo from '../src/WOrmReladb.mjs'


//rulebook R17-6: 建構函式對不合格opt.url之例外訊息(throwUrlErr, 共7個呼叫點)不得回顯帳號與密碼
//  訊息前綴(如invalid host in opt.url)與Error型態不變; 回顯之url一律為 <scheme>://***@<host[:port]>:
//    有@時把://與最後一個@之間(帳密)換成***; scheme須為識別字, host[:port]須為主機位址樣式, 否則該段換成***;
//    無@(解析不完整, 如host:1433會被當成帳密)只回 <scheme>://***; 無://則整段換成***
//不連線(只建構), 不需外部服務


let USER = 'Zuser9'
let PW = 'Zpw7'
let TOKENS = [USER, PW, 'Zp@ss7', 'ss7', 'Zq1', 'Zhost9', 'Za', 'Zb', 'Zc', 'Zuserpw7', 'Zonly7']


let build = (url, ex = {}) => {
    try {
        wo({ url, ...ex })
        return null
    }
    catch (err) {
        return err
    }
}


//cases: [呼叫點, 訊息前綴, opt.url, 預期回顯, 額外選項]
//呼叫點: S1 no dialect, S2 invalid dialect, S3 invalid username or password, S4 invalid username, S5 invalid password, S6 invalid host, S7 invalid port
let P = {
    S1: 'no dialect in opt.url',
    S2: 'invalid dialect in opt.url',
    S3: 'invalid username or password in opt.url',
    S4: 'invalid username in opt.url',
    S5: 'invalid password in opt.url',
    S6: 'invalid host in opt.url',
    S7: 'invalid port in opt.url',
}
let cases = [
    //S1: 去掉scheme後以://開頭(dialect為空字串)
    ['S1', `://${USER}:${PW}@db.local:1433`, '://***@db.local:1433'],
    ['S1', '://Zonly7', '://***'],
    //S2: scheme不在白名單; 含無://、反向、多個@、大小寫
    ['S2', `oracle://${USER}:${PW}@db.local:1433`, 'oracle://***@db.local:1433'],
    ['S2', `${USER}:${PW}@db.local:1433`, '***'],
    ['S2', 'Zonly7', '***'],
    ['S2', 'oracle://Zuser9:Zp@ss7@db.local:1433', 'oracle://***@db.local:1433'],
    ['S2', `oracle://db.local:1433@${USER}:${PW}`, 'oracle://***@***'],
    ['S2', `MSSQL://${USER}:${PW}@db.local:1433`, 'MSSQL://***@db.local:1433'],
    ['S2', `${USER}:${PW}@db.local://x`, '***://***'],
    ['S2', `bad scheme://${USER}:${PW}@db.local:1433`, '***://***@db.local:1433'],
    //S3: 帳密段不是 帳號:密碼 兩段
    ['S3', 'mssql://Zuserpw7@db.local:1433', 'mssql://***@db.local:1433'],
    ['S3', 'mssql://Za:Zb:Zc@db.local:1433', 'mssql://***@db.local:1433'],
    ['S3', 'mssql://Zonly7', 'mssql://***'],
    ['S3', 'sqlite://Zonly7@', 'sqlite://***@'],
    //S4: 帳號為空(非sqlite, 或sqlite加密)
    ['S4', `mssql://:${PW}@db.local:1433`, 'mssql://***@db.local:1433'],
    ['S4', `sqlite://:${PW}@`, 'sqlite://***@', { useEncryption: true }],
    //S5: 密碼為空
    ['S5', `mssql://${USER}:@db.local:1433`, 'mssql://***@db.local:1433'],
    ['S5', `sqlite://${USER}:@`, 'sqlite://***@', { useEncryption: true }],
    //S6: host為空; 含無@之host:port(被當成帳密解析)
    ['S6', `mssql://${USER}:${PW}@:1433`, 'mssql://***@:1433'],
    ['S6', `mssql://${USER}:${PW}@`, 'mssql://***@'],
    ['S6', 'mssql://Zhost9:1433', 'mssql://***'],
    ['S6', 'mssql://Zuser9:Zpw7@@db.local:1433', 'mssql://***@db.local:1433'],
    //S7: port為空; 含多個@、查詢字串、空白、IPv6
    ['S7', `mssql://${USER}:${PW}@db.local`, 'mssql://***@db.local'],
    ['S7', 'mssql://Zuser9:Zp@ss7@db.local:1433', 'mssql://***@db.local:1433'],
    ['S7', `mssql://${USER}:${PW}@db.local?pw=Zq1`, 'mssql://***@db.local'],
    ['S7', `mssql://${USER}:${PW}@db.local/db?pw=Zq1`, 'mssql://***@db.local'],
    ['S7', `mssql://${USER}:${PW}@db local`, 'mssql://***@***'],
    ['S7', `mssql://${USER}:${PW}@[::1]`, 'mssql://***@[::1]'],
    ['S7', `mssql://${USER}:${PW}@db.local:`, 'mssql://***@db.local:'],
]


describe('throwUrlErr(R17-6): opt.url不合格之例外訊息不回顯帳密', function() {

    for (let [site, url, expectUrl, ex] of cases) {
        it(`${site} ${JSON.stringify(url)} → 訊息前綴不變、回顯為 ${expectUrl}、帳密原文不出現`, function() {
            let err = build(url, ex)
            assert.ok(err instanceof Error, `未拋出Error: ${err}`)
            assert.strictEqual(Object.getPrototypeOf(err), Error.prototype, '須為Error本身(型態不變)')
            assert.strictEqual(err.message, `${P[site]}, opt.url[${expectUrl}]`)
            let all = `${err.message}\n${err.stack}`
            for (let t of TOKENS) {
                assert.ok(all.indexOf(t) < 0, `訊息或堆疊含帳密原文[${t}]: ${err.message}`)
            }
        })
    }

    it('7個呼叫點各至少1案(涵蓋全部前綴)', function() {
        let sites = new Set(cases.map((v) => v[0]))
        assert.deepStrictEqual([...sites].sort(), Object.keys(P).sort())
        for (let site of sites) {
            let n = cases.filter((v) => v[0] === site).length
            assert.ok(n >= 1, site)
        }
    })

    it('合格之opt.url照常建構(不拋錯): mssql與sqlite', function() {
        assert.strictEqual(build(`mssql://${USER}:${PW}@db.local:1433`), null)
        assert.strictEqual(build('sqlite://:'), null)
        assert.strictEqual(build(`sqlite://${USER}:${PW}@:`), null)
        assert.strictEqual(build(`sqlite://${USER}:${PW}@:`, { useEncryption: true }), null)
    })

    it('孤立代理碼元之opt.url: 前綴不變且不回顯值(R13, 先於url解析)', function() {
        let err = build(`mssql://${USER}:${PW}@db.local:1433\uD800`)
        assert.ok(err instanceof Error)
        assert.strictEqual(err.message, 'invalid opt.url: string contains lone surrogate')
    })

    it('未捕獲時Node輸出至stderr之內容亦不含帳密(實際以子行程建構且不捕獲)', async function() {
        let run = (url) => {
            return new Promise((resolve) => {
                execFile(process.execPath, ['test/tools/urlerrWorker.mjs', url], { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
                    resolve({ code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr) })
                })
            })
        }
        let r = await run(`mssql://${USER}:${PW}@db.local`)
        assert.notStrictEqual(r.code, 0, '未捕獲之例外應使行程非0結束')
        assert.ok(r.stderr.indexOf('invalid port in opt.url, opt.url[mssql://***@db.local]') >= 0, r.stderr.slice(0, 600))
        for (let t of TOKENS) {
            assert.ok(r.stderr.indexOf(t) < 0 && r.stdout.indexOf(t) < 0, `未捕獲之輸出含帳密原文[${t}]`)
        }
        let r2 = await run(`oracle://${USER}:${PW}@db.local:1433`)
        assert.ok(r2.stderr.indexOf('invalid dialect in opt.url, opt.url[oracle://***@db.local:1433]') >= 0, r2.stderr.slice(0, 600))
        for (let t of TOKENS) {
            assert.ok(r2.stderr.indexOf(t) < 0, `未捕獲之輸出含帳密原文[${t}]`)
        }
    })

})

import assert from 'assert'
import { createRequire } from 'module'
import wo from '../src/WOrmReladb.mjs'


//rulebook R21(td01, 2026-11-09): MSSQL連線預設加密 — 真後端之實測(自api-mssql.test.mjs以該檔之容器呼叫; 假伺服器之案見api-tdsencrypt.test.mjs)
//  R21-7 以預設連線選項(經本套件, 不外露任何加密選項)開啟之連線, 於伺服器端查得 sys.dm_exec_connections.encrypt_option 為 TRUE(連線實際經TLS加密)
//        對照: 驅動直連並顯式encrypt:false之連線, 同一查詢為 FALSE(證明查詢能分辨加密與否, 上列TRUE非空轉)
//  測試容器(SQL Server 2022)支援加密(伺服器自行產生憑證), 故本套件之測試設定不需、也不使用encrypt:false(對照案除外, 見R21-8)


let require = createRequire(import.meta.url)
let tedious = require('tedious')


//connectConn, 連線完成(失敗則reject)
let connectConn = (c) => new Promise((resolve, reject) => {
    c.connect((err) => {
        if (err) {
            reject(err)
        }
        else {
            resolve()
        }
    })
})

//closeConn, 關閉連線並等待end
let closeConn = (c) => new Promise((resolve) => {
    c.on('end', resolve)
    c.close()
})

//openDirect, 以驅動直連(顯式關閉加密), 連線保持開啟直到close
let openDirect = async (info, appName) => {
    let c = new tedious.Connection({
        server: info.host,
        authentication: { type: 'default', options: { userName: info.username, password: info.password } },
        //R21-8 encrypt:false: 對照案, 令此連線不加密以驗證encrypt_option查詢能分辨FALSE; 僅供測試, 不屬本套件之連線設定
        options: { port: info.port, database: info.database, trustServerCertificate: true, encrypt: false, appName, connectTimeout: 30000 },
    })
    c.on('error', () => {})
    await connectConn(c)
    return { close: () => closeConn(c) }
}


/**
 * 定義連線實際加密之守則套組
 *
 * @param {String} label 輸入後端名稱字串, 供describe標題使用
 * @param {Function} getOpt 輸入取得建構設定之函數
 * @param {Object} hooks 輸入後端專屬之hook: encInfo({ pid })回傳該行程(以驅動登入時回報之行程號辨識)之各連線之[{ app, enc }](program_name與encrypt_option); getDirect()回傳直連資訊{ host, port, username, password, database }
 */
export function defineTdsEncryptRealSuites(label, getOpt, hooks) {

    describe(`${label} 連線實際加密(R21)`, function() {

        this.timeout(300000)

        it('R21-7 預設連線選項(經本套件)之連線於伺服器端為encrypt_option=TRUE; 對照: 顯式關閉加密之直連為FALSE', async function() {
            let w = wo(getOpt())
            let si = await w.init()
            let t = null
            let ctrl = null
            try {
                assert.strictEqual(si.err, null, String(si.err))
                t = await w.genTransaction() //開啟交易: 連線保持於本行程直到rollback, 供伺服器端查詢
                ctrl = await openDirect(hooks.getDirect(), 'td01-ctrl')
                let rows = await hooks.encInfo({ pid: process.pid })
                let mine = rows.filter((r) => r.app === 'Tedious') //本套件(經sequelize)之連線: 驅動預設之program_name
                let other = rows.filter((r) => r.app === 'td01-ctrl')
                assert.ok(mine.length >= 1, `應查得本套件之連線(program_name=Tedious): ${JSON.stringify(rows)}`)
                assert.ok(mine.every((r) => r.enc === 'TRUE'), `本套件之連線應皆加密: ${JSON.stringify(rows)}`)
                assert.strictEqual(other.length, 1, `應查得對照連線: ${JSON.stringify(rows)}`)
                assert.strictEqual(other[0].enc, 'FALSE', `顯式關閉加密之對照連線應為不加密(查詢能分辨): ${JSON.stringify(rows)}`)
            }
            finally {
                if (ctrl) {
                    await ctrl.close()
                }
                if (t) {
                    await t.rollback()
                }
                await si.close()
            }
        })

    })

}

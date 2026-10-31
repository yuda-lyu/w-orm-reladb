import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'


//rulebook R18(第 209 項): 本套件不自建驅動連線(src 僅經 sequelize), 連線於空檔被後端中斷時之行程存活, 依賴 sequelize 之連線管理在連線建立後永久掛'error'監聽
//(mssql 之 tedious、mysql 之 mysql2、mariadb 之 mariadb、postgres 之 pg 之連線物件, 皆為 EventEmitter, 無監聽者之'error'事件即未捕捉例外)
//  R18-5 依賴盤點: 已安裝之 sequelize(主版本 6)之四個網路方言之 connection-manager 皆於連線建立後掛永久'error'監聽並自連線池移除該連線(this.pool.destroy(connection))
//  R18-6 判定式之負向對照: 無此監聽或只有連線建立期間之 once 監聽者, 判定為否(證明 R18-5 非空轉)
//註: 本檔只讀原始碼(盤點), 不證明行為; 行為以真後端驗證者見 api-connerr(mssql); postgres、mysql、mariadb 之驅動非本套件之依賴, 其真後端實測見 sgud/exp/experience.md 之第 209 項紀錄(一次性探測, 腳本未入庫)


let require = createRequire(import.meta.url)
let dirSeq = path.dirname(require.resolve('sequelize/package.json'))
let verSeq = JSON.parse(fs.readFileSync(path.join(dirSeq, 'package.json'), 'utf8')).version

let NET_DIALECTS = ['mssql', 'mysql', 'mariadb', 'postgres']


//hasPermanentErrListener, 連線建立後之永久'error'監聽(非連線建立期間之once/connection2), 其後於400字元內自連線池移除該連線
let hasPermanentErrListener = (src) => /\bconnection\.on\(\s*["']error["'][\s\S]{0,400}?pool\.destroy\(connection\)/.test(src)


let readManager = (d) => fs.readFileSync(path.join(dirSeq, 'lib', 'dialects', d, 'connection-manager.js'), 'utf8')


describe('連線空檔中斷之依賴盤點(R18)', function() {

    it('R18-5 sequelize主版本為6(本盤點之適用範圍; 升級至其他主版本須重新盤點並跑 api-connerr)', function() {
        assert.ok(/^6\./.test(verSeq), `sequelize ${verSeq}`)
    })

    for (let d of NET_DIALECTS) {
        it(`R18-5 ${d}: connection-manager 於連線建立後永久掛'error'監聽並自連線池移除該連線(sequelize ${verSeq})`, function() {
            assert.ok(hasPermanentErrListener(readManager(d)), `${d}之connection-manager無永久之error監聽: 驅動於空檔中斷時發出之error事件將無人監聽而使行程終止`)
        })
    }

    it('R18-6 判定式之負向對照: 移除該監聽、僅有連線建立期間之once監聽者、監聽不在連線池移除之前後時皆判定為否', function() {
        for (let d of NET_DIALECTS) {
            let src = readManager(d)
            assert.ok(hasPermanentErrListener(src), d)
            //移除永久監聽(改名為他事件)
            let removed = src.replace(/\bconnection\.on\(\s*(["'])error\1/, 'connection.on("closeX"')
            assert.notStrictEqual(removed, src, `${d}: 變異未套用`)
            assert.strictEqual(hasPermanentErrListener(removed), false, `${d}: 移除監聽後仍判為有`)
            //僅連線建立期間之once監聽者(連線建立後無永久監聽)
            let onlyOnce = src.replace(/\bconnection\.on\(\s*(["'])error\1/, 'connection.once("error"')
            assert.strictEqual(hasPermanentErrListener(onlyOnce), false, `${d}: 僅once監聽者仍判為有`)
            //不自連線池移除該連線
            let noDestroy = src.replace(/pool\.destroy\(connection\)/g, 'noop(connection)')
            assert.strictEqual(hasPermanentErrListener(noDestroy), false, `${d}: 不移除連線仍判為有`)
        }
    })

})

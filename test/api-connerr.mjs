import assert from 'assert'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'


//rulebook R18(第 209 項): 連線於空檔(無進行中語句)被後端中斷時, 驅動於連線物件發出'error'事件; 本套件不自建驅動連線(皆經sequelize),
//sequelize 6 於mssql、mysql、mariadb、postgres之連線建立後皆永久掛'error'監聽(見 unit-connerr 之盤點), 故行程不終止、該次操作以既有失敗通道reject、其後操作重新取得連線
//本檔為真後端之守則(自 api-mssql.test.mjs 以該檔之容器呼叫): 各情境以獨立子行程(test/tools/connErrScenario.mjs)執行, 因未捕捉例外會使行程終止, 在mocha行程內無從分辨
//  R18-0 對照(不中斷): 情境本身正常, 無'error'事件
//  R18-1 空檔: 池內閒置連線被中斷 → 'error'事件發出且該連線已有監聽者, 行程存活, 其後操作成功
//  R18-2 交易開啟後閒置被中斷 → 同上; 以該交易之操作reject(不可查詢), 之後之操作成功
//  R18-3 對照: 語句進行中被中斷 → 該語句reject, 行程存活, 其後操作成功
//  R18-4 負向對照: 移除驅動連線上之'error'監聽後空檔中斷 → 行程因未捕捉之'error'事件終止(事件發出時監聽者數為0); 證明情境確會造成行程終止, R18-1 之綠非空轉


let scenarioFile = fileURLToPath(new URL('./tools/connErrScenario.mjs', import.meta.url))


//runScenario, 以子行程執行情境; 子行程印出READY後由kill(hook, 依後端而異)令其連線被終止
let runScenario = (spec, kill) => new Promise((resolve) => {
    let ch = spawn(process.execPath, [scenarioFile, JSON.stringify(spec)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let so = ''
    let se = ''
    let killed = null
    let killErr = null
    let triggered = false
    let killP = Promise.resolve() //終止之執行: 子行程可能於KILL生效後立即崩潰(負向對照), 故結束時須等它完成才取killed
    ch.stdout.on('data', (d) => {
        so += d
        let m = triggered ? null : /READY:(\{[^\n]*\})/.exec(so)
        if (m) {
            triggered = true
            if (spec.scenario === 'none') {
                return
            }
            killP = Promise.resolve()
                .then(() => kill({ pid: JSON.parse(m[1]).pid, scenario: spec.scenario }))
                .then((n) => {
                    killed = n
                }, (err) => {
                    killErr = err
                    ch.kill()
                })
        }
    })
    ch.stderr.on('data', (d) => {
        se += d
    })
    let to = setTimeout(() => ch.kill(), 240000)
    ch.on('close', async (code) => {
        clearTimeout(to)
        await killP
        let line = so.split('\n').find((l) => l.indexOf('RESULT:') === 0)
        let result = line ? JSON.parse(line.slice(7)) : null
        let evts = so.split('\n').filter((l) => l.indexOf('EVT:') === 0).map((l) => JSON.parse(l.slice(4)))
        resolve({ code, so, se, killed, killErr, result, evts })
    })
})


let UNHANDLED = /Unhandled 'error' event/


/**
 * 定義連線空檔中斷之守則套組
 *
 * @param {String} label 輸入後端名稱字串, 供describe標題使用
 * @param {Function} getOpt 輸入取得建構設定之函數
 * @param {Object} hooks 輸入後端專屬之hook: kill({ pid, scenario })令該行程(以驅動登入時回報之行程號辨識)之全部連線於後端被終止, 回傳被終止之連線數; sleepSql為語句進行中情境用之長時間語句
 */
export function defineConnErrSuites(label, getOpt, hooks) {

    describe(`${label} 連線空檔中斷(R18)`, function() {

        this.timeout(300000)

        let run = (scenario, ex = {}) => runScenario({ opt: getOpt(), scenario, sleepSql: hooks.sleepSql, ...ex }, hooks.kill)

        //assertRecovered, 其後之操作皆成功(連線池重新取得連線), 實例可關閉
        let assertRecovered = (r) => {
            for (let k of ['warm', 'after1', 'after2', 'noInstance']) {
                assert.ok(typeof r.result[k].ok === 'string' && r.result[k].ok.indexOf('array(') === 0, `${k}應成功(重新取得連線): ${JSON.stringify(r.result[k])}`)
            }
            assert.ok('ok' in r.result.closed, `close應成功: ${JSON.stringify(r.result.closed)}`)
        }

        it('R18-0 對照(不中斷): 子行程正常結束, 無任何error事件, 各操作成功', async function() {
            let r = await run('none')
            assert.strictEqual(r.code, 0, r.se.slice(0, 600))
            assert.strictEqual(r.killErr, null)
            assert.deepStrictEqual(r.result.events, [])
            assertRecovered(r)
        })

        it('R18-1 空檔: 池內閒置連線被後端中斷 → error事件發出且該連線已有監聽者, 行程存活(離開碼0、stderr無未捕捉事件), 其後操作成功', async function() {
            let r = await run('idle')
            assert.strictEqual(r.killErr, null, String(r.killErr))
            assert.ok(r.killed >= 1, `後端應終止至少1條連線: ${r.killed}`)
            assert.strictEqual(r.code, 0, r.se.slice(0, 600))
            assert.ok(!UNHANDLED.test(r.se), r.se.slice(0, 600))
            assert.strictEqual(r.result.errSeen, true, '應觀察到驅動於空檔發出error事件(否則情境未觸及空檔路徑)')
            assert.ok(r.result.events.length >= 1 && r.result.events.every((e) => e.n >= 1), JSON.stringify(r.result.events))
            assertRecovered(r)
        })

        it('R18-2 交易開啟後閒置被中斷 → error事件已有監聽者, 行程存活; 以該交易之操作與rollback皆reject(失敗通道), 之後之操作成功', async function() {
            let r = await run('tx')
            assert.strictEqual(r.killErr, null, String(r.killErr))
            assert.ok(r.killed >= 1, `後端應終止至少1條連線: ${r.killed}`)
            assert.strictEqual(r.code, 0, r.se.slice(0, 600))
            assert.ok(!UNHANDLED.test(r.se), r.se.slice(0, 600))
            assert.strictEqual(r.result.errSeen, true)
            assert.ok(r.result.events.length >= 1 && r.result.events.every((e) => e.n >= 1), JSON.stringify(r.result.events))
            assert.ok(typeof r.result.txSelect.rej === 'string', `以失效交易之select應reject: ${JSON.stringify(r.result.txSelect)}`)
            assert.ok(typeof r.result.txRollback.rej === 'string', `失效交易之rollback應reject: ${JSON.stringify(r.result.txRollback)}`)
            assertRecovered(r)
        })

        it('R18-3 對照: 語句進行中被中斷 → 該語句reject, 行程存活, 其後操作成功(驅動把錯誤交給語句)', async function() {
            let r = await run('inflight')
            assert.strictEqual(r.killErr, null, String(r.killErr))
            assert.ok(r.killed >= 1, `後端應終止至少1條連線: ${r.killed}`)
            assert.strictEqual(r.code, 0, r.se.slice(0, 600))
            assert.ok(!UNHANDLED.test(r.se), r.se.slice(0, 600))
            assert.ok(typeof r.result.inflight.rej === 'string', `進行中之語句應reject: ${JSON.stringify(r.result.inflight)}`)
            assert.ok(r.result.events.every((e) => e.n >= 1), JSON.stringify(r.result.events))
            assertRecovered(r)
        })

        it('R18-4 負向對照: 移除驅動連線上之error監聽後, 空檔中斷使行程因未捕捉之error事件終止(事件發出時監聽者數為0) → 情境確會造成行程終止, R18-1之綠非空轉', async function() {
            let r = await run('idle', { strip: true })
            assert.strictEqual(r.killErr, null, String(r.killErr))
            assert.ok(r.killed >= 1, `後端應終止至少1條連線: ${r.killed}`)
            assert.notStrictEqual(r.code, 0, `移除監聽後行程應終止, 卻正常結束: ${r.so.slice(-400)}`)
            assert.ok(UNHANDLED.test(r.se), `stderr應為未捕捉之error事件: ${r.se.slice(0, 600)}`)
            assert.ok(r.evts.some((e) => e.n === 0), `應有error事件於0監聽者時發出: ${JSON.stringify(r.evts)}`)
            assert.strictEqual(r.result, null, '行程已終止, 不應有RESULT')
        })

    })

}

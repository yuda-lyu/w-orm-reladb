//子行程情境(供api-connerr): 以真驅動(經sequelize)與真後端, 令WOrmReladb之連線於空檔(無進行中語句)或語句進行中被後端中斷, 回報行程是否存活與各操作之結果;
//須獨立行程: 驅動於連線中斷時發出之'error'事件若無人監聽即為未捕捉例外而使行程終止, 在mocha行程內只會被當成該測試失敗而無法分辨「行程崩潰」與stderr內容
//用法: node connErrScenario.mjs <JSON規格>; 規格 { opt, scenario, strip, sleepSql }
//  scenario:
//    'idle'     連線池內之閒置連線(第一次select後歸還池中)被中斷
//    'tx'       genTransaction取得之連線(開啟交易後閒置)被中斷
//    'inflight' 語句進行中被中斷(對照組: 驅動把錯誤交給該語句, 通常無'error'事件)
//    'none'     不中斷(情境本身之對照)
//  strip: true者於中斷之前移除該連線上之全部'error'監聽(負向對照: 證明中斷確實會使行程終止, 即本守則非空轉)
//  sleepSql: inflight用之長時間語句
//協定: 情境就緒後於stdout印一行'READY:{"pid":<行程號>}'(由父行程據此令後端終止該行程之連線); 其後等到'error'事件被處理(事件同步, 非固定延時)再續行;
//輸出: 'EVT:<JSON>' 每次'error'事件發出時之監聽者數(n, 0者將使行程終止); 最後一行'RESULT:<JSON>'; 行程正常結束離開碼為0, 崩潰時由node印錯誤至stderr並以非0結束
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import wo from '../../src/WOrmReladb.mjs'


let spec = JSON.parse(process.argv[2])
let { opt, scenario, strip = false, sleepSql } = spec

//觀察EventEmitter.prototype.emit(僅記錄, 不改變行為): 'error'事件發出時之監聽者數; 以同步寫出(崩潰前亦留下紀錄)
let events = []
let onHandled = null
let handled = new Promise((resolve) => {
    onHandled = resolve
})
let origEmit = EventEmitter.prototype.emit
EventEmitter.prototype.emit = function(type, ...a) {
    let isErr = type === 'error'
    if (isErr) {
        let rec = {
            ctor: this && this.constructor ? this.constructor.name : '?',
            n: this.listenerCount('error'),
            code: a[0] && a[0].code,
        }
        events.push(rec)
        fs.writeSync(1, 'EVT:' + JSON.stringify(rec) + '\n')
    }
    let r = origEmit.call(this, type, ...a)
    if (isErr) {
        onHandled() //未拋出(有監聽者)才會走到此
    }
    return r
}

let settle = (p) => p.then((v) => ({ ok: Array.isArray(v) ? `array(${v.length})` : typeof v }), (e) => ({ rej: String((e && e.message) || e).slice(0, 160) }))

let w = wo(opt)
await w.createStorage()
let si = await w.init()
if (si.err) {
    throw new Error(si.err)
}
let out = { scenario, strip }

//warm, 令連線池內有一條已建立之連線
out.warm = await settle(w.select({}, { instance: si }))
let sq = si.mds[opt.cl].sequelize

//strip, 取出池內唯一之連線移除其'error'監聽後歸還
if (strip) {
    let cm = sq.connectionManager
    let c = await cm.getConnection({ type: 'read' })
    out.listenersBefore = c.listenerCount('error')
    c.removeAllListeners('error')
    out.listenersAfter = c.listenerCount('error')
    await cm.releaseConnection(c)
}

let t = null
if (scenario === 'tx') {
    t = await w.genTransaction()
}
let inflight = null
if (scenario === 'inflight') {
    inflight = settle(sq.query(sleepSql))
}

fs.writeSync(1, 'READY:' + JSON.stringify({ pid: process.pid }) + '\n')

//等中斷之結果(中斷由父行程於READY後執行): 空檔情境等'error'事件被處理(驅動只在無進行中語句時發此事件), 語句進行中等該語句settle(驅動把錯誤交給語句, 不一定有'error'事件); 僅設保底逾時以免父行程失敗時懸置
if (inflight) {
    out.inflight = await inflight
}
else if (scenario !== 'none') {
    let dead = new Promise((resolve) => {
        setTimeout(() => resolve(false), 60000).unref()
    })
    out.errSeen = await Promise.race([handled.then(() => true), dead])
}
out.events = events.map((e) => ({ ...e }))
if (scenario === 'tx') {
    out.txSelect = await settle(w.select({}, { instance: si, transaction: t }))
    out.txRollback = await settle(t.rollback())
}
out.after1 = await settle(w.select({}, { instance: si }))
out.after2 = await settle(w.select({}, { instance: si }))
out.closed = await settle(si.close())
out.noInstance = await settle(w.select({}))

fs.writeSync(1, 'RESULT:' + JSON.stringify(out) + '\n')
process.exit(0)

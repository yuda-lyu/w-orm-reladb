import wo from '../../src/WOrmReladb.mjs'


//子行程情境(rulebook R19, 第 210 項): sqlite 之 storage 無法開啟時各函數須 settle
//用法: node sqliteOpenScenario.mjs <JSON>, JSON 為 { fdModels, steps: [{ id, op, storage, url?, bg?, reuse? }] }; 各步驟依序啟動, 每步結果一行 JSON 寫至 stdout:
//  { id, op, state: 'resolve' | 'reject' | 'pending', value | message }, 全部步驟啟動並等完後寫 { done: true }
//  bg 為 true 之步驟只啟動不等待(其結果於 settle 時才寫出), 供驗證「一個懸置不得擋住其後之步驟」; reuse 為 true 之步驟沿用上一步驟之實例(同實例重複呼叫)
//懸置之判定以事件為準(不用牆鐘看門狗): 懸置之 Promise 不持有事件迴圈, 其後迴圈排空而觸發 beforeExit, 此時仍未 settle 之步驟即回報 pending
//(缺陷版之 sequelize.close() 對開啟失敗之 Database 永不回呼, 迴圈即排空; 若仍有他物撐住迴圈, 由父行程之外層逾時兜底, 該上限只防懸置、不表達規格)
//各步驟皆為獨立之新實例(同一行程, 故共用模組層級之 pmq 佇列: 一個懸置會擋住其後所有實例之 useStable 操作)


let spec = JSON.parse(process.argv[2])
let fdModels = spec.fdModels

let pend = new Map() //進行中(未 settle)之步驟, beforeExit 時據以回報 pending


let emit = (o) => {
    process.stdout.write(JSON.stringify(o) + '\n')
}


let msgOf = (err) => {
    if (err && typeof err.message === 'string') {
        return err.message
    }
    return String(err)
}


//各 op 之呼叫; 數據固定, 不含需遮罩之值
let OPS = {
    createStorage: (w) => w.createStorage(),
    select: (w) => w.select({}),
    selectByPk: (w) => w.selectByPk('a'),
    insert: (w) => w.insert({ id: 'a', name: 'n' }),
    insertBulk: (w) => w.insertBulk([{ id: 'a', name: 'n' }]),
    save: (w) => w.save({ id: 'a', name: 'n' }),
    del: (w) => w.del({ id: 'a' }),
    delAll: (w) => w.delAll(),
    //init 傳回之 close(使用端自行關閉): 以 init 之實例進行 select 後呼叫 close, 二者各自須 settle
    initClose: async (w) => {
        let si = await w.init()
        let rSel = null
        try {
            await w.select({}, { instance: si })
            rSel = 'resolve'
        }
        catch (err) {
            rSel = 'reject'
        }
        await si.close()
        return { select: rSel, closed: true }
    },
    //genTransaction 後經 init 之 close 關閉
    txClose: async (w) => {
        let si = await w.init()
        let rTx = null
        try {
            let t = await w.genTransaction()
            await t.rollback()
            rTx = 'resolve'
        }
        catch (err) {
            rTx = 'reject'
        }
        await si.close()
        return { tx: rTx, closed: true }
    },
}


process.on('beforeExit', () => {
    for (let st of pend.values()) {
        emit({ id: st.id, op: st.op, state: 'pending' })
    }
    pend.clear()
})


//mkW, 建立實例; reuse 為 true 之步驟沿用上一個步驟之實例(同實例重複呼叫)
let lastW = null
let mkW = (st) => {
    if (!(st.reuse && lastW !== null)) {
        lastW = wo({ url: st.url || 'sqlite://:', db: 'worm', cl: 'users', fdModels, storage: st.storage })
    }
    return lastW
}


//runStep, 執行單一步驟並寫出結果(不 reject)
async function runStep(st) {
    pend.set(st.id, st)
    let o
    try {
        let w = mkW(st)
        let v = await OPS[st.op](w)
        o = { id: st.id, op: st.op, state: 'resolve', value: v }
    }
    catch (err) {
        o = { id: st.id, op: st.op, state: 'reject', message: msgOf(err) }
    }
    pend.delete(st.id)
    emit(o)
}


async function main() {
    for (let st of spec.steps) {
        if (st.bg) {
            runStep(st)
        }
        else {
            await runStep(st)
        }
    }
    emit({ done: true })
}


main().catch((err) => {
    emit({ fatal: msgOf(err) })
})

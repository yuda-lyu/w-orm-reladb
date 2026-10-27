//診斷輸出測試(R17)之共用情境: 對一個WOrmReladb實例依序執行各操作(成功與失敗), 回傳各結果與事件payload, 供回傳契約之比對
//同一情境亦於修改前之程式(git HEAD)執行以產生固定預期值(golden), 故此檔不得依賴R17之任何新功能


let ID = 'u-secret-001@example.com'
let PW = 'S3cretPw'


let settle = async (pm) => {
    try {
        return { ok: await pm }
    }
    catch (err) {
        return { err: String(err && err.message ? err.message : err) }
    }
}


//scenario, withBadListener為true時change與error訂閱函數皆拋錯(觸發診斷輸出之站點)
async function scenario(w, withBadListener) {
    let evs = []
    w.on('change', (m, d, r) => {
        evs.push(['change', m, d, r])
        if (withBadListener) {
            throw new Error(`listener ${ID} ${PW}`)
        }
    })
    w.on('error', (m, d, e) => {
        evs.push(['error', m, d, e])
        if (withBadListener) {
            throw new Error(`listener ${ID} ${PW}`)
        }
    })
    let out = []
    out.push(await settle(w.delAll({})))
    out.push(await settle(w.insert([{ id: 'a1', name: 'n1', value: 1 }, { id: 'a2', name: 'n2', value: 2 }])))
    out.push(await settle(w.insert({ id: 'a1', name: 'dup' })))
    out.push(await settle(w.insertBulk([{ id: 'a1', name: 'dup' }])))
    out.push(await settle(w.save([{ id: 'a1', name: 'n1x' }, { id: 'a3', name: 'n3' }])))
    out.push(await settle(w.select({ id: 'a1' })))
    out.push(await settle(w.selectByPk('a2')))
    out.push(await settle(w.select({ $foo: 1 })))
    out.push(await settle(w.del({ id: 'a2' })))
    out.push(await settle(w.delAll({})))
    return { out, evs }
}


export { scenario, settle }

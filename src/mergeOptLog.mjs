function mergeOptLog(base, opt) {
    //診斷設定之快照{ logging, logDetail, funLog }: 以opt覆寫base, 回傳新快照(不改動base); 回傳之快照可直接作為wsemi之getDiag的opt
    //用於建構時(base為預設{ logging, logDetail: false, funLog: null }, opt為使用端之opt)與單次呼叫(如genModelsByDB的option覆寫建構時之快照)
    //各選項分別讀取; 型別正確者才覆寫(logging、logDetail須為布林, true與false皆可; funLog須為函數), 型別錯誤或讀取拋錯者沿用base: 設定錯誤不放寬輸出也不關閉輸出
    //註: funLog無法在單次呼叫改回無(null視同未給), 建構時給予者可被另一函數取代
    let r = { ...base }
    for (let k of ['logging', 'logDetail']) {
        try {
            let v = opt[k]
            if (typeof v === 'boolean') {
                r[k] = v
            }
        }
        catch (e) {
            //忽略
        }
    }
    try {
        let f = opt.funLog
        if (typeof f === 'function') {
            r.funLog = f
        }
    }
    catch (e) {
        //忽略
    }
    return r
}


export default mergeOptLog

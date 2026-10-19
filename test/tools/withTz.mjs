//withTz, 暫時切換主機時區(執行期設定process.env.TZ, Node會重設時區快取), 結束必還原; fn可為同步或非同步函數
//還原須以賦值而非delete: Windows上delete process.env.TZ不會還原主機時區(實測仍停在最後設定之時區), 故載入時先記下主機時區名稱


let hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone


let restore = (old) => {
    if (old !== undefined) {
        process.env.TZ = old
    }
    else if (process.platform === 'win32') {
        process.env.TZ = hostTz
    }
    else {
        delete process.env.TZ
    }
}


export let withTz = (tz, fn) => {
    let old = process.env.TZ
    process.env.TZ = tz
    let r
    try {
        r = fn()
    }
    catch (err) {
        restore(old)
        throw err
    }
    if (r && typeof r.then === 'function') {
        return r.then((v) => {
            restore(old)
            return v
        }, (err) => {
            restore(old)
            throw err
        })
    }
    restore(old)
    return r
}

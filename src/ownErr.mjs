//本套件以固定詞彙自行產生之錯誤之登記(R-DIAG, dspec〈診斷輸出與遮罩〉D3): 整批reject與error事件原樣交出, 不經diag.err——固定字串經遮罩挖空即可反推短密碼(如密碼為insert時invalid data被切碎);
//未登記之錯誤值(後端、驅動、model檔之hook、呼叫端數據之getter等外來值)由WOrmReladb一律經diag.err; 登記以物件身分為準(WeakSet), 不改動錯誤物件本身
const OWN = new WeakSet()


function ownErr(msg) {
    //產生並登記本套件之固定詞彙錯誤(訊息只含固定詞彙、索引、欄名與表名等識別字, 不含資料值與後端原文)
    let e = new Error(msg)
    OWN.add(e)
    return e
}


function markOwnErr(e) {
    //登記既有之錯誤物件(只用於恆以固定詞彙拋錯之檢核, 如wsemi之cvOrmFind: 呼叫端之例外已轉為固定原因), 回傳同一物件; 非物件原樣回傳(WeakSet不收)
    if (e !== null && typeof e === 'object') {
        OWN.add(e)
    }
    return e
}


function isOwnErr(v) {
    //是否為ownErr所產生之錯誤; 非物件為false(WeakSet.has對原始值回false, 不拋錯)
    return OWN.has(v)
}


export { ownErr, markOwnErr, isOwnErr }

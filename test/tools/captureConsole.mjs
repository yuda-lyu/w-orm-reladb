import util from 'util'


//captureConsole, 擷取console各方法之輸出(以util.format格式化, 與實際輸出一致), 供診斷輸出(R17)之測試共用
//  out: console.log、info、debug(stdout); err: console.warn、error(stderr); all: 依發生順序之全部
async function captureConsole(fn) {
    let out = []
    let err = []
    let all = []
    let ks = { log: out, info: out, debug: out, warn: err, error: err }
    let olds = {}
    for (let k of Object.keys(ks)) {
        olds[k] = console[k]
        console[k] = (...a) => {
            let s = util.format(...a)
            ks[k].push(s)
            all.push(s)
        }
    }
    let res
    try {
        res = await fn()
    }
    finally {
        for (let k of Object.keys(ks)) {
            console[k] = olds[k]
        }
    }
    return { res, out, err, all }
}


export default captureConsole

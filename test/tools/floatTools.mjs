//floatTools, 浮動時間(ctx.dateNoTz:'floating'、toFloating; CLAUDE_rulebook.md之R14)測試共用之預言機與輔助, 由unit-float.test.mjs與api-float.mjs引入
//預言機一律獨立於被測碼與process.env.TZ之本地getter: 以Intl.DateTimeFormat(timeZone: 名稱, ICU)取瞬間於目標時區之牆上分量; 字串形式之牆上分量即UTC分量
import assert from 'assert'


//時區矩陣, 10個: UTC、UTC+8、+5:30、+5:45、+12:45/+13:45(Chatham)、+14、美西(夏令)、美東(夏令)、聖保羅(-3)、-12
export let TZS = ['UTC', 'Asia/Taipei', 'Asia/Kolkata', 'Asia/Kathmandu', 'Pacific/Chatham', 'Pacific/Kiritimati', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Etc/GMT+12']

//有夏令之UTC+時區(柏林: 2026-03-29 02:00–03:00不存在; Lord Howe: 2026-10-04 02:00–02:30不存在, 半小時跳時), 供api層矩陣
export let TZS_DST_EAST = ['Europe/Berlin', 'Australia/Lord_Howe']


export let pad = (n, w = 2) => String(n).padStart(w, '0')


//utcOf, 分量[y,mo,d,h,mi,s,ms] -> 以UTC分量建構之Date(setUTCFullYear避開Date.UTC對0–99年之映射)
export let utcOf = (c) => {
    let t = new Date(0)
    t.setUTCFullYear(c[0], c[1] - 1, c[2])
    t.setUTCHours(c[3], c[4], c[5], c[6])
    return t
}

//wallIntl, 瞬間(毫秒)於時區tz之牆上分量[y,mo,d,h,mi,s,ms](ICU; 西元前以era換算)
export let wallIntl = (ms, tz) => {
    let f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', era: 'short' })
    let o = {}
    for (let x of f.formatToParts(new Date(ms))) {
        o[x.type] = x.value
    }
    let y = Number(o.year)
    if (o.era === 'BC' || o.era === 'B') {
        y = 1 - y
    }
    let msPart = ((ms % 1000) + 1000) % 1000
    return [y, Number(o.month), Number(o.day), Number(o.hour), Number(o.minute), Number(o.second), msPart]
}

//offIntl, 瞬間於時區tz之偏移(分鐘, UTC減本地, 與Date.getTimezoneOffset同號)
export let offIntl = (ms, tz) => Math.round((ms - utcOf(wallIntl(ms, tz)).getTime()) / 60000)

//tzSelfCheck, 切換時區後自證: 本地getter之偏移(冬、夏兩個日期)須與Intl之偏移一致, 否則時區切換未生效(如Windows啟動時給IANA名不生效), 測試無意義
export let tzSelfCheck = (tz) => {
    let sum = new Date(2026, 6, 1).getTimezoneOffset()
    let win = new Date(2026, 0, 1).getTimezoneOffset()
    assert.strictEqual(sum, offIntl(Date.UTC(2026, 6, 1, 0, 0, 0), tz), `${tz}: 時區切換未生效(夏季偏移)`)
    assert.strictEqual(win, offIntl(Date.UTC(2026, 0, 1, 0, 0, 0), tz), `${tz}: 時區切換未生效(冬季偏移)`)
}

//inYear, 浮動時間之牆上年須在1–9999
export let inYear = (y) => y >= 1 && y <= 9999

//wallNum, 牆上時間字串(YYYY-MM-DD[T 或空白]HH:mm:ss)-> 以UTC分量表示之整數, 與主機時區無關(Jet語意: 無時區、無夏令, 供比較)
export let wallNum = (s) => {
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/)
    assert.ok(m !== null, `牆上時間格式: ${s}`)
    return utcOf([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), 0]).getTime()
}

//mkLocal, 以本地分量建構Date(含年0–99之完整年份), 夏令跳過之時刻由JS正規化
export let mkLocal = (y, mo, d, h = 0, mi = 0, s = 0) => {
    let t = new Date(2000, 0, 1, 0, 0, 0, 0)
    t.setFullYear(y, mo - 1, d)
    t.setHours(h, mi, s, 0)
    return t
}

//wallOfDate, Date之本地分量 -> 牆上時間字串(Date/epoch條件於Jet語意下之牆上時間)
export let wallOfDate = (d) => `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

//cmpOk, 比較運算子的預言機
export let cmpOk = (op, a, b) => {
    return op === '$lt' ? a < b : op === '$lte' ? a <= b : op === '$gt' ? a > b : op === '$gte' ? a >= b : op === '$eq' ? a === b : a !== b
}

export let OPS = ['$lt', '$lte', '$gt', '$gte', '$eq', '$ne']

//WALL, Jet之牆上時間(固定格式字串; null為NULL列): 哨兵9999、年0100、美東夏令跳過/重疊、柏林與Lord Howe之夏令跳過
export let WALL = [
    '2020-01-01 00:00:00', '2026-10-19 23:59:59', '2026-10-20 00:00:00', '2026-10-20 12:34:56', '2026-12-31 23:59:59', '2027-01-01 00:00:00', '2099-01-01 00:00:00',
    '9999-12-31 00:00:00', '9999-12-31 12:00:00', '9999-12-31 23:59:59', '0100-01-01 00:00:00', '0100-01-01 12:00:00',
    '2026-03-08 01:59:59', '2026-03-08 03:00:00', '2026-11-01 00:59:59', '2026-11-01 01:30:00', '2026-11-01 02:00:00',
    '2026-03-29 02:30:00', '2026-10-04 02:15:00', null,
]

//CONDS, 條件值(牆上時間意義[牆上時間, 值形式]): 字串(無時區)、本地分量建構之Date、其epoch
export let CONDS = [
    ['2026-10-20 00:00:00', 'str'], ['9999-12-31 23:59:59', 'str'], ['2020-01-01 00:00:00', 'str'], ['2099-01-01 00:00:00', 'str'], ['0100-01-01 00:00:00', 'str'],
    ['2026-03-08 02:30:00', 'str'], ['2026-11-01 01:30:00', 'str'], ['9999-12-31 00:00:00', 'str'], ['2026-12-31 23:59:59', 'str'],
    ['2026-10-20 00:00:00', 'date'], ['9999-12-31 23:59:59', 'date'], ['2020-01-01 00:00:00', 'date'], ['0100-01-01 00:00:00', 'date'], ['2026-11-01 01:30:00', 'date'],
    ['2026-10-20 00:00:00', 'epoch'], ['9999-12-31 23:59:59', 'epoch'],
    ['2026-03-29 03:00:00', 'str'], ['2026-10-04 02:30:00', 'str'],
]

//condVal, 依值形式產生條件值(Date/epoch以本地分量建構, 須於withTz內呼叫)
export let condVal = (w, kind) => {
    if (kind === 'str') {
        return w.replace(' ', 'T')
    }
    let m = w.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
    let d = mkLocal(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    return kind === 'date' ? d : d.getTime()
}

//condWall, 預言機之條件牆上時間: 字串即其自身; Date/epoch為其本地分量(夏令跳過之時刻mkLocal已被JS正規化, 以結果Date之本地分量為準)
export let condWall = (w, kind) => {
    if (kind === 'str') {
        return w
    }
    let v = condVal(w, kind)
    return wallOfDate(kind === 'date' ? v : new Date(v))
}

//wantIdx, 預言機: 牆上時間數值比較(Jet語意), 回傳命中之WALL索引
export let wantIdx = (op, cw) => {
    return WALL.map((x, i) => [x, i]).filter(([x]) => x !== null && cmpOk(op, wallNum(x), wallNum(cw))).map(([, i]) => i)
}

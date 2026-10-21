import assert from 'assert'
import vm from 'vm'
import Sequelize from 'sequelize'
import cvFind, { toFloating } from '../src/cvFind.mjs'
import { withTz } from './tools/withTz.mjs'
import { TZS, TZS_DST_EAST, pad, utcOf, wallIntl, tzSelfCheck, inYear } from './tools/floatTools.mjs'


//第87項批B1(CLAUDE_rulebook.md之R14): ctx.dateNoTz:'floating'與匯出toFloating, 本檔不連線資料庫
//  toFloating輸入空間表: 10個時區各146格(值形式10類, 邊界牆上時間11個) = 1460格, 預言機為Intl(ICU), 獨立於process.env.TZ之本地getter; 每時區先自證偏移
//  cvFind之值域、語意、與'local'之差異、契約①(編碼後之浮動Date不可再當輸入)
//命中集合之語意(時區矩陣、哨兵、契約②④之混用)由test/api-float.mjs於sqlite與mssql實際執行斷言


let DT = Sequelize.DataTypes

let md = (() => {
    let sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    let m = sq.define('tfl', {
        id: { type: DT.STRING, primaryKey: true },
        d: DT.DATE,
        o: DT.DATEONLY,
        s: DT.STRING,
        i: DT.INTEGER,
    }, { tableName: 'tfl', timestamps: false })
    let qg = sq.getQueryInterface().queryGenerator
    let ctx = { attrs: m.rawAttributes, pk: 'id' }
    //where, 取實際送出之WHERE文字(DATE值為UTC文字, 格式 YYYY-MM-DD HH:mm:ss.SSS +00:00)
    let where = (find, ex = {}) => {
        let sql = qg.selectQuery('tfl', { where: cvFind(find, { ...ctx, ...ex }) }, m)
        let k = sql.indexOf(' WHERE ')
        return k >= 0 ? sql.slice(k + 7).replace(/;$/, '') : ''
    }
    return { ctx, where }
})()

let throwsMsg = (fn, msg) => {
    let e = null
    try {
        fn()
    }
    catch (err) {
        e = err
    }
    assert.ok(e !== null, `未拋錯, 應含[${msg}]`)
    assert.ok(String(e.message).indexOf(msg) >= 0, `訊息不含[${msg}]: ${e.message}`)
}

//ut, Date -> WHERE文字內之UTC時間文字
let ut = (d) => {
    let s = d.toISOString()
    return `${s.slice(0, 10)} ${s.slice(11, 23)} +00:00`
}
let isoOf = (c, sep = 'T', withMs = false) => `${pad(c[0], 4)}-${pad(c[1])}-${pad(c[2])}${sep}${pad(c[3])}:${pad(c[4])}:${pad(c[5])}${withMs ? `.${pad(c[6], 3)}` : ''}`


//邊界牆上時間(y,mo,d,h,mi,s,ms)
let WALLS = [
    [1, 1, 1, 0, 0, 0, 0], [99, 12, 31, 23, 59, 59, 0], [100, 1, 1, 0, 0, 0, 0], [1970, 1, 1, 0, 0, 0, 0], [2024, 2, 29, 12, 0, 0, 0], [2026, 2, 28, 23, 59, 59, 999],
    [2026, 3, 8, 2, 30, 0, 0], [2026, 11, 1, 1, 30, 0, 0], [2026, 10, 20, 12, 34, 56, 0], [9999, 12, 31, 0, 0, 0, 0], [9999, 12, 31, 23, 59, 59, 999],
]

//非法字串16種(皆須null): 純日期、曆法不存在、24時、60分、60秒、前後空白、小寫t、5位年、年0、亂字串、空字串、不完整偏移、斜線格式
let BAD_STR = ['2026-06-15', '2026-02-30T00:00:00', '2025-02-29T00:00:00', '2026-13-01T00:00:00', '2026-01-01T24:00:00', '2026-01-01T00:60:00', '2026-01-01T00:00:60', ' 2026-01-01T00:00:00', '2026-01-01T00:00:00 ', '2026-01-01t00:00:00', '10000-01-01T00:00:00', '0000-01-01T00:00:00', 'garbage', '', '2026-01-01T00:00:00+8', '2026/01/01 00:00:00']

//非法值(含Invalid Date共10種, 皆須null且不拋錯)
let BAD_VAL = [NaN, Infinity, 8.64e15 + 1, null, undefined, true, {}, [], 5n, new Date(NaN)]


describe('toFloating: 輸入空間表(值形式 x 邊界牆上時間 x 時區)', function() {

    let cells = 0
    let byForm = {}

    //check, 單格比對: want為null時須嚴格為null
    let check = (form, tz, label, got, want) => {
        cells += 1
        byForm[form] = (byForm[form] || 0) + 1
        if (want === null) {
            assert.strictEqual(got, null, `${tz} ${form} [${label}] 應為null, 得 ${got === null ? null : got.toISOString()}`)
        }
        else {
            assert.ok(got instanceof Date, `${tz} ${form} [${label}] 應為Date, 得 ${String(got)}`)
            assert.strictEqual(got.getTime(), want.getTime(), `${tz} ${form} [${label}] 得 ${got.toISOString()} 應為 ${want.toISOString()}`)
        }
    }

    for (let tz of TZS) {

        it(`${tz} 時區切換自證: 本地getter之偏移 = Intl之偏移`, function() {
            withTz(tz, () => tzSelfCheck(tz))
        })

        it(`${tz} 無時區字串(T分隔、單一空白分隔、含毫秒、省略秒) x 11個牆上時間: 牆上分量即UTC分量, 與時區無關`, function() {
            withTz(tz, () => {
                for (let w of WALLS) {
                    let L = isoOf(w, 'T', true)
                    check('str-T', tz, L, toFloating(isoOf(w, 'T')), utcOf([w[0], w[1], w[2], w[3], w[4], w[5], 0]))
                    check('str-space', tz, L, toFloating(isoOf(w, ' ')), utcOf([w[0], w[1], w[2], w[3], w[4], w[5], 0]))
                    check('str-ms', tz, L, toFloating(isoOf(w, 'T', true)), utcOf(w))
                    check('str-nosec', tz, L, toFloating(`${pad(w[0], 4)}-${pad(w[1])}-${pad(w[2])}T${pad(w[3])}:${pad(w[4])}`), utcOf([w[0], w[1], w[2], w[3], w[4], 0, 0]))
                }
            })
        })

        it(`${tz} Date、epoch、帶Z字串、帶偏移字串 x 11個牆上時間: 取瞬間於主機時區之牆上分量(預言機Intl), 牆上年不在1–9999者為null`, function() {
            withTz(tz, () => {
                for (let w of WALLS) {
                    let base = utcOf(w).getTime()
                    for (let inst of [base, base + 3600000 * 5]) {
                        let wi = wallIntl(inst, tz)
                        let want = inYear(wi[0]) ? utcOf(wi) : null
                        check('Date', tz, new Date(inst).toISOString(), toFloating(new Date(inst)), want)
                        check('epoch', tz, String(inst), toFloating(inst), want)
                        let z = new Date(inst).toISOString()
                        if (/^\d{4}-/.test(z)) {
                            check('str-Z', tz, z, toFloating(z), want)
                        }
                    }
                    //帶偏移字串(+05:45): 瞬間 = 牆上分量 - 偏移(字串不含毫秒)
                    let inst2 = utcOf([w[0], w[1], w[2], w[3], w[4], w[5], 0]).getTime() - (5 * 60 + 45) * 60000
                    let wi2 = wallIntl(inst2, tz)
                    check('str-offset', tz, `${isoOf(w, 'T')}+05:45`, toFloating(`${isoOf(w, 'T')}+05:45`), inYear(wi2[0]) ? utcOf(wi2) : null)
                }
            })
        })

        it(`${tz} 非法字串16種與非法值10種: 皆嚴格回null, 不拋錯`, function() {
            withTz(tz, () => {
                for (let bad of BAD_STR) {
                    check('invalid-string', tz, bad, toFloating(bad), null)
                }
                for (let bad of BAD_VAL) {
                    let got
                    assert.doesNotThrow(() => {
                        got = toFloating(bad)
                    }, `非法值不得拋錯: ${typeof bad === 'bigint' ? `${bad}n` : String(bad)}`)
                    check('invalid-value', tz, typeof bad === 'bigint' ? `${bad}n` : String(bad), got, null)
                }
            })
        })

    }

    it('空間表規模: 1460格(10個時區各146格), 各類格數如下', function() {
        assert.strictEqual(TZS.length, 10)
        assert.deepStrictEqual(byForm, {
            'str-T': 110,
            'str-space': 110,
            'str-ms': 110,
            'str-nosec': 110,
            'Date': 220,
            'epoch': 220,
            'str-Z': 210,
            'str-offset': 110,
            'invalid-string': 160,
            'invalid-value': 100,
        })
        assert.strictEqual(cells, 1460)
    })

})


describe('toFloating: 回傳值性質', function() {

    it('全域改寫Date.prototype之getTime與本地分量getter不影響toFloating(以載入時取得之內建函數call呼叫; 外審minimax F5)', function() {
        let names = ['getTime', 'getFullYear', 'getMonth', 'getDate', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds']
        let orig = {}
        for (let n of names) {
            orig[n] = Date.prototype[n]
        }
        let inputs = [() => new Date('2026-01-01T12:00:00Z'), () => 1767225600000, () => '2026-01-01T12:00:00Z', () => '2026-01-01T12:00:00']
        for (let tz of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
            withTz(tz, () => {
                let want = inputs.map((mk) => toFloating(mk()).valueOf())
                try {
                    for (let n of names) {
                        Reflect.defineProperty(Date.prototype, n, { value: () => 2099, writable: true, configurable: true })
                    }
                    let got = inputs.map((mk) => toFloating(mk()))
                    assert.ok(got.every((v) => v !== null), `${tz}: 改寫原型getter後得null`)
                    assert.deepStrictEqual(got.map((v) => v.valueOf()), want, `${tz}: 改寫原型getter後結果改變`)
                }
                finally {
                    for (let n of names) {
                        Reflect.defineProperty(Date.prototype, n, { value: orig[n], writable: true, configurable: true })
                    }
                }
            })
        }
        for (let n of names) {
            assert.strictEqual(Date.prototype[n], orig[n], `${n}未還原`)
        }
    })

    it('每次回傳新Date; 不改動輸入Date', function() {
        let d = new Date(2026, 0, 1, 12, 0, 0)
        let t0 = d.getTime()
        let a = toFloating(d)
        let b = toFloating(d)
        assert.notStrictEqual(a, b)
        assert.notStrictEqual(a, d)
        assert.strictEqual(d.getTime(), t0)
    })

    it('敵意輸入不拋錯、回null: valueOf/toString/getter拋錯之物件、Symbol、包裝物件、Proxy、無原型物件', function() {
        let boom = () => {
            throw new Error('boom')
        }
        let hostile = [
            { valueOf: boom },
            { toString: boom },
            Symbol('x'),
            Object('2026-01-01T00:00:00'),
            Object(5),
            new Proxy({}, { get: boom }),
            new Proxy({}, { getPrototypeOf: boom }),
            Object.create(null),
            () => 0,
        ]
        for (let v of hostile) {
            let got
            assert.doesNotThrow(() => {
                got = toFloating(v)
            })
            assert.strictEqual(got, null)
        }
    })

    it('只接受與條件側相同之形式: 純日期、年0、5位年、帶空白、小寫t一律null; 年1–9999邊界可', function() {
        for (let s of ['2026-01-01', '0000-01-01T00:00:00', '10000-01-01T00:00:00', ' 2026-01-01T00:00:00', '2026-01-01t00:00:00']) {
            assert.strictEqual(toFloating(s), null, s)
        }
        assert.strictEqual(toFloating('0001-01-01T00:00:00').toISOString(), '0001-01-01T00:00:00.000Z')
        assert.strictEqual(toFloating('9999-12-31T23:59:59.999').toISOString(), '9999-12-31T23:59:59.999Z')
    })

    it('小數秒取前三位(截斷至毫秒, 不進位); 不足三位補零', function() {
        assert.strictEqual(toFloating('2026-01-01T00:00:00.123456').getUTCMilliseconds(), 123)
        assert.strictEqual(toFloating('2026-01-01T00:00:00.9').getUTCMilliseconds(), 900)
        assert.strictEqual(toFloating('2026-01-01T00:00:00.05').getUTCMilliseconds(), 50)
        //截斷與四捨五入不同之值: .1239 → 123(四捨五入為124); .9999 → 999(四捨五入為1000而進位到下一秒)
        assert.strictEqual(toFloating('2026-01-01T00:00:00.1239').getUTCMilliseconds(), 123)
        assert.strictEqual(toFloating('2026-01-01T00:00:00.9999').toISOString(), '2026-01-01T00:00:00.999Z')
        assert.strictEqual(toFloating('2026-12-31T23:59:59.9999').toISOString(), '2026-12-31T23:59:59.999Z')
        assert.strictEqual(toFloating('9999-12-31T23:59:59.9999').toISOString(), '9999-12-31T23:59:59.999Z')
    })

    it('Date以內建getTime讀內部時間: 跨realm之Date可換算; 自有getTime/getFullYear之覆寫、改寫原型getter皆不影響, 與條件側(cvOrmFind複製Date)認定一致(外審sol F1)', function() {
        for (let tz of ['UTC', 'America/Los_Angeles', 'Asia/Taipei']) {
            withTz(tz, () => {
                let base = toFloating(new Date('2026-01-01T12:00:00Z'))
                let cross = vm.runInNewContext('new Date(\'2026-01-01T12:00:00Z\')')
                assert.ok(!(cross instanceof Date), '前提: 跨realm之Date不是本realm之Date實例')
                assert.strictEqual(toFloating(cross).getTime(), base.getTime(), `${tz} 跨realm`)
                assert.strictEqual(md.where({ d: cross }, { dateNoTz: 'floating' }), md.where({ d: new Date('2026-01-01T12:00:00Z') }, { dateNoTz: 'floating' }), `${tz} 條件側同`)
                //自有getFullYear/getTime/getHours覆寫
                let evil = new Date('2026-01-01T12:00:00Z')
                evil.getFullYear = () => 2099
                evil.getHours = () => 3
                evil.getTime = () => {
                    throw new Error('custom getTime')
                }
                assert.strictEqual(toFloating(evil).getTime(), base.getTime(), `${tz} 覆寫`)
                //Date子類別
                class MyDate extends Date {
                    getTime() {
                        return 0
                    }
                }
                assert.strictEqual(toFloating(new MyDate('2026-01-01T12:00:00Z')).getTime(), base.getTime(), `${tz} 子類別`)
            })
        }
        //不是Date之物件(含偽裝Symbol.toStringTag、有getTime方法者)為null
        let fake = { getTime: () => 0, getFullYear: () => 2026, [Symbol.toStringTag]: 'Date' }
        assert.strictEqual(toFloating(fake), null)
        assert.strictEqual(toFloating(Object.create(Date.prototype)), null)
    })

    it('帶時區偏移字串 x 偏移寫法(+05:45、-08:00、+0530、-0800、Z、+00:00) x 分隔(T、空白) x 秒/毫秒有無 x 各時區: 取瞬間於主機時區之牆上分量(預言機Intl); 含負偏移(外審sol F3)', function() {
        let offs = [['+05:45', 345], ['-08:00', -480], ['+0530', 330], ['-0800', -480], ['Z', 0], ['+00:00', 0], ['-03:30', -210]]
        let walls = [[2026, 1, 15, 12, 0, 0, 0], [2026, 3, 8, 2, 30, 0, 0], [2026, 11, 1, 1, 30, 0, 0], [9999, 12, 30, 12, 0, 0, 0], [100, 1, 1, 8, 0, 0, 0]]
        let n = 0
        for (let tz of TZS) {
            withTz(tz, () => {
                for (let [txt, off] of offs) {
                    for (let sep of ['T', ' ']) {
                        for (let w of walls) {
                            for (let form of ['sec', 'nosec', 'ms']) {
                                let s = `${pad(w[0], 4)}-${pad(w[1])}-${pad(w[2])}${sep}${pad(w[3])}:${pad(w[4])}${form === 'nosec' ? '' : `:${pad(w[5])}`}${form === 'ms' ? '.250' : ''}${txt}`
                                let inst = utcOf([w[0], w[1], w[2], w[3], w[4], form === 'nosec' ? 0 : w[5], form === 'ms' ? 250 : 0]).getTime() - off * 60000
                                let wi = wallIntl(inst, tz)
                                let want = inYear(wi[0]) ? utcOf(wi) : null
                                let got = toFloating(s)
                                n += 1
                                if (want === null) {
                                    assert.strictEqual(got, null, `${tz} ${s}`)
                                }
                                else {
                                    assert.ok(got !== null && got.getTime() === want.getTime(), `${tz} ${s}: 得 ${got === null ? null : got.toISOString()} 應為 ${want.toISOString()}`)
                                }
                            }
                        }
                    }
                }
            })
        }
        assert.strictEqual(n, 10 * 7 * 2 * 5 * 3)
    })

    it('帶時區字串曆法上不存在者為null(V8之Date.parse會順延日期而接受2026-02-30T00:00:00Z, 故須先驗曆法), 各時區皆然', function() {
        let bads = ['2026-02-30T00:00:00Z', '2025-02-29T00:00:00+08:00', '2026-04-31T00:00:00Z', '2026-02-29 12:00:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-01-00T00:00:00Z']
        for (let tz of TZS) {
            withTz(tz, () => {
                for (let s of bads) {
                    assert.strictEqual(toFloating(s), null, `${tz} ${s}`)
                    throwsMsg(() => cvFind({ d: s }, { ...md.ctx, dateNoTz: 'floating' }), 'does not match column type [date]')
                }
                //閏日與合法者可
                assert.ok(toFloating('2024-02-29T12:00:00Z') instanceof Date)
            })
        }
    })

})


describe('cvFind ctx.dateNoTz:\'floating\'', function() {

    it('值域: undefined、\'local\'、\'floating\'可; 其餘(含大小寫不同、null、false、空字串、數值)於入口拋invalid ctx, 含find為空或非物件時', function() {
        for (let v of [undefined, 'local', 'floating']) {
            assert.doesNotThrow(() => cvFind({ d: '2026-01-01T00:00:00Z' }, { ...md.ctx, dateNoTz: v }))
        }
        for (let v of [null, false, true, '', 'Floating', 'FLOATING', 'floating ', 'float', 'utc', 'Local', 0, 1, {}, []]) {
            throwsMsg(() => cvFind({ d: '2026-01-01T00:00:00Z' }, { ...md.ctx, dateNoTz: v }), 'invalid ctx: dateNoTz must be \'local\', \'floating\' or undefined')
            throwsMsg(() => cvFind({}, { ...md.ctx, dateNoTz: v }), 'invalid ctx')
            throwsMsg(() => cvFind(undefined, { ...md.ctx, dateNoTz: v }), 'invalid ctx')
        }
    })

    it('未給時維持reject無時區字串(預設行為不變)', function() {
        throwsMsg(() => cvFind({ d: '2026-01-01T00:00:00' }, md.ctx), '[date]')
        throwsMsg(() => cvFind({ d: '2026-01-01T00:00:00' }, { ...md.ctx, dateNoTz: undefined }), '[date]')
    })

    for (let tz of TZS.concat(TZS_DST_EAST)) {

        it(`${tz}: 無時區字串之SQL與主機時區無關(牆上分量即UTC分量), 含9999哨兵、年0100與夏令跳過/重疊之牆上時間`, function() {
            withTz(tz, () => {
                for (let s of ['2026-10-20T00:00:00', '9999-12-31T23:59:59', '0100-01-01T00:00:00', '2026-03-08T02:30:00', '2026-11-01T01:30:00', '2026-03-29T02:30:00', '2026-10-04T02:15:00', '2026-10-20 12:34:56.789']) {
                    let w = md.where({ d: { $lt: s } }, { dateNoTz: 'floating' })
                    let want = ut(utcOf([Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)), Number(s.slice(11, 13)), Number(s.slice(14, 16)), Number(s.slice(17, 19)), s.length > 20 ? Number(s.slice(20, 23)) : 0]))
                    assert.ok(w.indexOf(want) >= 0, `${tz} ${s}: ${w} 應含 ${want}`)
                }
            })
        })

        it(`${tz}: 本地分量建構之Date與其epoch恆為同一牆上時間之浮動值(與主機時區無關)`, function() {
            withTz(tz, () => {
                for (let c of [[2026, 0, 1, 0, 0, 0], [2026, 9, 20, 12, 34, 56], [2020, 5, 15, 23, 59, 59], [100, 0, 1, 0, 0, 0]]) {
                    let d = new Date(2000, 0, 1)
                    d.setFullYear(c[0], c[1], c[2])
                    d.setHours(c[3], c[4], c[5], 0)
                    let wantD = ut(utcOf([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), 0]))
                    assert.ok(md.where({ d }, { dateNoTz: 'floating' }).indexOf(wantD) >= 0, `${tz} Date ${d.toString()}`)
                    assert.ok(md.where({ d: d.getTime() }, { dateNoTz: 'floating' }).indexOf(wantD) >= 0, `${tz} epoch`)
                    //該牆上時間若為夏令跳過者(本地建構已被正規化)以結果Date之本地分量為準, 此處以非跳過時刻之案固定; 年0100~2026之案皆非跳過
                    if (c[0] >= 1900) {
                        assert.strictEqual(wantD.slice(0, 4), pad(c[0], 4))
                    }
                }
            })
        })

        it(`${tz}: 帶Z字串依瞬間取主機本地分量(預言機Intl)`, function() {
            withTz(tz, () => {
                for (let z of ['2026-10-20T00:00:00Z', '2026-01-15T12:00:00Z', '2026-07-15T12:00:00.5Z', '2026-10-20T00:00:00+05:45']) {
                    let inst = Date.parse(z)
                    let wi = wallIntl(inst, tz)
                    let w = md.where({ d: { $eq: z } }, { dateNoTz: 'floating' })
                    assert.ok(w.indexOf(ut(utcOf(wi))) >= 0, `${tz} ${z}: ${w} 應含 ${ut(utcOf(wi))}`)
                }
            })
        })

    }

    it('固定瞬間(Date、epoch、帶Z字串)之浮動值隨主機時區而變(此即語意: 取瞬間於主機時區之牆上分量); 無時區字串則恆定(外審sol F8)', function() {
        let at = (tz, v) => withTz(tz, () => md.where({ d: { $eq: v } }, { dateNoTz: 'floating' }))
        for (let mk of [() => new Date('2026-01-01T00:00:00Z'), () => 1767225600000, () => '2026-01-01T00:00:00Z']) {
            assert.ok(at('UTC', mk()).indexOf('2026-01-01 00:00:00.000 +00:00') >= 0)
            assert.ok(at('Asia/Taipei', mk()).indexOf('2026-01-01 08:00:00.000 +00:00') >= 0)
            assert.ok(at('America/Los_Angeles', mk()).indexOf('2025-12-31 16:00:00.000 +00:00') >= 0)
        }
        for (let tz of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
            assert.ok(at(tz, '2026-01-01T00:00:00').indexOf('2026-01-01 00:00:00.000 +00:00') >= 0)
        }
    })

    it('$in/$nin: 每個元素皆換算; 任一元素不合法則整體拒收', function() {
        let w = md.where({ d: { $in: ['2026-01-01T00:00:00', '2026-06-01T12:00:00'] } }, { dateNoTz: 'floating' })
        assert.ok(w.indexOf('2026-01-01 00:00:00.000 +00:00') >= 0 && w.indexOf('2026-06-01 12:00:00.000 +00:00') >= 0, w)
        let w2 = md.where({ d: { $nin: ['2026-01-01T00:00:00', '2026-06-01T12:00:00'] } }, { dateNoTz: 'floating' })
        assert.ok(w2.indexOf('NOT IN') >= 0 && w2.indexOf('2026-06-01 12:00:00.000 +00:00') >= 0, w2)
        throwsMsg(() => cvFind({ d: { $in: ['2026-01-01T00:00:00', '2026-02-30T00:00:00'] } }, { ...md.ctx, dateNoTz: 'floating' }), '[date]')
        throwsMsg(() => cvFind({ d: { $nin: ['2026-01-01T00:00:00', 'garbage'] } }, { ...md.ctx, dateNoTz: 'floating' }), '[date]')
        //空$in仍為恆假(以引用欄位之f IS NULL AND 1 = 0表示)
        let w3 = md.where({ d: { $in: [] } }, { dateNoTz: 'floating' })
        assert.ok(/d.{0,3} IS NULL AND 1 = 0/.test(w3), w3)
    })

    it('不合法者拒收(訊息同現行): 純日期、曆法不存在、24時、60秒、年0、5位年、布林、字串亂碼', function() {
        for (let s of ['2026-01-01', '2026-02-30T00:00:00', '2025-02-29T00:00:00', '2026-13-01T00:00:00', '2026-01-01T24:00:00', '2026-01-01T00:00:60', '0000-01-01T00:00:00', '10000-01-01T00:00:00', 'garbage', '2026-01-01T00:00:00+8', ' 2026-01-01T00:00:00']) {
            throwsMsg(() => cvFind({ d: s }, { ...md.ctx, dateNoTz: 'floating' }), 'does not match column type [date]')
        }
        throwsMsg(() => cvFind({ d: true }, { ...md.ctx, dateNoTz: 'floating' }), 'does not match column type [date]')
        //超出Date範圍之epoch與無效Date由形狀層先拒
        throwsMsg(() => cvFind({ d: 8.64e15 + 1 }, { ...md.ctx, dateNoTz: 'floating' }), 'does not match column type [date]')
        throwsMsg(() => cvFind({ d: new Date(NaN) }, { ...md.ctx, dateNoTz: 'floating' }), 'invalid find')
    })

    it('僅作用於DATE欄: DATEONLY、字串、整數欄不受影響(與未給dateNoTz同)', function() {
        let cx = { dateNoTz: 'floating' }
        assert.strictEqual(md.where({ o: '2026-01-01' }, cx), md.where({ o: '2026-01-01' }))
        throwsMsg(() => cvFind({ o: '2026-01-01T00:00:00' }, { ...md.ctx, ...cx }), '[dateonly]')
        throwsMsg(() => cvFind({ o: new Date(0) }, { ...md.ctx, ...cx }), '[dateonly]')
        assert.strictEqual(md.where({ s: '2026-01-01T00:00:00' }, cx), md.where({ s: '2026-01-01T00:00:00' }))
        assert.ok(md.where({ s: '2026-01-01T00:00:00' }, cx).indexOf('\'2026-01-01T00:00:00\'') >= 0)
        assert.strictEqual(md.where({ i: 5 }, cx), md.where({ i: 5 }))
        throwsMsg(() => cvFind({ i: '2026-01-01T00:00:00' }, { ...md.ctx, ...cx }), '[int]')
    })

    it('null仍為IS NULL; $ne:null為IS NOT NULL(不受浮動換算影響)', function() {
        let cx = { dateNoTz: 'floating' }
        assert.strictEqual(md.where({ d: null }, cx), md.where({ d: null }))
        assert.strictEqual(md.where({ d: { $ne: null } }, cx), md.where({ d: { $ne: null } }))
    })

    it('與\'local\'之差異: 負偏移時區之9999哨兵與夏令跳過之牆上時間, local拒收而floating可', function() {
        withTz('America/Los_Angeles', () => {
            throwsMsg(() => cvFind({ d: { $gte: '9999-12-31T23:59:59' } }, { ...md.ctx, dateNoTz: 'local' }), '[date]')
            assert.ok(md.where({ d: { $gte: '9999-12-31T23:59:59' } }, { dateNoTz: 'floating' }).indexOf('9999-12-31 23:59:59.000 +00:00') >= 0)
        })
        withTz('America/New_York', () => {
            throwsMsg(() => cvFind({ d: '2026-03-08T02:30:00' }, { ...md.ctx, dateNoTz: 'local' }), '[date]')
            assert.ok(md.where({ d: '2026-03-08T02:30:00' }, { dateNoTz: 'floating' }).indexOf('2026-03-08 02:30:00.000 +00:00') >= 0)
            //重疊時刻: local取較早者(EDT, +4h), floating依牆上時間(01:30 UTC)
            assert.ok(md.where({ d: '2026-11-01T01:30:00' }, { dateNoTz: 'local' }).indexOf('2026-11-01 05:30:00.000 +00:00') >= 0)
            assert.ok(md.where({ d: '2026-11-01T01:30:00' }, { dateNoTz: 'floating' }).indexOf('2026-11-01 01:30:00.000 +00:00') >= 0)
        })
        withTz('Europe/Berlin', () => {
            throwsMsg(() => cvFind({ d: '2026-03-29T02:30:00' }, { ...md.ctx, dateNoTz: 'local' }), '[date]')
            assert.ok(md.where({ d: '2026-03-29T02:30:00' }, { dateNoTz: 'floating' }).indexOf('2026-03-29 02:30:00.000 +00:00') >= 0)
        })
    })

    it('\'local\'行為不變: 正偏移/UTC時區之local與既有一致(同一字串之SQL = 本地分量建構之Date)', function() {
        withTz('Asia/Taipei', () => {
            assert.strictEqual(md.where({ d: '2026-10-20T00:00:00' }, { dateNoTz: 'local' }), md.where({ d: new Date(2026, 9, 20, 0, 0, 0) }))
            assert.ok(md.where({ d: '2026-10-20T00:00:00' }, { dateNoTz: 'local' }).indexOf('2026-10-19 16:00:00.000 +00:00') >= 0)
        })
    })

    //契約①: 編碼後之浮動Date/epoch不可再當'floating'條件輸入(Date一律被當作瞬間取本地分量, 再次輸入即二次位移)
    it('契約①: 編碼後之浮動Date再當條件輸入即二次位移(非UTC時區下toFloating非冪等; UTC下恆等)', function() {
        for (let tz of TZS) {
            withTz(tz, () => {
                let once = toFloating('2026-10-20T12:00:00')
                let twice = toFloating(once)
                let off = once.getTimezoneOffset() //該瞬間之偏移(分鐘, UTC減本地)
                if (off === 0) {
                    assert.strictEqual(twice.getTime(), once.getTime(), `${tz}: UTC下應冪等`)
                }
                else {
                    assert.notStrictEqual(twice.getTime(), once.getTime(), `${tz}: 非UTC時區下編碼後之Date再編碼應位移`)
                    assert.strictEqual(twice.getTime(), once.getTime() - off * 60000, `${tz}: 位移量應為該瞬間之本地偏移`)
                }
                //經cvFind: 原字串與編碼後Date產生之條件值不同(非UTC時區)
                let w1 = md.where({ d: { $eq: '2026-10-20T12:00:00' } }, { dateNoTz: 'floating' })
                let w2 = md.where({ d: { $eq: once } }, { dateNoTz: 'floating' })
                if (off === 0) {
                    assert.strictEqual(w1, w2)
                }
                else {
                    assert.notStrictEqual(w1, w2, `${tz}: 編碼後之Date當條件輸入應與原條件不同(二次位移)`)
                }
            })
        }
    })

})

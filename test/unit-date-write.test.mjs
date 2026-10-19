import assert from 'assert'
import vm from 'vm'
import Sequelize from 'sequelize'
import cvFind from '../src/cvFind.mjs'
import * as cv from '../src/cvFind.mjs'
import { withTz } from './tools/withTz.mjs'


//寫入側DATE範圍檢核之純函數測試(CLAUDE_rulebook.md之R12), 不連線資料庫
//規格句(R12): 凡寫入DATE/DATEONLY欄之值, 須為年份在1–9999之有效時間(DATE依UTC年, DATEONLY依實際存入之日期文字), 範圍外與無效時間(Invalid Date、NaN、垃圾字串…)皆拒收;
//與條件側(R4)共用同一範圍判定inDateRange; 非DATE欄、非model欄位之鍵不檢; Sequelize.fn/literal等SQL運算式不檢;
//檢查之值即使用之值: 通過檢核之物件值就地換成已檢核之標準值(Date或YYYY-MM-DD文字), 不再受自訂valueOf/toString/getTime之二次求值影響
//實際寫入入口(insert、insertBulk、save)之整批reject與資料庫不變由test/api-date-write.mjs於sqlite與mssql斷言
//本檔以import * as cv取用被測匯出, 令被測匯出不存在時為逐案斷言失敗(而非整檔載入失敗)


let sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
let md = sq.define('tdw', {
    id: { type: Sequelize.STRING, primaryKey: true },
    n: Sequelize.STRING,
    i: Sequelize.INTEGER,
    d: Sequelize.DATE,
    d2: Sequelize.DATE(3),
    o: Sequelize.DATEONLY,
}, { tableName: 'tdw', timestamps: false })
let attrs = md.rawAttributes

let chk = (rec) => cv.genDateChecker(attrs)(rec)

//邊界(毫秒): 年1與年9999之首尾
let MIN_OK = Date.parse('0001-01-01T00:00:00.000Z') //-62135596800000
let MAX_OK = Date.parse('9999-12-31T23:59:59.999Z') //253402300799999
let MIN_BAD = MIN_OK - 1
let MAX_BAD = MAX_OK + 1


describe('R12 寫入側DATE範圍: inDateRange(條件側與寫入側共用之單一範圍判定)', function() {

    it('匯出存在', function() {
        assert.strictEqual(typeof cv.inDateRange, 'function')
        assert.strictEqual(typeof cv.genDateChecker, 'function')
    })

    // 規格句: 換算UTC後年份須在1–9999
    let cases = [
        ['年1首刻', MIN_OK, true],
        ['年0末刻', MIN_BAD, false],
        ['年9999末刻', MAX_OK, true],
        ['年10000首刻', MAX_BAD, false],
        ['1970', 0, true],
        ['Date上界8.64e15', 8.64e15, false],
        ['Date下界-8.64e15', -8.64e15, false],
        ['NaN', NaN, false],
        ['Infinity', Infinity, false],
        ['-Infinity', -Infinity, false],
    ]
    for (let [label, ms, want] of cases) {
        it(`${label}: ${want}`, function() {
            assert.strictEqual(cv.inDateRange(ms), want)
        })
    }

})


describe('R12 寫入側DATE範圍: genDateChecker(attrs)(rec) 回傳第一個範圍外之欄位名, 皆合法回傳null', function() {

    // ---- DATE欄: 拒收值 ----
    let badDate = [
        ['Date 年0末刻', () => new Date('0000-12-31T23:59:59.999Z')],
        ['Date 年10000首刻', () => new Date('+010000-01-01T00:00:00.000Z')],
        ['Date 8.64e15', () => new Date(8.64e15)],
        ['Date -8.64e15', () => new Date(-8.64e15)],
        ['epoch 年0末刻', () => MIN_BAD],
        ['epoch 年10000首刻', () => MAX_BAD],
        ['epoch 8.64e15', () => 8.64e15],
        ['epoch -8.64e15', () => -8.64e15],
        ['ISO字串 年0末刻', () => '0000-12-31T23:59:59.999Z'],
        ['ISO字串 年10000首刻(帶號6位數年)', () => '+010000-01-01T00:00:00Z'],
        ['ISO字串 8.64e15', () => '+275760-09-13T00:00:00.000Z'],
        ['ISO字串 -8.64e15', () => '-271821-04-20T00:00:00.000Z'],
        ['帶偏移ISO字串 換算UTC後年10000', () => '9999-12-31T23:30:00-05:00'],
        ['帶偏移ISO字串 換算UTC後年0', () => '0001-01-01T00:30:00+01:00'],
        ['Number包裝物件 8.64e15', () => Object(8.64e15)],
        ['String包裝物件 年10000', () => Object('+010000-01-01T00:00:00Z')],
        ['Date子類別 8.64e15', () => new (class MyDate extends Date {})(8.64e15)],
        ['跨realm之Date 8.64e15', () => vm.runInNewContext('new Date(8.64e15)')],
        ['跨realm之Date -8.64e15', () => vm.runInNewContext('new Date(-8.64e15)')],
    ]
    for (let [label, gen] of badDate) {
        it(`DATE欄拒收: ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', d: gen() }), 'd')
        })
    }

    // ---- DATE欄: 接受值(邊界與範圍內) ----
    let okDate = [
        ['Date 年1首刻', () => new Date('0001-01-01T00:00:00.000Z')],
        ['Date 年9999末刻', () => new Date('9999-12-31T23:59:59.999Z')],
        ['Date 年1首刻+1ms', () => new Date(MIN_OK + 1)],
        ['Date 年9999末刻-1ms', () => new Date(MAX_OK - 1)],
        ['Date 1970', () => new Date(0)],
        ['epoch 年1首刻', () => MIN_OK],
        ['epoch 年9999末刻', () => MAX_OK],
        ['epoch 0(falsy數值)', () => 0],
        ['ISO字串 年1首刻', () => '0001-01-01T00:00:00.000Z'],
        ['ISO字串 年9999末刻', () => '9999-12-31T23:59:59.999Z'],
        ['帶偏移ISO字串 換算UTC後年9999內', () => '9999-12-31T23:30:00+00:30'],
        ['純日期字串(sequelize現行接受)', () => '2026-01-01'],
        ['空白分隔之ISO字串', () => '2026-01-01 12:00:00Z'],
        ['Number包裝物件 範圍內', () => Object(Date.parse('2026-01-01T00:00:00Z'))],
        ['陣列(new Date([y,m,d])得範圍內時間)', () => [2026, 1, 1]],
        ['null', () => null],
        ['undefined', () => undefined],
    ]
    for (let [label, gen] of okDate) {
        it(`DATE欄接受: ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', d: gen() }), null)
        })
    }

    // ---- 無效時間一律拒收(sequelize在sqlite存為文字Invalid date, 字典序大於任何年份而使$gt命中、delAll誤刪, mssql由資料庫報錯, 兩方言不一致) ----
    let invalid = [
        ['Invalid Date', () => new Date(NaN)],
        ['NaN', () => NaN],
        ['Infinity', () => Infinity],
        ['-Infinity', () => -Infinity],
        ['超出Date範圍之epoch 1e16', () => 1e16],
        ['空字串(falsy, sequelize不轉換而存為Invalid date)', () => ''],
        ['垃圾字串', () => 'garbage'],
        ['無+號之5位數年字串(JS不認)', () => '10000-01-01T00:00:00Z'],
        ['false(falsy)', () => false],
        ['BigInt 0n(falsy)', () => 0n],
        ['BigInt 1n(DATEONLY之moment卻視為年2001)', () => 1n],
        ['Symbol', () => Symbol('x')],
    ]
    for (let [label, gen] of invalid) {
        it(`DATE欄拒收無效時間: ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', d: gen() }), 'd')
        })
        it(`DATEONLY欄拒收無效時間: ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', o: gen() }), 'o')
        })
    }

    let invalidDate = [
        ['一般物件{a:1}(new Date得Invalid Date)', () => ({ a: 1 })],
        ['無原型物件Object.create(null)(new Date拋TypeError)', () => Object.create(null)],
        ['陣列元素為垃圾字串', () => ['garbage']],
    ]
    for (let [label, gen] of invalidDate) {
        it(`DATE欄拒收無法換算為時間之值(換算拋錯亦拒收而非拋出): ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', d: gen() }), 'd')
        })
    }

    // ---- SQL運算式由呼叫端明示, sequelize不轉換, 不檢 ----
    let sqlExprs = [
        ['Sequelize.fn(SQL函數值)', () => Sequelize.fn('datetime', 'now')],
        ['Sequelize.literal(SQL常值)', () => Sequelize.literal('\'2026-01-01 00:00:00.000 +00:00\'')],
        ['Sequelize.col', () => Sequelize.col('d2')],
    ]
    for (let [label, gen] of sqlExprs) {
        it(`DATE與DATEONLY欄不檢SQL運算式: ${label}`, function() {
            let v = gen()
            let rec = { id: 'a', d: v, o: v }
            assert.strictEqual(chk(rec), null)
            assert.strictEqual(rec.d, v, '不換值')
            assert.strictEqual(rec.o, v, '不換值')
        })
    }

    it('falsy數值0與-0為epoch 0(有效, sequelize不轉換而依epoch存入)', function() {
        assert.strictEqual(chk({ d: 0 }), null)
        assert.strictEqual(chk({ d: -0 }), null)
        assert.strictEqual(chk({ o: 0 }), null)
        assert.strictEqual(chk({ o: -0 }), null)
    })

    // ---- DATEONLY欄 ----
    // 規格句: sequelize以moment(值).format('YYYY-MM-DD')存入文字, 以實際存入者判定: 年須為4位數且在1–9999
    // 註: Date物件依主機本地曆年格式化, 故拒收值取年中(不受時區影響), 邊界年另於withTz案驗證
    let badOnly = [
        ['Date 8.64e15', () => new Date(8.64e15)],
        ['Date -8.64e15', () => new Date(-8.64e15)],
        ['Date 年10000年中', () => new Date('+010000-06-15T12:00:00Z')],
        ['Date 年0年中', () => new Date('0000-06-15T12:00:00Z')],
        ['epoch 8.64e15', () => 8.64e15],
        ['epoch -8.64e15', () => -8.64e15],
        ['ISO字串 年10000(帶號6位數年)', () => '+010000-01-01'],
        ['ISO字串 年0', () => '0000-12-31'],
        ['帶時間之ISO字串 年10000年中', () => '+010000-06-15T12:00:00Z'],
        ['Number包裝物件 8.64e15', () => Object(8.64e15)],
    ]
    for (let [label, gen] of badOnly) {
        it(`DATEONLY欄拒收: ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', o: gen() }), 'o')
        })
    }

    let okOnly = [
        ['字串 年1首日', () => '0001-01-01'],
        ['字串 年9999末日', () => '9999-12-31'],
        ['字串 一般', () => '2026-06-15'],
        ['Date 年中', () => new Date('2026-06-15T12:00:00Z')],
        ['epoch 年中', () => Date.parse('2026-06-15T12:00:00Z')],
        ['null', () => null],
        ['undefined', () => undefined],
    ]
    for (let [label, gen] of okOnly) {
        it(`DATEONLY欄接受: ${label}`, function() {
            assert.strictEqual(chk({ id: 'a', o: gen() }), null)
        })
    }

    // 曆年依主機本地時間(moment格式化): 同一瞬間在不同時區可能跨年
    it('DATEONLY欄之邊界年依主機時區: UTC+8下UTC年9999末刻之Date其本地曆年為10000而拒收', function() {
        withTz('Asia/Taipei', () => {
            assert.strictEqual(chk({ o: new Date('9999-12-31T23:30:00Z') }), 'o')
            assert.strictEqual(chk({ o: new Date('9999-12-31T15:59:59Z') }), null)
        })
    })
    it('DATEONLY欄之邊界年依主機時區: UTC-5下UTC年1首刻之Date其本地曆年為0而拒收', function() {
        withTz('America/New_York', () => {
            assert.strictEqual(chk({ o: new Date('0001-01-01T00:30:00Z') }), 'o')
            assert.strictEqual(chk({ o: new Date('0001-01-02T12:00:00Z') }), null)
        })
    })
    it('DATE欄與主機時區無關(UTC年判定): 各時區下結果相同', function() {
        for (let tz of ['Asia/Taipei', 'America/New_York', 'UTC', 'Pacific/Kiritimati']) {
            withTz(tz, () => {
                assert.strictEqual(chk({ d: new Date(MAX_OK) }), null, tz)
                assert.strictEqual(chk({ d: new Date(MIN_OK) }), null, tz)
                assert.strictEqual(chk({ d: new Date(MAX_BAD) }), 'd', tz)
                assert.strictEqual(chk({ d: new Date(MIN_BAD) }), 'd', tz)
            })
        }
    })

    // ---- 多欄與欄位選取 ----
    it('回報第一個範圍外之欄: 依model屬性定義順序而非數據鍵順序', function() {
        let bad = new Date(8.64e15)
        assert.strictEqual(chk({ o: bad, d2: bad, d: bad }), 'd')
        assert.strictEqual(chk({ o: bad, d2: bad }), 'd2')
        assert.strictEqual(chk({ d2: new Date(0), o: bad }), 'o')
    })

    it('同筆其他欄合法時只回報範圍外者', function() {
        assert.strictEqual(chk({ id: 'a', n: 'x', i: 1, d: new Date(0), d2: new Date(8.64e15), o: '2026-01-01' }), 'd2')
    })

    it('非DATE/DATEONLY欄不檢(字串欄、整數欄收到形似範圍外日期之值)', function() {
        assert.strictEqual(chk({ id: '275760-09-13', n: '+275760-09-13T00:00:00.000Z', i: 8.64e15 }), null)
    })

    it('非model欄位之鍵不檢', function() {
        assert.strictEqual(chk({ 'zzz': new Date(8.64e15), 'd.x': new Date(8.64e15) }), null)
    })

    it('數據欄位自原型鏈繼承者亦讀取檢核(保守: create與bulkCreate不讀原型鏈屬性而update會讀)', function() {
        let rec = Object.create({ d: new Date(8.64e15) })
        assert.strictEqual(chk(rec), 'd')
        let ok = Object.create({ d: new Date(0) })
        assert.strictEqual(chk(ok), null)
        assert.ok(!Object.prototype.hasOwnProperty.call(ok, 'd'), '原型鏈屬性只讀不換')
    })

    it('無日期欄之model或未給attrs: 一律回傳null', function() {
        assert.strictEqual(cv.genDateChecker({ id: { type: Sequelize.STRING } })({ d: new Date(8.64e15) }), null)
        assert.strictEqual(cv.genDateChecker(undefined)({ d: new Date(8.64e15) }), null)
        assert.strictEqual(cv.genDateChecker(null)({ d: new Date(8.64e15) }), null)
        assert.strictEqual(cv.genDateChecker({})({ d: new Date(8.64e15) }), null)
    })

    it('記錄非物件時不拋錯(回傳null, 由前段檢核負責)', function() {
        for (let v of [null, undefined, 5, 'x', true]) {
            assert.strictEqual(chk(v), null)
        }
    })

    it('檢核失敗時不改動數據(Date、包裝物件逐一不變)', function() {
        let w = Object(8.64e15)
        let dt = new Date(8.64e15)
        let rec = { d: dt, d2: w }
        assert.strictEqual(chk(rec), 'd')
        assert.strictEqual(rec.d, dt)
        assert.strictEqual(rec.d2, w)
        assert.strictEqual(dt.getTime(), 8.64e15)
    })

    it('原始值(字串、數值)不換: 不可變, 檢查之值即使用之值', function() {
        let rec = { d: '2026-01-01T00:00:00Z', d2: 1700000000000, o: '2026-06-15' }
        assert.strictEqual(chk(rec), null)
        assert.deepStrictEqual(rec, { d: '2026-01-01T00:00:00Z', d2: 1700000000000, o: '2026-06-15' })
    })

    it('guard: DATEONLY型別之_sanitize存在於已安裝之sequelize(寫入側以其判定實際存入之文字, 版本漂移時須讓此案失敗而非靜默不檢)', function() {
        assert.strictEqual(typeof Sequelize.DataTypes.DATEONLY.prototype._sanitize, 'function')
        assert.strictEqual(typeof new Sequelize.DataTypes.DATEONLY()._sanitize, 'function')
    })

})


describe('R12 寫入側DATE範圍: 檢查之值即使用之值(物件值只求值一次並換成標準值)', function() {

    // 規格句(R12): 通過檢核之物件值被sequelize再度求值(DATE._sanitize之new Date(值)、moment(值)、Model.update之讀取)時, 結果須與檢核時相同;
    // 具狀態之valueOf/toString/getTime第一次回傳合法值、其後回傳範圍外值者, 不得因二次求值而存入範圍外年份
    let stateful = (a, b) => {
        let n = 0
        return {
            valueOf() {
                return n++ === 0 ? a : b
            },
            nCall: () => n,
        }
    }

    it('DATE欄: 具狀態valueOf之物件只求值一次, 換成Date(0)而非保留物件', function() {
        let o = stateful(0, 8.64e15)
        let rec = { d: o }
        assert.strictEqual(chk(rec), null)
        assert.ok(rec.d instanceof Date)
        assert.strictEqual(rec.d.getTime(), 0)
        assert.strictEqual(o.nCall(), 1, '只求值一次')
    })

    it('DATE欄: 具狀態valueOf之物件第一次即範圍外則拒收', function() {
        assert.strictEqual(chk({ d: stateful(8.64e15, 0) }), 'd')
    })

    it('DATE欄: 覆寫getTime之Date子類別換成純Date(取檢核時之時間值)', function() {
        let n = 0
        class StatefulDate extends Date {
            getTime() {
                return n++ === 0 ? 0 : 8.64e15
            }
        }
        let rec = { d: new StatefulDate(0) }
        assert.strictEqual(chk(rec), null)
        assert.strictEqual(Object.getPrototypeOf(rec.d), Date.prototype)
        assert.strictEqual(rec.d.getTime(), 0)
    })

    it('DATE欄: Number包裝物件、陣列換成Date', function() {
        let rec = { d: Object(1700000000000), d2: [2026, 1, 1] }
        assert.strictEqual(chk(rec), null)
        assert.ok(rec.d instanceof Date && rec.d.getTime() === 1700000000000)
        assert.ok(rec.d2 instanceof Date && rec.d2.getTime() === new Date([2026, 1, 1]).getTime())
    })

    it('DATE欄: 純Date物件換成同時間值之新Date(檢核後不再與呼叫端之Date物件共用)', function() {
        let dt = new Date('2026-01-01T00:00:00Z')
        let rec = { d: dt }
        assert.strictEqual(chk(rec), null)
        assert.notStrictEqual(rec.d, dt)
        assert.strictEqual(rec.d.getTime(), dt.getTime())
    })

    it('DATEONLY欄: 陣列元素具狀態toString者(moment([…])會二次求值)換成YYYY-MM-DD文字', function() {
        let n = 0
        let el = {
            toString() {
                return n++ === 0 ? '2026' : '10000'
            },
        }
        let rec = { o: [el, 0, 1] }
        assert.strictEqual(chk(rec), null)
        assert.strictEqual(rec.o, '2026-01-01')
    })

    it('DATEONLY欄: Date換成YYYY-MM-DD文字(與sequelize之_sanitize所得相同)', function() {
        let rec = { o: new Date('2026-06-15T12:00:00Z') }
        assert.strictEqual(chk(rec), null)
        assert.strictEqual(rec.o, '2026-06-15')
    })

    it('回報第一個失敗欄時, 其之前已通過者仍已換值(換值不影響回報)', function() {
        let rec = { d: Object(1700000000000), d2: new Date(8.64e15) }
        assert.strictEqual(chk(rec), 'd2')
        assert.ok(rec.d instanceof Date)
    })

})


describe('R12 寫入側DATE範圍: genDateChecker 對手造attrs與型別漂移 fail-closed', function() {

    // 規格句(R12): DATEONLY以_sanitize所得之實際存入文字判定; 手造attrs之type可為型別建構子(未經sequelize.define實例化)——此時不得靜默放行(外審Argon F2)
    let bad = () => new Date(8.64e15)

    it('手造attrs之type為型別建構子(Sequelize.DATEONLY / Sequelize.DATE)亦檢核', function() {
        let c = cv.genDateChecker({ d: { type: Sequelize.DATE }, o: { type: Sequelize.DATEONLY } })
        assert.strictEqual(c({ d: bad() }), 'd')
        assert.strictEqual(c({ o: bad() }), 'o')
        assert.strictEqual(c({ o: '+010000-01-01' }), 'o')
        assert.strictEqual(c({ d: new Date(0), o: '2026-01-01' }), null)
        assert.strictEqual(c({ o: new Date('2026-06-15T12:00:00Z') }), null, '合法Date須經_sanitize換算為文字後放行')
    })

    it('手造attrs之type為型別實例亦檢核', function() {
        let c = cv.genDateChecker({ o: { type: new Sequelize.DATEONLY() } })
        assert.strictEqual(c({ o: bad() }), 'o')
    })

    it('type僅有key而無_sanitize(自訂型別物件): 以sequelize內建DATEONLY之_sanitize判定, 不放行', function() {
        let c = cv.genDateChecker({ o: { type: { key: 'DATEONLY' } } })
        assert.strictEqual(c({ o: bad() }), 'o')
        assert.strictEqual(c({ o: '2026-01-01' }), null)
        assert.strictEqual(c({ o: new Date('2026-06-15T12:00:00Z') }), null, '合法Date須經_sanitize換算為文字後放行')
    })

    it('type之_sanitize回傳非字串(漂移)時視為無法確認為有效日期而拒收, 不放行', function() {
        let c = cv.genDateChecker({ o: { type: { key: 'DATEONLY', _sanitize: () => 42 } } })
        assert.strictEqual(c({ o: '2026-01-01' }), 'o')
    })

    it('type之_sanitize拋錯時視為無效而拒收, 不往外拋', function() {
        let boom = () => {
            throw new Error('x')
        }
        let c = cv.genDateChecker({ o: { type: { key: 'DATEONLY', _sanitize: boom } } })
        assert.strictEqual(c({ o: '2026-01-01' }), 'o')
    })

})


describe('R12 寫入側DATE範圍: 與條件側(cvFind)同界', function() {

    // 規格句(R12單一擁有者): 條件側與寫入側共用inDateRange, 同一時間點兩側判定一致
    let edges = [MIN_BAD, MIN_OK, MIN_OK + 1, -1, 0, 1, 1e12, MAX_OK - 1, MAX_OK, MAX_BAD, 8.64e15, -8.64e15]

    let condOk = (v) => {
        try {
            cvFind({ d: { $gt: v } }, { attrs })
            return true
        }
        catch (err) {
            return false
        }
    }

    for (let ms of edges) {
        it(`Date(${ms}): 條件側接受 = 寫入側接受`, function() {
            assert.strictEqual(condOk(new Date(ms)), chk({ d: new Date(ms) }) === null)
        })
        it(`epoch ${ms}: 條件側接受 = 寫入側接受`, function() {
            assert.strictEqual(condOk(ms), chk({ d: ms }) === null)
        })
        it(`ISO字串(Date(${ms})之toISOString): 條件側接受 = 寫入側接受`, function() {
            let s = new Date(ms).toISOString()
            assert.strictEqual(condOk(s), chk({ d: s }) === null, s)
        })
    }

})

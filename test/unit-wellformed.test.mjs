import fs from 'fs'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import { normPk, chkPkWf, chkWf } from '../src/cvFind.mjs'
import cvStrCases from 'wsemi/src/_cvOrmStrCases.mjs'


//字串良構之純函數與建構設定測試(不連線, CLAUDE_rulebook.md之R13)
//規格句(dspec〈一之三〉9.): 主鍵不得含孤立代理碼元或NUL, 寫入資料之字串值與鍵名不得含孤立代理碼元(值之NUL不拒), opt.db/opt.cl/opt.url(路徑承載者)含孤立代理碼元者建構時throw;
//訊息為固定詞彙且不回顯值: invalid id: <原因> at [data[<k>].<主鍵欄>]、invalid data: <原因> at [data[<k>].<路徑>]、invalid opt.<名>: <原因>
//案例表(wsemi之_cvOrmStrCases.mjs)之形態表forms供逐形態斷言; 對公開API之逐案執行見api-wellformed.mjs(sqlite與mssql)


let { forms, reasons } = cvStrCases

let formKeys = Object.keys(forms).filter((k) => !forms[k].long)

//whyId/whyVal, 形態在主鍵位置與資料位置之期望原因(主鍵併入NUL且NUL先於孤立代理; 資料值只檢孤立代理)
let whyId = (f) => (f.nul ? reasons.nul : f.lone ? reasons.lone : null)
let whyVal = (f) => (f.lone ? reasons.lone : null)

let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)


describe('normPk 字串分支: 孤立代理碼元與NUL為無效主鍵(R13)', function() {

    for (let kind of ['str', 'int', 'num', 'any']) {
        for (let k of formKeys) {
            let f = forms[k]
            let bad = whyId(f) !== null
            if (!bad) {
                continue
            }
            it(`${kind}欄 ${k}(${f.label}) → {kind:'invalid'}, 形狀不變`, function() {
                assert.deepStrictEqual(normPk(f.str, kind), { kind: 'invalid' })
                assert.deepStrictEqual(normPk(Object(f.str), kind), { kind: 'invalid' }, 'String包裝物件取原始值後同處置')
            })
        }
    }

    it('良構字串(ASCII、中文、emoji、CJK擴充B、U+FFFD、組合字元、ZWJ)於字串類主鍵欄原樣接受', function() {
        for (let k of formKeys) {
            let f = forms[k]
            if (whyId(f) !== null) {
                continue
            }
            assert.deepStrictEqual(normPk(f.str, 'str'), { kind: 'ok', v: f.str }, k)
            assert.deepStrictEqual(normPk(Object(f.str), 'str'), { kind: 'ok', v: f.str }, `${k} 包裝物件`)
            assert.deepStrictEqual(normPk(f.str, 'any'), { kind: 'ok', v: f.str }, `${k} any`)
        }
    })

    it('不合格字串於整數類與其他數值類主鍵欄亦為無效(而非型別不符)', function() {
        for (let s of ['12\u0000', '\u00001', '1\uD800', '\uDC001']) {
            assert.deepStrictEqual(normPk(s, 'int'), { kind: 'invalid' }, s.length + '')
            assert.deepStrictEqual(normPk(s, 'num'), { kind: 'invalid' }, s.length + '')
        }
        //對照: 良構但型別不符者仍為mismatch
        assert.deepStrictEqual(normPk('012', 'int'), { kind: 'mismatch' })
        assert.deepStrictEqual(normPk('1e3', 'num'), { kind: 'mismatch' })
    })

    it('既有行為不變: 空字串無效、有限數字於字串欄轉字串、整數寫法字串於整數欄轉數值、NaN與物件無效', function() {
        assert.deepStrictEqual(normPk('', 'str'), { kind: 'invalid' })
        assert.deepStrictEqual(normPk(123, 'str'), { kind: 'ok', v: '123' })
        assert.deepStrictEqual(normPk('12', 'int'), { kind: 'ok', v: 12 })
        assert.deepStrictEqual(normPk('9007199254740993', 'int'), { kind: 'ok', v: '9007199254740993' })
        assert.deepStrictEqual(normPk(NaN, 'str'), { kind: 'invalid' })
        assert.deepStrictEqual(normPk({}, 'str'), { kind: 'invalid' })
        assert.deepStrictEqual(normPk(null, 'any'), { kind: 'invalid' })
        assert.deepStrictEqual(normPk(undefined, 'any'), { kind: 'invalid' })
    })

})


describe('chkPkWf: 主鍵值之字串良構判定', function() {

    for (let k of formKeys) {
        let f = forms[k]
        it(`${k}(${f.label}) → ${whyId(f)}`, function() {
            assert.strictEqual(chkPkWf(f.str), whyId(f))
            assert.strictEqual(chkPkWf(Object(f.str)), whyId(f), '包裝物件')
        })
    }

    it('非字串回null(其有效性由normPk判定)', function() {
        for (let v of [undefined, null, 1, NaN, true, {}, [], new Date(), Symbol('a')]) {
            assert.strictEqual(chkPkWf(v), null)
        }
    })

})


describe('chkWf: 逐筆檢核寫入數據(主鍵 + 資料), 訊息固定詞彙且不回顯值', function() {

    describe('主鍵位置: 逐形態', function() {
        for (let k of formKeys) {
            let f = forms[k]
            let why = whyId(f)
            it(`${k}(${f.label}) → ${why === null ? 'null' : `invalid id: ${why}`}`, function() {
                let ms = chkWf([{ id: 'ok' }, { id: f.str, name: 'n' }], 'id', true)
                assert.strictEqual(ms.length, 2)
                assert.strictEqual(ms[0], null)
                assert.strictEqual(ms[1], why === null ? null : `invalid id: ${why} at [data[1].id]`)
                let ms2 = chkWf([{ id: f.str }], 'id', false)
                assert.strictEqual(ms2[0], why === null ? null : `invalid id: ${why} at [data[0].id]`, 'withData:false 只檢主鍵亦同')
            })
        }
    })

    describe('資料位置: 逐形態 x 位置(頂層、巢狀、陣列、陣列內物件、鍵名、巢狀鍵名)', function() {
        let pos = {
            name: [(s) => ({ name: s }), 'name'],
            nested: [(s) => ({ meta: { a: { s } } }), 'meta.a.s'],
            array: [(s) => ({ tags: ['ok', s] }), 'tags[1]'],
            arrayObj: [(s) => ({ list: [{ s }] }), 'list[0].s'],
            key: [(s) => ({ [s]: 1 }), '<invalid key>'],
            nestedKey: [(s) => ({ meta: { [s]: 1 } }), 'meta.<invalid key>'],
        }
        for (let [p, [make, path]] of Object.entries(pos)) {
            for (let k of formKeys) {
                let f = forms[k]
                let why = whyVal(f)
                it(`${p} x ${k}(${f.label}) → ${why === null ? 'null' : why}`, function() {
                    let ms = chkWf([{ id: 'a', name: 'n' }, { id: 'b', name: 'n', ...make(f.str) }], 'id', true)
                    assert.strictEqual(ms[0], null)
                    assert.strictEqual(ms[1], why === null ? null : `invalid data: ${why} at [data[1].${path}]`)
                    //del只檢主鍵: 資料不檢
                    assert.deepStrictEqual(chkWf([{ id: 'b', name: 'n', ...make(f.str) }], 'id', false), [null])
                    //訊息不回顯值
                    if (ms[1] !== null) {
                        assert.ok(!ms[1].includes(f.str), '訊息不得含被拒之字串')
                        assert.ok(ms[1].isWellFormed(), '訊息本身須良構')
                    }
                })
            }
        }
    })

    it('同一文件主鍵先於資料; 同一物件鍵名先於值; 以索引最小者為準(各筆各自回報)', function() {
        let H = '\uD800'
        let L = '\uDC00'
        let ms = chkWf([
            { id: 'g0' },
            { id: H, name: L },
            { id: 'g2', name: L, [H]: 1 },
            { id: 'g3', a: { s: H }, b: L },
        ], 'id', true)
        assert.deepStrictEqual(ms, [
            null,
            'invalid id: string contains lone surrogate at [data[1].id]',
            'invalid data: string contains lone surrogate at [data[2].<invalid key>]',
            'invalid data: string contains lone surrogate at [data[3].a.s]',
        ])
    })

    it('主鍵欄名可自訂(訊息之路徑用該欄名); 主鍵欄名不為id時仍檢該欄', function() {
        let ms = chkWf([{ key: 'a\uD800', id: 'ok' }], 'key', true)
        assert.deepStrictEqual(ms, ['invalid id: string contains lone surrogate at [data[0].key]'])
    })

    it('資料之NUL不拒(值與鍵名), 主鍵之NUL拒', function() {
        let kNul = 'k\u0000'
        assert.deepStrictEqual(chkWf([{ id: 'a', name: 'x\u0000y', [kNul]: 1, meta: { s: '\u0000' } }], 'id', true), [null])
        assert.deepStrictEqual(chkWf([{ id: 'a\u0000b' }], 'id', true), ['invalid id: string contains NUL at [data[0].id]'])
    })

    it('非物件與空值之筆: 不拋錯(字串值依資料檢核, 其餘無字串可檢)', function() {
        assert.deepStrictEqual(chkWf([null, undefined, 1, 'ok', {}], 'id', true), [null, null, null, null, null])
        assert.deepStrictEqual(chkWf(['a\uD800'], 'id', true), ['invalid data: string contains lone surrogate at [data[0]]'])
    })

    it('實存型別之內容: Map(值與鍵)、Set、String包裝、Error、RegExp、繼承屬性皆檢核(不論欄位是否在model內)', function() {
        let H = '\uD800'
        let cases = [
            [{ m: new Map([['k', H]]) }, 'm[0]'],
            [{ m: new Map([[H, 'v']]) }, 'm[0].<key>'],
            [{ st: new Set(['ok', H]) }, 'st[1]'],
            [{ w: Object(H) }, 'w'],
            [{ e: new Error(H) }, 'e.message'],
            [{ r: new RegExp(H) }, 'r.source'],
            [{ o: Object.create({ inh: H }) }, 'o.inh'],
            [{ list: [{ [H]: 1 }] }, 'list[0].<invalid key>'],
        ]
        for (let [extra, path] of cases) {
            let ms = chkWf([{ id: 'a', ...extra }], 'id', true)
            assert.deepStrictEqual(ms, [`invalid data: string contains lone surrogate at [data[0].${path}]`], path)
        }
    })

    it('包裝物件主鍵: 合格者將原始字串寫回該筆(令其後之正規化讀到的即被檢查者), valueOf只讀一次', function() {
        let n = 0
        let evil = {
            [Symbol.toStringTag]: 'String',
            valueOf() {
                n++
                return n === 1 ? 'evil-ok' : 'evil\uD800'
            },
        }
        let d = [{ id: Object('wrap') }, { id: evil }]
        assert.deepStrictEqual(chkWf(d, 'id', true), [null, null])
        assert.strictEqual(n, 1)
        assert.strictEqual(d[0].id, 'wrap')
        assert.strictEqual(d[1].id, 'evil-ok')
        assert.strictEqual(typeof d[0].id, 'string')
    })

    it('Number包裝物件主鍵: valueOf只求值一次, 原始數值寫回該筆', function() {
        let n = 0
        let num = {
            [Symbol.toStringTag]: 'Number',
            valueOf() {
                n++
                return n === 1 ? 42 : NaN
            },
        }
        let d = [{ id: num }, { id: Object(7) }]
        assert.deepStrictEqual(chkWf(d, 'id', true), [null, null])
        assert.strictEqual(n, 1)
        assert.strictEqual(d[0].id, 42)
        assert.strictEqual(d[1].id, 7)
        assert.strictEqual(typeof d[1].id, 'number')
    })

    it('不修改合格筆之其他欄位, 不為不合格筆寫回', function() {
        let d = [{ id: 'a\uD800', name: 'x' }, { id: Object('ok'), name: 'y', n: { a: [1, 2] } }]
        chkWf(d, 'id', true)
        assert.strictEqual(d[0].id, 'a\uD800')
        assert.deepStrictEqual(d[1], { id: 'ok', name: 'y', n: { a: [1, 2] } })
    })

})


describe('建構設定: opt.db、opt.cl、opt.url、opt.storage含孤立代理碼元者建構時throw', function() {

    let base = { url: 'sqlite://:', db: 'worm', cl: 'users', fdModels: './models', storage: './tmp/unit-wellformed.sqlite' }

    for (let name of ['db', 'cl', 'url', 'storage']) {
        for (let k of formKeys) {
            let f = forms[k]
            if (f.nul || f.unit) {
                continue
            }
            let bad = f.lone
            it(`opt.${name} ${k}(${f.label}) → ${bad ? 'throw' : '不throw'}`, function() {
                let opt = { ...base, [name]: name === 'url' ? `${base.url}${f.str}` : f.str }
                if (bad) {
                    assert.throws(() => wo(opt), (err) => err instanceof Error && msgOf(err) === `invalid opt.${name}: ${reasons.lone}`)
                }
                else {
                    assert.doesNotThrow(() => wo(opt))
                }
            })
        }
    }

    it('訊息固定詞彙, 不回顯值; 先於opt.url之解析(url含孤立代理且dialect亦無效時仍回報良構錯誤)', function() {
        assert.throws(() => wo({ ...base, url: 'nodialect://a\uD800' }), (err) => msgOf(err) === 'invalid opt.url: string contains lone surrogate')
        assert.throws(() => wo({ ...base, url: 'sqlite://:\uD800' }), (err) => !msgOf(err).includes('\uD800'))
    })

    it('不套用預設值之前的非字串: 非字串之opt.db/opt.cl/opt.url/opt.storage改用預設值, 不throw(既有行為)', function() {
        assert.doesNotThrow(() => wo({ ...base, db: 1, cl: null, storage: 5 }))
    })

    it('opt名稱之NUL不屬本規則(不throw本規則之錯誤)', function() {
        assert.doesNotThrow(() => wo({ ...base, db: 'a\u0000b', cl: 'users\u0000' }))
    })

    it('同時多個不合格時依db、cl、url、storage順序回報第一個', function() {
        assert.throws(() => wo({ ...base, cl: 'a\uD800', storage: 'b\uD800' }), (err) => msgOf(err) === 'invalid opt.cl: string contains lone surrogate')
        assert.throws(() => wo({ ...base, db: 'a\uD800', cl: 'b\uD800' }), (err) => msgOf(err) === 'invalid opt.db: string contains lone surrogate')
    })

})


describe('單一出處與接線站點掃描(盤點指令見R13)', function() {

    //src, 讀原始碼並去除註解(行首起算之區塊註解與行尾註解), 掃描對象為程式碼而非說明文字
    //註: 區塊註解只認行首者; 不限位置之 /\/\*[\s\S]*?\*\// 會被行註解內之 `<scheme>://***`(含 `/*`)誤觸發, 把其後至下一個 `*/` 之程式碼整段吃掉(第 213 項實測)
    let src = (fn) => fs.readFileSync(`./src/${fn}`, 'utf8').replace(/\r\n/g, '\n').replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/\/\/.*$/gm, '')
    let count = (s, re) => (s.match(re) || []).length

    it('src內不自寫孤立代理判定(單一擁有者為wsemi之chkOrmStr、chkOrmData)', function() {
        for (let fn of fs.readdirSync('./src').filter((v) => /\.(mjs|js)$/.test(v))) {
            let s = src(fn)
            assert.strictEqual(count(s, /isWellFormed/g), 0, `${fn}: isWellFormed`)
            assert.strictEqual(count(s, /\\uD800|\\uDC00|\\uDFFF|\\uDBFF/gi), 0, `${fn}: 代理碼元範圍`)
        }
    })

    it('chkOrmStr、chkOrmData只在cvFind.mjs與WOrmReladb.mjs(opt名稱)接線', function() {
        let c = src('cvFind.mjs')
        assert.strictEqual(count(c, /import chkOrmStr from 'wsemi\/src\/chkOrmStr\.mjs'/g), 1)
        assert.strictEqual(count(c, /import chkOrmData from 'wsemi\/src\/chkOrmData\.mjs'/g), 1)
        assert.strictEqual(count(c, /chkOrmStr\(/g), 2, 'normPk與chkPkWf各一')
        assert.strictEqual(count(c, /chkOrmData\(/g), 1, 'chkWf')
        let w = src('WOrmReladb.mjs')
        assert.strictEqual(count(w, /import chkOrmStr from 'wsemi\/src\/chkOrmStr\.mjs'/g), 1)
        assert.strictEqual(count(w, /chkOrmStr\(/g), 2, '建構時opt名稱(迴圈)與sqlite之opt.storage之NUL(R20, 第213項)各一')
        assert.strictEqual(count(w, /chkOrmData/g), 0)
    })

    it('寫入入口(insert、insertBulk、save、del)各一處chkWf, 皆在initSequelize之前; 數據於呼叫當下複製(snap), 函數內不再複製', function() {
        let w = src('WOrmReladb.mjs')
        assert.strictEqual(count(w, /chkWf\(/g), 4)
        for (let name of ['insert', 'insertBulk', 'save', 'del']) {
            let i = w.indexOf(`    async function ${name}(`)
            let m = w.slice(i + 10).match(/\n {4}(async )?function \w+\(/) //下一個函數(註解已去除)
            let seg = w.slice(i, m === null ? w.length : i + 10 + m.index)
            assert.strictEqual(count(seg, /chkWf\(/g), 1, `${name} chkWf`)
            assert.ok(seg.indexOf('chkWf(') < seg.indexOf('await initSequelize()'), `${name}: chkWf須先於initSequelize`)
            assert.ok(seg.indexOf('procClosed(instance)') < seg.indexOf('chkWf('), `${name}: procClosed須先於chkWf`)
            assert.strictEqual(count(seg, /cloneDeep\(/g), 0, `${name}: 函數內不再複製(已於snap複製)`)
            assert.strictEqual(count(w, new RegExp(`ee\\.${name} = snap\\(`, 'g')), 2, `${name}: 穩定與非穩定模式皆經snap`)
        }
    })

})

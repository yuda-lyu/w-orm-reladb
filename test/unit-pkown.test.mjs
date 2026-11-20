/* eslint-disable no-new-wrappers */ //包裝物件(new String、new Number)為被測之輸入, 非筆誤
import assert from 'assert'
import * as cv from '../src/cvFind.mjs'
import { GIVEN_BAD, HOSTILE, msgOf } from './tools/hostile.mjs'


//第569項(rulebook R25)之不連線測試: cvFind.mjs之isOwnPk與chkWf之主鍵只認自有可列舉之資料屬性
//規格句(rules-569.md, S1~S3同api-pkown.mjs): 列之主鍵欄為繼承(原型鏈上, 不論值之型別)或自有不可列舉者視為未帶(S1);
//判定不多讀有效輸入: 先取值, 值為未帶即短路, 只有給了才查描述子(propertyIsEnumerable, 不呼叫getter)(S2)


let { chkWf } = cv
let MSG_BAD = (k, pk = 'id') => `invalid id: not a string or finite number at [data[${k}].${pk}]`


//形狀: 主鍵欄pk之值為v, 但非自有可列舉(被視為未帶)
let UNSET_SHAPES = {
    inheritedData: (pk, v) => Object.assign(Object.create({ [pk]: v }), { name: 'n' }),
    inheritedDeep: (pk, v) => Object.assign(Object.create(Object.create({ [pk]: v })), { name: 'n' }),
    inheritedNonEnum: (pk, v) => Object.assign(Object.create(Object.defineProperty({}, pk, { value: v, enumerable: false })), { name: 'n' }),
    classGetter: (pk, v) => {
        let C = class {
            get [pk]() {
                return v
            }
        }
        return Object.assign(new C(), { name: 'n' })
    },
    frozenProto: (pk, v) => Object.assign(Object.create(Object.freeze({ [pk]: v })), { name: 'n' }),
    ownNonEnum: (pk, v) => Object.defineProperty({ name: 'n' }, pk, { value: v, enumerable: false, writable: true, configurable: true }),
    ownNonEnumOverInherited: (pk, v) => Object.defineProperty(Object.assign(Object.create({ [pk]: 'inherited-ok' }), { name: 'n' }), pk, { value: v, enumerable: false, writable: true, configurable: true }),
}

//值(含有效與各種無效): 繼承時皆視為未帶(S1: 不論值之型別)
//(含不可讀之物件: 已撤銷之Proxy、Symbol.toStringTag拋錯者、ownKeys陷阱拋錯者, 與含孤立代理碼元之字串、巢狀物件; 資料檢核走訪繼承之可列舉屬性, 被視為未帶之主鍵不得被讀取或檢核)
let VALS = {
    str: () => 'a9',
    num: () => 123,
    zero: () => 0,
    nul: () => 'a\u0000b',
    surrogate: () => 'a\ud800',
    nestedSurrogate: () => ({ x: ['a\ud800'] }),
    ...GIVEN_BAD,
    ...HOSTILE,
}


describe('isOwnPk(R25): 主鍵欄是否為自有可列舉之屬性(只查描述子, 不呼叫getter)', function() {

    it('自有可列舉之資料屬性(含值為未帶者)為true', function() {
        //S1: 只認自有可列舉之資料屬性
        assert.strictEqual(cv.isOwnPk({ id: 'a' }, 'id'), true)
        assert.strictEqual(cv.isOwnPk({ id: undefined }, 'id'), true)
        assert.strictEqual(cv.isOwnPk({ id: null }, 'id'), true)
        assert.strictEqual(cv.isOwnPk({ id: '' }, 'id'), true)
        assert.strictEqual(cv.isOwnPk({ id: 0 }, 'id'), true)
        assert.strictEqual(cv.isOwnPk({ key: 'a' }, 'key'), true)
    })

    for (let [sn, sf] of Object.entries(UNSET_SHAPES)) {
        it(`${sn}: 繼承或自有不可列舉為false`, function() {
            //S1: 繼承(原型鏈上)與自有不可列舉者非自有可列舉
            assert.strictEqual(cv.isOwnPk(sf('id', 'a9'), 'id'), false)
            assert.strictEqual(cv.isOwnPk(sf('key', 'a9'), 'key'), false)
        })
    }

    it('鍵不存在、null、undefined、非物件之列為false', function() {
        //S1
        assert.strictEqual(cv.isOwnPk({}, 'id'), false)
        assert.strictEqual(cv.isOwnPk(null, 'id'), false)
        assert.strictEqual(cv.isOwnPk(undefined, 'id'), false)
        assert.strictEqual(cv.isOwnPk(5, 'id'), false)
        assert.strictEqual(cv.isOwnPk('abc', 'length'), false, '字串之length為自有不可列舉')
    })

    it('以字面鍵判定(不解析路徑): 鍵含點者, 巢狀值不算, 字面鍵算', function() {
        //S1: 主鍵欄名為字面鍵(寫入亦以v[opt.pk]字面鍵賦值)
        assert.strictEqual(cv.isOwnPk({ a: { b: 'x' } }, 'a.b'), false)
        assert.strictEqual(cv.isOwnPk({ 'a.b': 'x' }, 'a.b'), true)
    })

    it('自有存取器(可列舉)為true且不呼叫getter(S2)', function() {
        //S2: 只查描述子, 不讀值
        let n = 0
        let o = { name: 'n' }
        Object.defineProperty(o, 'id', {
            enumerable: true,
            configurable: true,
            get() {
                n++
                return 'x'
            },
        })
        assert.strictEqual(cv.isOwnPk(o, 'id'), true)
        let C = class {
            get id() {
                n++
                return 'x'
            }
        }
        assert.strictEqual(cv.isOwnPk(new C(), 'id'), false)
        assert.strictEqual(n, 0, 'getter一次也未被呼叫')
    })

})


describe('chkWf(R25): 繼承或自有不可列舉之主鍵視為未帶, 與鍵不存在同處置', function() {

    for (let strictPk of [true, false]) {
        for (let withData of [true, false]) {
            for (let pk of ['id', 'key']) {
                for (let [sn, sf] of Object.entries(UNSET_SHAPES)) {
                    for (let [vn, vf] of Object.entries(VALS)) {
                        it(`strictPk=${strictPk} withData=${withData} pk=${pk} ${sn} 值為${vn}: 無訊息(同鍵不存在)`, function() {
                            //S1: 繼承(不論值之型別)或自有不可列舉者視為未帶: 不檢字串良構(NUL、孤立代理碼元)、不歸入[給了而非字串或有限數字]、資料檢核亦不讀取其值
                            let absent = chkWf([{ name: 'n' }], pk, withData, strictPk)
                            assert.deepStrictEqual(absent, [null], '對照: 鍵不存在無訊息')
                            let r = chkWf([sf(pk, vf())], pk, withData, strictPk)
                            assert.deepStrictEqual(r, absent)
                        })
                    }
                }
            }
        }
    }

    it('自有可列舉之主鍵: 既有之拒絕不變(NUL、孤立代理碼元; strictPk時給了而非字串或有限數字), 非strictPk之物件不拒(由del逐筆迴圈處置)', function() {
        //S1 對照: 自有可列舉者照舊
        assert.deepStrictEqual(chkWf([{ id: 'a\u0000b' }], 'id', false), ['invalid id: string contains NUL at [data[0].id]'])
        assert.deepStrictEqual(chkWf([{ id: 'a\ud800' }], 'id', false), ['invalid id: string contains lone surrogate at [data[0].id]'])
        assert.deepStrictEqual(chkWf([{ id: {} }], 'id', false, true), [MSG_BAD(0)])
        assert.deepStrictEqual(chkWf([{ id: {} }], 'id', false, false), [null])
        assert.deepStrictEqual(chkWf([{ id: 'ok' }, { id: 5 }, { id: 0 }], 'id', false, true), [null, null, null])
        assert.deepStrictEqual(chkWf([{ key: NaN }], 'key', false, true), [MSG_BAD(0, 'key')])
    })

    it('自有可列舉之主鍵遮蔽繼承者: 以自有者為準(自有有效則不因繼承之無效值拒絕; 自有無效仍拒絕)', function() {
        //S1: 自有可列舉者優先於原型上之值
        assert.deepStrictEqual(chkWf([Object.assign(Object.create({ id: {} }), { id: 'ok' })], 'id', false, true), [null])
        assert.deepStrictEqual(chkWf([Object.assign(Object.create({ id: 'ok' }), { id: {} })], 'id', false, true), [MSG_BAD(0)])
        assert.deepStrictEqual(chkWf([Object.assign(Object.create({ id: 'ok' }), { id: 'a\u0000b' })], 'id', false, true), ['invalid id: string contains NUL at [data[0].id]'])
    })

    it('多筆: 各筆獨立判定, 索引對應(自有無效之筆有訊息, 繼承者無)', function() {
        //S1、S3: 逐筆
        let rows = [
            UNSET_SHAPES.inheritedData('id', { x: 1 }),
            { id: {}, name: 'n' },
            UNSET_SHAPES.classGetter('id', 'a\u0000b'),
            { id: 'ok', name: 'n' },
            UNSET_SHAPES.ownNonEnum('id', NaN),
        ]
        assert.deepStrictEqual(chkWf(rows, 'id', false, true), [null, MSG_BAD(1), null, null, null])
    })

    it('資料檢核仍走訪列之其餘屬性(含繼承之非主鍵欄): 遮蔽只及主鍵欄, 非主鍵欄之孤立代理碼元照拒(S5)', function() {
        //S5: 非主鍵欄之繼承欄位既有處置不變
        let mk = (extra) => Object.assign(Object.create({ id: 'a9', ...extra }), { name: 'n' })
        assert.deepStrictEqual(chkWf([mk({ memo: 'a\ud800' })], 'id', true, true), ['invalid data: string contains lone surrogate at [data[0].memo]'])
        assert.deepStrictEqual(chkWf([Object.assign(mk({}), { name: 'a\ud800' })], 'id', true, true), ['invalid data: string contains lone surrogate at [data[0].name]'])
        assert.deepStrictEqual(chkWf([mk({})], 'id', true, true), [null])
    })

    it('遮蔽不改動列(自有鍵、原型不變, 無新增屬性)', function() {
        //S1: 檢視為Object.create(v, …), 不複製、不改動v
        let proto = { id: 'a9' }
        let row = Object.assign(Object.create(proto), { name: 'n' })
        assert.deepStrictEqual(chkWf([row], 'id', true, true), [null])
        assert.deepStrictEqual(Reflect.ownKeys(row), ['name'])
        assert.strictEqual(Object.getPrototypeOf(row), proto)
        assert.deepStrictEqual(Reflect.ownKeys(proto), ['id'])
    })

    it('內建物件(Map子類別)之列: 不建立檢視而維持原走訪(內容之孤立代理碼元仍被檢出); 繼承之主鍵仍視為未帶', function() {
        //R25: Object.create(map)會失去內部槽而縮小走訪範圍, 故Map、Set、Error、陣列不建立檢視; 走訪結果與修前相同
        class M extends Map {}
        M.prototype.id = 'a9'
        let ok = new M([['k', 'v']])
        assert.strictEqual(Object.prototype.propertyIsEnumerable.call(ok, 'id'), false)
        assert.deepStrictEqual(chkWf([ok], 'id', true, true), [null])
        let bad = new M([['k', 'a\ud800']])
        assert.deepStrictEqual(chkWf([bad], 'id', true, true), ['invalid data: string contains lone surrogate at [data[0][0]]'])
    })

    it('讀取即拋錯之繼承存取器(R23): 無從判定其值, 維持既有處置(strictPk歸入[給了而非字串或有限數字]、非strictPk維持原拋錯)', function() {
        //R23不變: 讀取拋錯者於讀取處捕捉, 不查描述子
        let mk = () => Object.create({
            get id() {
                throw new Error('GETTER-SECRET-569')
            },
        }, { name: { value: 'n', enumerable: true } })
        assert.deepStrictEqual(chkWf([mk()], 'id', false, true), [MSG_BAD(0)])
        assert.throws(() => chkWf([mk()], 'id', false, false), (err) => msgOf(err) === 'GETTER-SECRET-569')
    })

    describe('判定不多讀(S2)', function() {

        //以Proxy計getOwnPropertyDescriptor(propertyIsEnumerable之內部操作)與get之次數
        let mkProbe = (target) => {
            let c = { desc: 0, get: 0 }
            let p = new Proxy(target, {
                getOwnPropertyDescriptor(t, k) {
                    if (k === 'id') {
                        c.desc++
                    }
                    return Reflect.getOwnPropertyDescriptor(t, k)
                },
                get(t, k, rcv) {
                    if (k === 'id') {
                        c.get++
                    }
                    return Reflect.get(t, k, rcv)
                },
            })
            return { p, c }
        }

        for (let [vn, target] of [['鍵不存在', { name: 'n' }], ['undefined', { id: undefined }], ['null', { id: null }], ['空字串', { id: '' }]]) {
            for (let strictPk of [true, false]) {
                it(`strictPk=${strictPk} 值為${vn}(未帶): 值讀一次, 不查描述子(0次)`, function() {
                    //S2: 先以既有路徑取值, 值為未帶即短路
                    let { p, c } = mkProbe(target)
                    assert.deepStrictEqual(chkWf([p], 'id', false, strictPk), [null])
                    assert.deepStrictEqual(c, { desc: 0, get: 1 })
                })
            }
        }

        for (let [vn, target] of [['有效字串', { id: 'a9' }], ['有效數字', { id: 5 }], ['NUL字串', { id: 'a\u0000b' }]]) {
            it(`值為${vn}(給了): 值讀一次, 查描述子一次`, function() {
                //S2: 只有值為給了才查描述子
                let { p, c } = mkProbe(target)
                chkWf([p], 'id', false, true)
                assert.deepStrictEqual(c, { desc: 1, get: 1 })
            })
        }

        it('繼承之存取器(給了): 值讀一次(chkWf內), 描述子查一次, getter總共只被呼叫一次', function() {
            //S2: 描述子查詢不呼叫getter, 有效輸入之讀取次數同修前
            let n = 0
            let C = class {
                get id() {
                    n++
                    return 'a9'
                }
            }
            assert.deepStrictEqual(chkWf([Object.assign(new C(), { name: 'n' })], 'id', false, true), [null])
            assert.strictEqual(n, 1)
        })

        it('自有存取器(可列舉, 呼叫端未複製時): getter只被呼叫一次', function() {
            //S2
            let n = 0
            let o = { name: 'n' }
            Object.defineProperty(o, 'id', {
                enumerable: true,
                configurable: true,
                get() {
                    n++
                    return 'a9'
                },
            })
            assert.deepStrictEqual(chkWf([o], 'id', false, true), [null])
            assert.strictEqual(n, 1)
        })

    })

})

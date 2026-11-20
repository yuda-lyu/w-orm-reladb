/* eslint-disable no-new-wrappers */ //包裝物件(new String)為被測之輸入, 非筆誤
import fs from 'fs'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import { HOSTILE, SECRET, mkRevoked, mkTagThrow, mkKeysThrow, mkGetTrapAll, mkGetTrapStr, msgOf, isGen } from './tools/hostile.mjs'


//讀取即拋錯之輸入依原失敗通道拒絕, 以wsemi之chkReadable分辨[不可讀]與[可讀而型別不符](rulebook R23, 第557項; sqlite, 不需外部資料庫)
//規則(共同規則二、四):
//  ① 呼叫端給的資料容器(data)、選項容器(option)、主鍵(selectByPk之pk): 不可讀者走原失敗通道(寫入入口: error事件恰一次後reject, 資料庫不變; 讀取入口同),
//     訊息為固定詞彙invalid <名稱>: must be a readable value(data、option、pk), 不含原例外文字; error事件之data為null
//  ② 可讀而型別不符者照既有處理(行為不變): data為5、字串、null、{}、[]等回空結果, selectByPk之pk為可讀而非字串者回null
//  ③ 存取器拋錯(容器可讀而成員為存取器拋錯, chkReadable不呼叫存取器)於讀取處捕捉並轉固定詞彙invalid option.<成員>(共同規則四.2, 主控05:5x更正; 拋出之文字由呼叫端決定, 不外帶), 照原通道拒絕(reject, error事件恰一次、data為null)
//  ④ 複製階段(cloneDeep)之巢狀不可讀值(id屬性、列之成員、陣列元素、u8a欄為已撤銷之Proxy或拋錯之存取器, 或可讀而無法複製者)(第557項全族對齊輪, A3; 共同規則四.3 07:0x更正):
//     轉固定詞彙invalid data: must be a readable value, 走與頂層不可讀相同之通道(error事件恰一次、data為null後reject, 資料庫不變); 複製處之catch不分辨頂層與巢狀(長度1與長度>=2之陣列元素存取器同一處置)
//  ⑤ 原型存取器於複製後才拋錯之data(有狀態之存取器, 複製時可讀): 於判斷函數(iseobj、isearr)判為無效後經探針判為不可讀, 同①
//model為models/twf.js(id STRING主鍵、name TEXT), 專用資料表; 探測用資料庫放test/_tmp/readable/, 測完即刪


let dir = './test/_tmp/readable'
let storage = `${dir}/db.sqlite`

let getOpt = (ex = {}) => ({
    url: 'sqlite://:',
    db: 'worm',
    cl: 'twf',
    fdModels: './models',
    storage,
    ...ex,
})

let FIXED = {
    option: 'invalid option: must be a readable value',
    data: 'invalid data: must be a readable value',
    pk: 'invalid pk: must be a readable value',
}

let ev = { error: [], change: [] }
let wire = (w) => {
    w.on('error', (mode, data, err) => {
        ev.error.push({ mode, data, err: msgOf(err) })
    })
    w.on('change', (mode) => {
        ev.change.push(mode)
    })
    return w
}
let settle = (p) => p.then((v) => ({ v })).catch((err) => ({ err }))

let seedRows = [{ id: 'a', name: 'seed-a' }, { id: '5', name: 'seed-5' }]
let seedExp = ['5:seed-5', 'a:seed-a']


describe('讀取即拋錯之輸入依原失敗通道拒絕(R23, sqlite)', function() {

    let adm = null
    let w = null //useStable true(預設)
    let ws = null //useStable false

    let rows = async () => {
        let rs = await adm.select()
        return rs.map((r) => `${isGen(r.id) ? 'GEN' : r.id}:${r.name}`).sort()
    }

    before(async function() {
        fs.mkdirSync(dir, { recursive: true })
        if (fs.existsSync(storage)) {
            fs.unlinkSync(storage)
        }
        adm = wo(getOpt({ autoGenPk: false }))
        adm.on('error', () => {})
        await adm.createStorage()
        w = wire(wo(getOpt()))
        ws = wire(wo(getOpt({ useStable: false })))
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
    })

    beforeEach(async function() {
        await adm.delAll()
        await adm.insert(seedRows)
        ev.error = []
        ev.change = []
    })

    //入口: 名稱 → (w, option) → promise
    let ENTRY = {
        select: (x, o) => x.select({}, o),
        selectByPk: (x, o) => x.selectByPk('a', o),
        insert: (x, o) => x.insert({ id: 'n1', name: 'x' }, o),
        insertBulk: (x, o) => x.insertBulk({ id: 'n1', name: 'x' }, o),
        save: (x, o) => x.save({ id: 'n1', name: 'x' }, o),
        del: (x, o) => x.del({ id: 'a' }, o),
        delAll: (x, o) => x.delAll({ id: 'a' }, o),
    }

    describe('option容器本身不可讀', function() {
        for (let [en, call] of Object.entries(ENTRY)) {
            for (let [vn, f] of Object.entries({ revoked: mkRevoked, getTrapAll: mkGetTrapAll })) {
                it(`${en}: option為${vn}整批reject固定詞彙, error事件恰一次且data為null, 資料庫不變, 不含原例外文字`, async function() {
                    //R23.2(共同規則二.2、四.1): invalid option: must be a readable value; 原失敗通道(reject), error事件恰一次, data為null
                    let r = await settle(call(w, f()))
                    assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                    assert.strictEqual(msgOf(r.err), FIXED.option)
                    assert.ok(msgOf(r.err).indexOf('SECRET') < 0)
                    assert.strictEqual(ev.error.length, 1, 'error事件恰一次')
                    assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data, ev.error[0].err], [en, null, FIXED.option])
                    assert.strictEqual(ev.change.length, 0)
                    assert.deepStrictEqual(await rows(), seedExp)
                })
            }

            it(`${en}: option容器可讀而成員存取拋錯(get陷阱只對字串鍵拋錯, 同存取器拋錯)轉固定詞彙invalid option.<成員>, 照原通道reject(error事件恰一次、data為null)`, async function() {
                //R23.3(共同規則四.2, 主控05:5x更正): 存取器拋錯於讀取處捕捉並轉固定詞彙(chkReadable不呼叫存取器, 無從與容器不可讀區分故以成員名回報), 不含原例外文字
                let r = await settle(call(w, mkGetTrapStr()))
                assert.ok(r.err !== undefined)
                assert.strictEqual(msgOf(r.err), `invalid option.${en === 'insert' ? 'returnList' : 'instance'}: must be a readable value`, 'insert先讀returnList, 其餘先讀instance')
                assert.ok(msgOf(r.err).indexOf('SECRET') < 0)
                assert.strictEqual(ev.error.length, 1)
                assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data], [en, null])
                assert.deepStrictEqual(await rows(), seedExp)
            })

            it(`${en}: option為可讀之值(null、5、new String、ownKeys拋錯、標籤拋錯)行為不變`, async function() {
                //R23.2: 可讀者(含只在列舉自有鍵或讀標籤才拋錯而get不受影響者)不被誤拒
                for (let [on, o] of [['null', null], ['5', 5], ['String包裝', new String('x')], ['ownKeys拋錯', mkKeysThrow()], ['標籤拋錯', mkTagThrow()]]) {
                    await adm.delAll()
                    await adm.insert(seedRows)
                    ev.error = []
                    let r = await settle(call(w, o))
                    assert.ok(r.err === undefined, `option=${on}: ${msgOf(r.err)}`)
                    assert.strictEqual(ev.error.length, 0)
                }
            })
        }

        for (let key of ['instance', 'transaction', 'returnList', 'autoInsert']) {
            let fns = {
                instance: ['select', 'selectByPk', 'insert', 'insertBulk', 'save', 'del', 'delAll'],
                transaction: ['select', 'selectByPk', 'insert', 'insertBulk', 'save', 'del', 'delAll'],
                returnList: ['insert'],
                autoInsert: ['save'],
            }[key]
            for (let en of fns) {
                it(`${en}: option.${key}為存取器且拋錯, 轉固定詞彙invalid option.${key}於入口階段reject(error事件恰一次、data為null), 資料庫不變`, async function() {
                    //R23.3(共同規則四.2, 主控05:5x更正): 修前此讀取於try之外, reject但不發error事件且帶原例外文字; 修後併入入口階段之原失敗通道並轉固定詞彙(存取器拋出之文字由呼叫端決定, 不外帶)
                    let o = Object.defineProperty({}, key, {
                        get() {
                            throw new Error('GETTER-SECRET-557-' + key)
                        },
                        enumerable: true,
                    })
                    let r = await settle(ENTRY[en](w, o))
                    assert.ok(r.err !== undefined)
                    assert.strictEqual(msgOf(r.err), `invalid option.${key}: must be a readable value`)
                    assert.strictEqual(ev.error.length, 1)
                    assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data], [en, null])
                    assert.deepStrictEqual(await rows(), seedExp)
                })
            }
        }

        it('option.returnList為已撤銷之Proxy(成員值不可讀, 但本套件以===true判定而不經判斷函數)維持用預設(不拒)', async function() {
            //R23: returnList之判定為=== true而非wsemi判斷函數, 無判斷函數站點, 行為不變
            let r = await w.insert({ id: 'n2', name: 'x' }, { returnList: mkRevoked() })
            assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
        })
    })

    describe('data容器本身不可讀(複製前)', function() {
        let DATA_ENTRY = {
            insert: (x, d) => x.insert(d),
            insertBulk: (x, d) => x.insertBulk(d),
            save: (x, d) => x.save(d),
            del: (x, d) => x.del(d),
        }
        for (let [en, call] of Object.entries(DATA_ENTRY)) {
            for (let [vn, f] of Object.entries(HOSTILE)) {
                for (let [sn, x] of [['useStable', () => w], ['非useStable', () => ws]]) {
                    it(`${en}(${sn}): data為${vn}整批reject固定詞彙, error事件恰一次且data為null, 資料庫不變, 不含原例外文字`, async function() {
                        //R23.2(共同規則二.1、四): 修前於複製(cloneDeep)拋出原例外文字且不發error事件(訊息隨例外而異, 含使用端之例外文字)
                        let r = await settle(call(x(), f()))
                        assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                        assert.strictEqual(msgOf(r.err), FIXED.data)
                        assert.ok(msgOf(r.err).indexOf('SECRET') < 0)
                        assert.strictEqual(ev.error.length, 1, 'error事件恰一次')
                        assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data, ev.error[0].err], [en, null, FIXED.data])
                        assert.strictEqual(ev.change.length, 0)
                        assert.deepStrictEqual(await rows(), seedExp)
                    })
                }
            }

            it(`${en}: data為可讀而型別不符(undefined、null、空字串、5、字串、new String、布林、{}、[])行為不變(空結果, 不reject、不發error事件)`, async function() {
                //R23.2(共同規則二.2): 可讀而型別不符者照既有處理
                for (let d of [undefined, null, '', 5, 'abc', new String('a'), true, {}, []]) {
                    let r = await settle(call(w, d))
                    assert.ok(r.err === undefined, `${Object.prototype.toString.call(d)}: ${msgOf(r.err)}`)
                    assert.ok(en === 'insert' || en === 'insertBulk' ? r.v.n === 0 : r.v.length === 0, JSON.stringify(r.v))
                }
                assert.strictEqual(ev.error.length, 0)
                assert.deepStrictEqual(await rows(), seedExp)
            })

            for (let [sn, x] of [['useStable', () => w], ['非useStable', () => ws]]) {
                it(`${en}(${sn}): 複製階段之巢狀不可讀值(id屬性、列之成員、陣列元素、u8a欄、存取器、原型為null之Date、過深巢狀)轉固定詞彙, 與頂層不可讀同通道: error事件恰一次、data為null, 資料庫不變`, async function() {
                    //A3(第557項全族對齊輪; 共同規則四.3 07:0x更正): 複製處之catch不分辨頂層與巢狀、不可讀與無法複製, 一律invalid data: must be a readable value
                    let accLen1 = () => Object.defineProperty([], 0, {
                        get() {
                            throw new Error(SECRET.get)
                        },
                        enumerable: true
                    })
                    let accLen2 = () => Object.defineProperty([{ id: 'z9', name: 'x' }], 1, {
                        get() {
                            throw new Error(SECRET.get)
                        },
                        enumerable: true
                    })
                    let deep = () => {
                        let o = {}; let c = o; for (let i = 0; i < 100000; i++) {
                            c.n = {}; c = c.n
                        } return o
                    }
                    let cases = [
                        ['id為revoked', () => ({ id: mkRevoked(), name: 'x' })],
                        ['id為tagThrow', () => ({ id: mkTagThrow(), name: 'x' })],
                        ['id為keysThrow', () => ({ id: mkKeysThrow(), name: 'x' })],
                        ['id為存取器拋錯', () => Object.defineProperty({ name: 'x' }, 'id', {
                            get() {
                                throw new Error(SECRET.get)
                            },
                            enumerable: true
                        })],
                        ['列之成員為revoked', () => ({ id: 'z1', name: mkRevoked() })],
                        ['列之成員為存取器拋錯', () => Object.defineProperty({ id: 'z1' }, 'name', {
                            get() {
                                throw new Error(SECRET.get)
                            },
                            enumerable: true
                        })],
                        ['u8a欄為revoked', () => ({ id: 'z1', name: 'x', u8a: mkRevoked() })],
                        ['u8a欄為Proxy包Uint8Array(get陷阱拋錯)', () => ({
                            id: 'z1',
                            name: 'x',
                            u8a: new Proxy(new Uint8Array(3), {
                                get() {
                                    throw new Error(SECRET.get)
                                }
                            })
                        })],
                        ['id為new Number且valueOf拋錯(複製時cloneDeep求其valueOf, 屬複製階段之拋錯; 本套件之主鍵判定不呼叫valueOf)', () => ({
                            id: Object.assign(new Number(5), {
                                valueOf() {
                                    throw new Error(SECRET.get)
                                }
                            }),
                            name: 'x'
                        })],
                        ['元素為revoked(長度1)', () => [mkRevoked()]],
                        ['元素存取器拋錯(長度2, 首元素)', () => Object.defineProperty([null, { id: 'z8', name: 'x' }], 0, {
                            get() {
                                throw new Error(SECRET.get)
                            },
                            enumerable: true
                        })],
                        ['元素為tagThrow(長度2)', () => [{ id: 'z1', name: 'x' }, mkTagThrow()]],
                        ['元素為revoked(長度2, 首元素)', () => [mkRevoked(), { id: 'z1', name: 'x' }]],
                        ['元素存取器拋錯(長度1)', accLen1],
                        ['元素存取器拋錯(長度2)', accLen2],
                        ['原型為null之Date(可讀而無法複製)', () => ({ id: 'z1', name: 'x', when: Object.setPrototypeOf(new Date(0), null) })],
                        ['過深之巢狀(可讀而無法複製)', () => ({ id: 'z1', name: 'x', meta: deep() })],
                    ]
                    for (let [t, f] of cases) {
                        ev.error = []
                        ev.change = []
                        let r = await settle(call(x(), f()))
                        assert.ok(r.err !== undefined, `${t}: 應reject, 實得${JSON.stringify(r.v)}`)
                        assert.strictEqual(msgOf(r.err), FIXED.data, `${t}: 固定詞彙`)
                        assert.ok(msgOf(r.err).indexOf('SECRET') < 0, `${t}: 不含原例外文字`)
                        assert.strictEqual(ev.error.length, 1, `${t}: error事件恰一次`)
                        assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data, ev.error[0].err], [en, null, FIXED.data], t)
                        assert.strictEqual(ev.change.length, 0, `${t}: 不發change事件`)
                        assert.deepStrictEqual(await rows(), seedExp, `${t}: 資料庫不變`)
                    }
                })
            }

            it(`${en}: 複製成功(可讀)之巢狀值不受影響: 帶Uint8Array、Buffer、Map、Set、Date、BigInt、巢狀物件、陣列之合格資料照常處理, 不誤判為不可讀(有效輸入不多讀)`, async function() {
                let r = await settle(call(w, { id: 'ok1', name: 'x', u8a: new Uint8Array([1, 2, 3]), buf: Buffer.from('ab'), m: new Map([['k', 'v']]), s: new Set(['a']), d: new Date(0), big: 12n, meta: { a: [1, { b: 2 }] } }))
                assert.ok(r.err === undefined, msgOf(r.err))
                assert.strictEqual(ev.error.length, 0)
            })

            it(`${en}: 原型為Proxy且其ownKeys陷阱拋錯之data(複製時可讀, 其後iseobj走訪原型鏈才拋): 經探針判為不可讀, 整批reject固定詞彙(error事件恰一次、data為null)`, async function() {
                //isUnreadableData之ownKeys分支: cloneDeep只讀自有鍵, iseobj之for...in沿原型鏈列舉而觸發ownKeys陷阱
                let proto = new Proxy({}, {
                    ownKeys() {
                        throw new Error(SECRET.keys)
                    }
                })
                let d = Object.create(proto, { id: { value: 'pk1', enumerable: true }, name: { value: 'x', enumerable: true } })
                let r = await settle(call(w, d))
                assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                assert.strictEqual(msgOf(r.err), FIXED.data)
                assert.strictEqual(ev.error.length, 1)
                assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data], [en, null])
                assert.deepStrictEqual(await rows(), seedExp)
            })

            it(`${en}: 原型存取器於複製後才拋錯之data(複製時可讀): 經判斷函數判為無效後之探針判為不可讀, 整批reject固定詞彙`, async function() {
                //R23.1(共同規則二.1): 探針置於判斷函數(iseobj)回false之後; 複製時存取器可讀(arm為false), useStable佇列延後執行時才拋錯, 複製後之物件保留原型故其後讀取拋錯
                let armed = false
                let proto = {
                    get [Symbol.toStringTag]() {
                        if (armed) {
                            throw new Error(SECRET.tag)
                        }
                        return 'Object'
                    },
                }
                let d = Object.create(proto, { id: { value: 'st1', enumerable: true }, name: { value: 'x', enumerable: true } })
                let p = call(w, d)
                armed = true
                let r = await settle(p)
                assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                assert.strictEqual(msgOf(r.err), FIXED.data)
                assert.strictEqual(ev.error.length, 1)
                assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data], [en, null])
                assert.deepStrictEqual(await rows(), seedExp)
            })
        }
    })

    describe('selectByPk之pk', function() {
        for (let [vn, f] of Object.entries({ revoked: mkRevoked, tagThrow: mkTagThrow })) {
            it(`pk為${vn}: reject固定詞彙invalid pk, error事件恰一次且data為null(修前為原例外文字且不發error事件)`, async function() {
                //R23.2(共同規則四.5): selectByPk之不可讀pk reject(error事件恰一次)
                let r = await settle(w.selectByPk(f()))
                assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                assert.strictEqual(msgOf(r.err), FIXED.pk)
                assert.ok(msgOf(r.err).indexOf('SECRET') < 0)
                assert.strictEqual(ev.error.length, 1)
                assert.deepStrictEqual([ev.error[0].mode, ev.error[0].data, ev.error[0].err], ['selectByPk', null, FIXED.pk])
            })
        }

        it('pk為ownKeys拋錯之Proxy(可讀: 只在列舉自有鍵時拋錯, selectByPk不列舉)維持回null', async function() {
            //R23.2(共同規則四.5): 可讀而非字串者維持回null
            assert.strictEqual(await w.selectByPk(mkKeysThrow()), null)
            assert.strictEqual(ev.error.length, 0)
        })

        it('pk為可讀之值: 5(有限數字有效)命中, 包裝物件(new String、new Number)不拆包裝而為無效回null, 布林、物件、陣列、null、undefined、空字串、NaN回null; 皆不reject、不發error事件', async function() {
            //第557項全族對齊輪(共同規則一第6點): 有限數字維持有效主鍵, new String、new Number不拆包裝; 可讀而非有效者回null(共同規則四.5)
            assert.strictEqual((await w.selectByPk(5)).name, 'seed-5')
            assert.strictEqual((await w.selectByPk('a')).name, 'seed-a')
            for (let v of [new String('a'), new Number(5), new String(''), true, {}, [], null, undefined, '', NaN, Infinity, 1n, Symbol('s'), new Date(0)]) {
                assert.strictEqual(await w.selectByPk(v), null, Object.prototype.toString.call(v))
            }
            assert.strictEqual(ev.error.length, 0)
        })

        it('pk為自訂valueOf拋錯之String包裝(可讀): 不拆包裝、不呼叫valueOf, 回null(不reject、不發error事件、不含原例外文字)', async function() {
            //第557項全族對齊輪: 包裝物件為物件而無效, valueOf不被呼叫(使用端方法拋出之文字不經本套件)
            let n = 0
            let p = Object.assign(new String('a'), {
                valueOf() {
                    n++
                    throw new Error('VALUEOF-SECRET-557')
                },
            })
            assert.strictEqual(await w.selectByPk(p), null)
            assert.strictEqual(n, 0)
            assert.strictEqual(ev.error.length, 0)
        })

        it('pk為不可讀之函數(Symbol.toStringTag拋錯)與一般函數: 不可讀者reject invalid pk, 可讀者回null', async function() {
            let f1 = () => 1
            Object.defineProperty(f1, Symbol.toStringTag, {
                get() {
                    throw new Error(SECRET.tag)
                }
            })
            let r = await settle(w.selectByPk(f1))
            assert.ok(r.err !== undefined)
            assert.strictEqual(msgOf(r.err), FIXED.pk)
            assert.strictEqual(ev.error.length, 1)
            assert.strictEqual(await w.selectByPk(() => 1), null)
            //已撤銷之函數Proxy(typeof為function)
            let rv = Proxy.revocable(function() {}, {})
            rv.revoke()
            ev.error = []
            let r2 = await settle(w.selectByPk(rv.proxy))
            assert.ok(r2.err !== undefined)
            assert.strictEqual(msgOf(r2.err), FIXED.pk)
            assert.deepStrictEqual([ev.error.length, ev.error[0].data], [1, null])
        })

        it('selectByPk之不可讀pk於非useStable實例亦同(reject invalid pk, error事件恰一次、data為null)', async function() {
            let r = await settle(ws.selectByPk(mkRevoked()))
            assert.ok(r.err !== undefined)
            assert.strictEqual(msgOf(r.err), FIXED.pk)
            assert.deepStrictEqual([ev.error.length, ev.error[0].data], [1, null])
            assert.strictEqual(await ws.selectByPk(new String('a')), null)
        })
    })

    describe('有效輸入不多讀(探針只置於判斷函數回false或拋錯之後)', function() {
        it('option之成員(instance、transaction、returnList、autoInsert)於各入口各讀一次(修前亦為一次)', async function() {
            //R23.1: 修前以get(option, key)讀一次; getOpt於成功時不再讀
            let reads = { select: ['instance', 'transaction'], selectByPk: ['instance', 'transaction'], insert: ['returnList', 'instance', 'transaction'], insertBulk: ['instance', 'transaction'], save: ['instance', 'transaction', 'autoInsert'], del: ['instance', 'transaction'], delAll: ['instance', 'transaction'] }
            for (let [en, keys] of Object.entries(reads)) {
                for (let key of keys) {
                    let n = 0
                    let o = Object.defineProperty({}, key, {
                        get() {
                            n++
                            return undefined
                        },
                        enumerable: true,
                    })
                    await settle(ENTRY[en](w, o))
                    assert.strictEqual(n, 1, `${en}之option.${key}讀取${n}次`)
                }
            }
        })

        it('selectByPk之有效主鍵(字串、有限數字)為原始值, 不經探針: 以計數存取器證明不讀取任何物件成員(物件主鍵一律無效, 由normPk直接判定, 探針只置於無效之後)', async function() {
            //有效輸入(原始值)無可讀取之成員; 無效之物件僅被chkReadable讀取其標籤(讀取次數有限), 不呼叫valueOf、toString
            let n = 0
            let p = new String('a')
            Object.defineProperty(p, 'valueOf', {
                value() {
                    n++; return 'a'
                }
            })
            Object.defineProperty(p, 'toString', {
                value() {
                    n++; return 'a'
                }
            })
            assert.strictEqual(await w.selectByPk(p), null)
            assert.strictEqual(n, 0, '不呼叫valueOf、toString')
            assert.strictEqual((await w.selectByPk('a')).name, 'seed-a')
            assert.strictEqual((await w.selectByPk(5)).name, 'seed-5')
        })
    })

    describe('genModelsByDB之option容器', function() {
        for (let [vn, f] of Object.entries(HOSTILE)) {
            it(`option為${vn}: 同步throw固定詞彙invalid option(本函數既有之同步拋出通道不變), 不含原例外文字, 不連線`, function() {
                //R23.2(共同規則四.1): 容器不可讀(展開讀其自有鍵與值即拋錯)拒絕, 名稱用容器名option
                let x = wo(getOpt({ fdModels: `${dir}/gm` }))
                assert.throws(() => x.genModelsByDB(f()), (err) => {
                    assert.strictEqual(msgOf(err), FIXED.option)
                    return true
                })
            })
        }

        it('option成員為存取器且拋錯: 同樣轉固定詞彙invalid option(同步throw, 展開無從得知成員), 不含原例外文字, 不連線', function() {
            //R23.3(共同規則四.2)
            let x = wo(getOpt({ fdModels: `${dir}/gm` }))
            let o = {
                get username() {
                    throw new Error('GETTER-SECRET-557-username')
                },
            }
            assert.throws(() => x.genModelsByDB(o), (err) => msgOf(err) === FIXED.option)
        })
    })

})

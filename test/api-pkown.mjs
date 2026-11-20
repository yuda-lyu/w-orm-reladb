import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import { msgOf, isGen, mkRevoked, mkTagThrow, mkKeysThrow } from './tools/hostile.mjs'


//本檔為mssql與sqlite共用之主鍵[只認自有可列舉之資料屬性]測試套組(rulebook R25, 第569項), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//規格句(rules-569.md, 以S1~S7標示, 斷言註解引用):
//  S1 列之主鍵欄(opt.pk)為繼承(原型鏈上, 不論值之型別)或自有不可列舉者, 視為未帶: autoGenPk開則補新主鍵(以defineProperty設為自有可列舉資料屬性, 不用賦值:
//     原型之主鍵欄為frozen或只有getter時, 嚴格模式賦值會拋TypeError), 關則照本庫既有之[未帶]處置(整批reject, 訊息invalid data[k].<pk>, autoGenPk is false)
//  S2 判定不得多讀有效輸入: 先以既有路徑取值, 值為未帶即短路; 只有值為[給了]才查描述子(propertyIsEnumerable, 不呼叫getter)
//  S3 del: 繼承之主鍵視為未給主鍵(該筆ok為0附既有之無效主鍵訊息invalid data[k].<pk>), 不得刪除庫內同值之列;
//     save: 不得以繼承值覆寫/更新同值之列; insert系: 不得因繼承值而跳過、撞鍵或寫入缺主鍵之列
//  S4 selectByPk收純量, 不適用: 傳列物件之既有回傳(null)不變
//  S5 非主鍵欄之繼承欄位: 既有處置不變(不在本項範圍)
//  S7 測試資料含與既有列同值之案(顯出跳過/覆寫/刪除)
//model: twf(id STRING主鍵, name TEXT)、twfk(key STRING主鍵, name TEXT; 主鍵欄名非id)、tpkint(id INTEGER主鍵)


class WithGetter {
    get id() {
        return 'a9'
    }
}

//可寫入之原型(getter與setter皆在原型上): 賦值會觸發setter而不產生自有屬性, defineProperty則不會
let setterHits = { n: 0 }
let mkAccessorProto = () => ({
    get id() {
        return 'a9'
    },
    set id(v) {
        setterHits.n++
    },
})

//原型上之可列舉存取器(物件字面值之get id())回傳不可讀之物件: 資料檢核走訪繼承之可列舉屬性, 被視為[未帶]之繼承主鍵不得被讀取或檢核(不外洩原例外文字)
let accProto = (hf) => () => Object.assign(Object.create({
    get id() {
        return hf()
    },
}), { name: 'new' })

//被視為[未帶]之形狀(S1): 名稱 → 工廠(每次產生全新之列); 繼承值取自庫內同值之列(a9、5、123、0), 令跳過/覆寫/刪除顯出(S7)
let UNSET_SHAPES = {
    inhSurrogate: () => Object.assign(Object.create({ id: 'a\ud800' }), { name: 'new' }),
    inhNested: () => Object.assign(Object.create({ id: { x: ['a\ud800'] } }), { name: 'new' }),
    inhAccRevoked: accProto(mkRevoked),
    inhAccTagThrow: accProto(mkTagThrow),
    inhAccKeysThrow: accProto(mkKeysThrow),
    inhStr: () => Object.assign(Object.create({ id: 'a9' }), { name: 'new' }),
    inhStrDeep: () => Object.assign(Object.create(Object.create({ id: 'a9' })), { name: 'new' }),
    inhNum: () => Object.assign(Object.create({ id: 123 }), { name: 'new' }),
    inhNumSame: () => Object.assign(Object.create({ id: 5 }), { name: 'new' }),
    inhZero: () => Object.assign(Object.create({ id: 0 }), { name: 'new' }),
    inhNul: () => Object.assign(Object.create({ id: 'a\u0000b' }), { name: 'new' }),
    inhObj: () => Object.assign(Object.create({ id: { x: 1 } }), { name: 'new' }),
    inhEmpty: () => Object.assign(Object.create({ id: '' }), { name: 'new' }),
    clsGetter: () => Object.assign(new WithGetter(), { name: 'new' }),
    frozenProto: () => Object.assign(Object.create(Object.freeze({ id: 'a9' })), { name: 'new' }),
    accessorProto: () => Object.assign(Object.create(mkAccessorProto()), { name: 'new' }),
    ownNonEnum: () => Object.defineProperty({ name: 'new' }, 'id', { value: 'a9', enumerable: false, writable: true, configurable: true }),
    ownNonEnumOverInh: () => Object.defineProperty(Object.assign(Object.create({ id: 'a9' }), { name: 'new' }), 'id', { value: 'zz', enumerable: false, writable: true, configurable: true }),
}

let SEED_Y = [{ id: 'a9', name: 'seed-a9' }, { id: '5', name: 'seed-5' }, { id: '123', name: 'seed-123' }, { id: '0', name: 'seed-0' }]
let SEED_N = [{ id: 'q', name: 'seed-q' }]
let seedStr = (seed) => seed.map((r) => `${r.id}:${r.name}`)


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql')
 * @param {Function} getOpt 輸入取得建構設定之函數
 */
export function definePkOwnSuites(label, getOpt) {

    describe(`${label} 主鍵只認自有可列舉之資料屬性(R25)`, function() {

        let ev = { error: [], change: [] }
        let mk = (ex) => {
            let w = wo(getOpt({ cl: 'twf', ...ex }))
            w.on('error', (mode, data, err) => {
                ev.error.push({ mode, err: msgOf(err) })
            })
            w.on('change', (mode) => {
                ev.change.push(mode)
            })
            return w
        }
        let adm = null //供播種與讀回(autoGenPk為false), 不計事件
        let wT = null //autoGenPk true
        let wF = null //autoGenPk false
        let admK = null
        let wKT = null
        let wKF = null
        let admI = null
        let wIF = null
        let wIT = null

        let rows = async (a = adm) => {
            let rs = await a.select()
            return rs.map((r) => `${isGen(r.id !== undefined ? r.id : r.key) ? 'GEN' : (r.id !== undefined ? r.id : r.key)}:${r.name}`).sort()
        }
        let reset = async (seed, a = adm) => {
            await a.delAll()
            await a.insert(seed)
            ev.error = []
            ev.change = []
            setterHits.n = 0
        }
        let settle = (p) => p.then((v) => ({ v })).catch((err) => ({ err }))
        let errCount = () => ev.error.length

        before(async function() {
            adm = wo(getOpt({ cl: 'twf', autoGenPk: false }))
            adm.on('error', () => {})
            await adm.createStorage()
            wT = mk({ autoGenPk: true })
            wF = mk({ autoGenPk: false })
            admK = wo(getOpt({ cl: 'twfk', pk: 'key', autoGenPk: false }))
            admK.on('error', () => {})
            await admK.createStorage()
            wKT = mk({ cl: 'twfk', pk: 'key', autoGenPk: true })
            wKF = mk({ cl: 'twfk', pk: 'key', autoGenPk: false })
            admI = wo(getOpt({ cl: 'tpkint', autoGenPk: false }))
            admI.on('error', () => {})
            await admI.createStorage()
            wIF = mk({ cl: 'tpkint', autoGenPk: false })
            wIT = mk({ cl: 'tpkint', autoGenPk: true })
        })

        //S1、S3、S7: 入口 × 形狀 × autoGenPk × 有無同值既有列
        for (let [sn, sf] of Object.entries(UNSET_SHAPES)) {
            for (let [seedName, seed] of [['有同值既有列', SEED_Y], ['無同值既有列', SEED_N]]) {
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    for (let ag of [true, false]) {
                        it(`${fn} autoGenPk=${ag} ${sn} ${seedName}: 視為未帶(同鍵不存在)${ag ? ', 補新主鍵寫入一列, 既有列原封不動' : ', 整批reject(autoGenPk is false), 不寫入'}`, async function() {
                            //S1: 繼承或自有不可列舉者視為未帶, autoGenPk開則補新主鍵、關則照既有未帶處置; S3: 不得跳過、撞鍵、覆寫、寫入以繼承值為主鍵之列
                            await reset(seed)
                            let w = ag ? wT : wF
                            let r = await settle(w[fn](sf()))
                            if (ag) {
                                assert.ok(r.err === undefined, `不應reject: ${msgOf(r.err)}`)
                                let exp = fn === 'save' ? [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }] : { n: 1, nInserted: 1, ok: 1 }
                                assert.deepStrictEqual(r.v, exp)
                                assert.strictEqual(errCount(), 0)
                                assert.deepStrictEqual(await rows(), [...seedStr(seed), 'GEN:new'].sort(), '既有列不變(不跳過、不覆寫), 多一列自動產生主鍵者')
                            }
                            else {
                                assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                                assert.strictEqual(msgOf(r.err), 'invalid data[0].id, autoGenPk is false')
                                assert.strictEqual(errCount(), 1, 'error事件恰一次')
                                assert.deepStrictEqual(await rows(), seedStr(seed).sort(), '不寫入')
                            }
                        })
                    }
                }

                it(`del ${sn} ${seedName}: 繼承之主鍵視為未給主鍵, 該筆ok為0附invalid data[0].id, 不刪除庫內同值之列`, async function() {
                    //S3: del不得刪除庫內同值之列, 該筆ok為0附本庫既有之無效主鍵訊息
                    await reset(seed)
                    let r = await adm.del(sf())
                    assert.deepStrictEqual(r, [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].id' }])
                    assert.deepStrictEqual(await rows(), seedStr(seed).sort(), '庫內同值之列未被刪除')
                })
            }
        }

        //S1: 補值以defineProperty, 不觸發原型之setter(賦值會觸發); 原型為frozen或只有getter者不拋TypeError(上列案已涵蓋)
        it('補值以defineProperty而非賦值: 原型上有setter者不被呼叫, 且新列之主鍵為自動產生值(非原型getter之值)', async function() {
            //S1: 以Object.defineProperty設為自有可列舉資料屬性, 不用賦值
            await reset(SEED_Y)
            for (let fn of ['insert', 'insertBulk', 'save']) {
                let r = await settle(wT[fn](UNSET_SHAPES.accessorProto()))
                assert.ok(r.err === undefined, msgOf(r.err))
            }
            assert.strictEqual(setterHits.n, 0, '原型上之setter不得被呼叫')
            let rs = await rows()
            assert.strictEqual(rs.filter((v) => v === 'GEN:new').length, 3)
            assert.strictEqual(rs.filter((v) => v === 'a9:new').length, 0)
        })

        //S1、S3: 混合批次: 自有者照常, 繼承者視為未帶, 索引對應正確
        it('insert、insertBulk混合批次(自有、繼承、自有): autoGenPk為true時繼承者補新主鍵, 自有者照常, 既有列a9不變', async function() {
            //S1、S3
            for (let fn of ['insert', 'insertBulk']) {
                await reset(SEED_Y)
                let r = await wT[fn]([{ id: 'ok1', name: 'o1' }, UNSET_SHAPES.inhStr(), { id: 'ok2', name: 'o2' }])
                assert.deepStrictEqual(r, { n: 3, nInserted: 3, ok: 1 }, fn)
                assert.deepStrictEqual(await rows(), [...seedStr(SEED_Y), 'ok1:o1', 'GEN:new', 'ok2:o2'].sort(), fn)
            }
        })

        it('insert、insertBulk、save混合批次(自有、繼承、自有): autoGenPk為false時以索引最小之未帶筆整批reject(invalid data[1].id), 同批不寫入', async function() {
            //S1: 關則照既有[未帶]處置: 整批性錯誤、不寫入任何一筆
            for (let fn of ['insert', 'insertBulk', 'save']) {
                await reset(SEED_Y)
                let r = await settle(wF[fn]([{ id: 'ok1', name: 'o1' }, UNSET_SHAPES.inhStr(), { id: 'ok2', name: 'o2' }]))
                assert.strictEqual(msgOf(r.err), 'invalid data[1].id, autoGenPk is false', fn)
                assert.deepStrictEqual(await rows(), seedStr(SEED_Y).sort(), fn)
            }
        })

        it('save混合批次(自有更新、繼承、自有新增): 自有者照常更新/新增, 繼承者不更新同值之列而補新主鍵新增', async function() {
            //S3: save不得以繼承值覆寫/更新同值之列
            await reset(SEED_Y)
            let r = await wT.save([{ id: 'a9', name: 'upd-a9' }, UNSET_SHAPES.inhStr(), { id: 'ok2', name: 'o2' }])
            assert.deepStrictEqual(r, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }, { n: 1, nInserted: 1, nModified: 0, ok: 1 }, { n: 1, nInserted: 1, nModified: 0, ok: 1 }])
            assert.deepStrictEqual(await rows(), ['0:seed-0', '123:seed-123', '5:seed-5', 'GEN:new', 'a9:upd-a9', 'ok2:o2'].sort())
        })

        it('del混合批次(自有、繼承、自有): 只刪自有者, 繼承者該筆ok為0(索引對應)且不刪同值之列', async function() {
            //S3
            await reset(SEED_Y)
            let r = await adm.del([{ id: '5' }, UNSET_SHAPES.inhStr(), { id: '0' }])
            assert.deepStrictEqual(r, [{ n: 1, nDeleted: 1, ok: 1 }, { n: 0, nDeleted: 0, ok: 0, err: 'invalid data[1].id' }, { n: 1, nDeleted: 1, ok: 1 }])
            assert.deepStrictEqual(await rows(), ['123:seed-123', 'a9:seed-a9'])
        })

        //S1: 自有可列舉者行為不變(對照案)
        describe('自有可列舉之主鍵: 行為不變(對照)', function() {

            let OWN = {
                ownEnum: () => ({ id: 'a9', name: 'new' }),
                ownOverInh: () => Object.assign(Object.create({ id: 'a9' }), { id: 'own1', name: 'new' }),
                ownAccessor: () => Object.defineProperty({ name: 'new' }, 'id', {
                    get() {
                        return 'acc1'
                    },
                    enumerable: true,
                    configurable: true,
                }),
            }

            it('ownEnum(同值既有列): insert跳過(nInserted 0)、save更新該列、del刪除該列', async function() {
                //S1: 自有可列舉之主鍵照常
                await reset(SEED_Y)
                assert.deepStrictEqual(await wT.insert(OWN.ownEnum()), { n: 1, nInserted: 0, ok: 1 })
                assert.deepStrictEqual(await rows(), seedStr(SEED_Y).sort())
                assert.deepStrictEqual(await wT.save(OWN.ownEnum()), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                assert.deepStrictEqual(await rows(), ['0:seed-0', '123:seed-123', '5:seed-5', 'a9:new'])
                assert.deepStrictEqual(await adm.del(OWN.ownEnum()), [{ n: 1, nDeleted: 1, ok: 1 }])
                assert.deepStrictEqual(await rows(), ['0:seed-0', '123:seed-123', '5:seed-5'])
            })

            it('ownEnum(同值既有列): insertBulk整批reject(撞鍵), 資料庫不變', async function() {
                //S1: 自有可列舉之主鍵照常(撞鍵之訊息依資料庫, 只斷言reject)
                await reset(SEED_Y)
                let r = await settle(wT.insertBulk(OWN.ownEnum()))
                assert.ok(r.err !== undefined)
                assert.deepStrictEqual(await rows(), seedStr(SEED_Y).sort())
            })

            it('ownOverInh(自有主鍵遮蔽繼承之a9): 以自有值own1寫入, 同值之a9列不動; del只刪own1', async function() {
                //S1: 自有可列舉者優先於原型上之值
                await reset(SEED_Y)
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    await reset(SEED_Y)
                    let r = await settle(wT[fn](OWN.ownOverInh()))
                    assert.ok(r.err === undefined, `${fn}: ${msgOf(r.err)}`)
                    assert.deepStrictEqual(await rows(), [...seedStr(SEED_Y), 'own1:new'].sort(), fn)
                    let rd = await adm.del(OWN.ownOverInh())
                    assert.deepStrictEqual(rd, [{ n: 1, nDeleted: 1, ok: 1 }], fn)
                    assert.deepStrictEqual(await rows(), seedStr(SEED_Y).sort(), fn)
                }
            })

            it('ownAccessor(自有可列舉存取器, 複製為資料屬性): 以存取器之值acc1寫入', async function() {
                //S1: 自有可列舉者(含存取器於複製階段轉為資料屬性)照常
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    await reset(SEED_N)
                    let r = await settle(wT[fn](OWN.ownAccessor()))
                    assert.ok(r.err === undefined, `${fn}: ${msgOf(r.err)}`)
                    assert.deepStrictEqual(await rows(), [...seedStr(SEED_N), 'acc1:new'].sort(), fn)
                }
            })

            it('自有主鍵為未帶之值(undefined、null、空字串): 與鍵不存在同處置(autoGenPk為true補新主鍵; 為false reject)', async function() {
                //S1: 未帶之既有定義(R22.1)不變
                for (let v of [undefined, null, '']) {
                    await reset(SEED_Y)
                    let r = await settle(wT.insert({ id: v, name: 'new' }))
                    assert.deepStrictEqual(r.v, { n: 1, nInserted: 1, ok: 1 })
                    let rf = await settle(wF.insert({ id: v, name: 'new' }))
                    assert.strictEqual(msgOf(rf.err), 'invalid data[0].id, autoGenPk is false')
                    assert.deepStrictEqual(await rows(), [...seedStr(SEED_Y), 'GEN:new'].sort())
                }
            })

        })

        //S4: selectByPk收純量, 傳列物件之既有回傳(null)不變, 不發事件
        it('selectByPk傳列物件(繼承、自有)回null且不發error事件; 傳純量照常(S4)', async function() {
            //S4: 不適用, 以測試釘住既有回傳
            await reset(SEED_Y)
            for (let f of [UNSET_SHAPES.inhStr, UNSET_SHAPES.clsGetter, UNSET_SHAPES.frozenProto, () => ({ id: 'a9' })]) {
                assert.strictEqual(await wT.selectByPk(f()), null)
            }
            assert.strictEqual(errCount(), 0)
            assert.strictEqual((await wT.selectByPk('a9')).name, 'seed-a9')
        })

        //S5: 非主鍵欄之繼承欄位、非物件之列、無自有鍵之物件: 既有處置不變
        it('非主鍵欄之繼承欄位(S5): 繼承之name不被寫入(既有處置), 自有id照常', async function() {
            //S5: 非主鍵欄之繼承可列舉欄位, 各庫既有處置不變
            for (let fn of ['insert', 'insertBulk', 'save']) {
                await reset(SEED_N)
                let r = await settle(wT[fn](Object.assign(Object.create({ name: 'inh-name' }), { id: 'n1' })))
                assert.ok(r.err === undefined, `${fn}: ${msgOf(r.err)}`)
                let all = await adm.select()
                let n1 = all.find((v) => v.id === 'n1')
                assert.ok(n1 !== undefined, `${fn}: n1已寫入`)
                assert.strictEqual(n1.name, null, `${fn}: 繼承之name維持既有處置(不寫入)`)
            }
        })

        it('非物件之列與無自有鍵之物件(既有處置不變): insert([5])拋原生TypeError(autoGenPk為true)、autoGenPk為false時為未帶之拒絕; 鍵全在原型上之單一物件與空物件為輸入無效之早退', async function() {
            //S1 非物件之列維持賦值(使既有之原生TypeError訊息不變); 其餘為規則以外之行為
            await reset(SEED_Y)
            let r = await settle(wT.insert([5]))
            assert.strictEqual(msgOf(r.err), `Cannot create property 'id' on number '5'`)
            let rf = await settle(wF.insert([5]))
            assert.strictEqual(msgOf(rf.err), 'invalid data[0].id, autoGenPk is false')
            assert.deepStrictEqual(await wT.insert(Object.create({ id: 'a9' })), { n: 0, nInserted: 0, ok: 1 })
            assert.deepStrictEqual(await wT.insert({}), { n: 0, nInserted: 0, ok: 1 })
            assert.deepStrictEqual(await wT.save(Object.create({ id: 'a9' })), [])
            assert.deepStrictEqual(await adm.del(Object.create({ id: 'a9' })), [])
            assert.deepStrictEqual(await adm.del([5]), [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].id' }])
            assert.deepStrictEqual(await rows(), seedStr(SEED_Y).sort())
        })

        //S5: 資料檢核之走訪只遮蔽主鍵欄, 非主鍵欄之繼承欄位(含孤立代理碼元者)照既有處置被拒
        it('非主鍵欄之繼承可列舉欄位含孤立代理碼元者仍被資料檢核拒收(既有處置不變); 同列之繼承主鍵視為未帶不影響此判定', async function() {
            //S5 + R13: 遮蔽只及主鍵欄
            await reset(SEED_Y)
            let mkRow = () => Object.assign(Object.create({ id: 'a9', memo: 'a\ud800' }), { name: 'new' })
            let ri = await settle(wT.insert(mkRow()))
            assert.strictEqual(msgOf(ri.err), 'invalid data: string contains lone surrogate at [data[0].memo]')
            let rs = await wT.save(mkRow())
            assert.deepStrictEqual([rs[0].ok, rs[0].err], [0, 'invalid data: string contains lone surrogate at [data[0].memo]'])
            assert.deepStrictEqual(await rows(), seedStr(SEED_Y).sort())
        })

        //S1、S3: useStable為false時(snap不經佇列)亦同
        it('useStable為false時亦同: 繼承之主鍵視為未帶(insert補新主鍵、save不更新同值列、del不刪同值列)', async function() {
            //S1、S3: 兩種useStable皆經snap與chkWf、procPk
            let w = mk({ autoGenPk: true, useStable: false })
            await reset(SEED_Y)
            assert.deepStrictEqual(await w.insert(UNSET_SHAPES.clsGetter()), { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(await w.save(UNSET_SHAPES.frozenProto()), [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }])
            assert.deepStrictEqual(await w.del(UNSET_SHAPES.inhStr()), [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].id' }])
            assert.deepStrictEqual(await rows(), [...seedStr(SEED_Y), 'GEN:new', 'GEN:new'].sort())
        })

        //S1: 主鍵欄名非id(opt.pk)
        describe('主鍵欄名非id(opt.pk為key, twfk)', function() {

            let SEED_K = [{ key: 'a9', name: 'seed-a9' }, { key: 'q', name: 'seed-q' }]
            let KS = {
                inhStr: () => Object.assign(Object.create({ key: 'a9' }), { name: 'new' }),
                clsGetter: () => Object.assign(new (class {
                    get key() {
                        return 'a9'
                    }
                })(), { name: 'new' }),
                frozenProto: () => Object.assign(Object.create(Object.freeze({ key: 'a9' })), { name: 'new' }),
                ownNonEnum: () => Object.defineProperty({ name: 'new' }, 'key', { value: 'a9', enumerable: false, writable: true, configurable: true }),
            }
            let ksStr = SEED_K.map((r) => `${r.key}:${r.name}`)

            for (let [sn, sf] of Object.entries(KS)) {
                it(`${sn}: insert/insertBulk/save(autoGenPk為true)補新主鍵、同值之a9列不動; autoGenPk為false整批reject(invalid data[0].key); del該筆ok為0`, async function() {
                    //S1、S3: 主鍵欄名為opt.pk(非固定id)
                    for (let fn of ['insert', 'insertBulk', 'save']) {
                        await reset(SEED_K, admK)
                        let r = await settle(wKT[fn](sf()))
                        assert.ok(r.err === undefined, `${fn}: ${msgOf(r.err)}`)
                        assert.deepStrictEqual(await rows(admK), [...ksStr, 'GEN:new'].sort(), fn)
                        await reset(SEED_K, admK)
                        let rf = await settle(wKF[fn](sf()))
                        assert.strictEqual(msgOf(rf.err), 'invalid data[0].key, autoGenPk is false', fn)
                        assert.deepStrictEqual(await rows(admK), ksStr.sort(), fn)
                    }
                    await reset(SEED_K, admK)
                    assert.deepStrictEqual(await admK.del(sf()), [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].key' }])
                    assert.deepStrictEqual(await rows(admK), ksStr.sort())
                })
            }

            it('opt.pk為key時, 列上繼承之id(非主鍵欄)不影響: 自有key照常寫入', async function() {
                //S5: 非主鍵欄之繼承欄位既有處置不變
                await reset(SEED_K, admK)
                assert.deepStrictEqual(await wKF.insert(Object.assign(Object.create({ id: 'zzz' }), { key: 'k1', name: 'new' })), { n: 1, nInserted: 1, ok: 1 })
                assert.deepStrictEqual(await rows(admK), [...ksStr, 'k1:new'].sort())
            })

        })

        //S1: INTEGER主鍵欄(主鍵欄型別不符自動產生之字串): 繼承之數字視為未帶, 同鍵不存在之處置
        describe('INTEGER主鍵欄(tpkint)', function() {

            let seedI = async () => {
                await admI.delAll()
                await admI.insert([{ id: 5, name: 'i5' }, { id: 12, name: 'i12' }])
                ev.error = []
            }
            let inhNum5 = () => Object.assign(Object.create({ id: 5 }), { name: 'new' })
            let idsOf = async () => (await admI.select()).map((v) => `${v.id}:${v.name}`).sort()

            it('autoGenPk為false: 繼承之數字5視為未帶, insert/insertBulk/save整批reject(invalid data[0].id, autoGenPk is false), 不更新/不寫入同值之5列; del該筆ok為0', async function() {
                //S1、S3: 與鍵不存在同處置
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    await seedI()
                    let r = await settle(wIF[fn](inhNum5()))
                    assert.strictEqual(msgOf(r.err), 'invalid data[0].id, autoGenPk is false', fn)
                    assert.deepStrictEqual(await idsOf(), ['12:i12', '5:i5'], fn)
                }
                await seedI()
                assert.deepStrictEqual(await admI.del(inhNum5()), [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].id' }])
                assert.deepStrictEqual(await idsOf(), ['12:i12', '5:i5'])
            })

            it('autoGenPk為true: 繼承之數字5視為未帶, 與鍵不存在同處置(主鍵欄非字串類, 以明確訊息拒絕), 不更新/不寫入同值之5列', async function() {
                //S1: 與鍵不存在之結果逐字相同(差分: 以同一實例對鍵不存在之列取預期)
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    await seedI()
                    let rAbs = await settle(wIT[fn]({ name: 'new' }))
                    let rInh = await settle(wIT[fn](inhNum5()))
                    assert.ok(rAbs.err !== undefined, `${fn}: 對照(鍵不存在)應reject`)
                    assert.ok(msgOf(rAbs.err).startsWith('autoGenPk is true but pk column [id] in model [tpkint] is [INTEGER]'), msgOf(rAbs.err))
                    assert.strictEqual(msgOf(rInh.err), msgOf(rAbs.err), fn)
                    assert.deepStrictEqual(await idsOf(), ['12:i12', '5:i5'], fn)
                }
            })

        })

        //S2: 判定不多讀有效輸入——值為未帶時不查描述子; 值為給了時才查
        describe('判定不多讀(S2): 以propertyIsEnumerable之呼叫計數觀察', function() {

            let spy = async (fn) => {
                let hits = 0
                let orig = Object.prototype.propertyIsEnumerable
                /* eslint-disable no-extend-native */ //計數用之暫時替換(finally還原), 只計以主鍵欄名id查具探針標記之列者
                Object.prototype.propertyIsEnumerable = function(k) {
                    let isProbe = false
                    try {
                        isProbe = k === 'id' && this !== null && typeof this === 'object' && this.name === 'pe-probe'
                    }
                    catch (err) {}
                    if (isProbe) {
                        hits++
                    }
                    return orig.call(this, k)
                }
                try {
                    await fn()
                }
                finally {
                    Object.prototype.propertyIsEnumerable = orig
                }
                /* eslint-enable no-extend-native */
                return hits
            }

            let UNSETV = {
                absent: () => ({ name: 'pe-probe' }),
                undef: () => ({ id: undefined, name: 'pe-probe' }),
                null: () => ({ id: null, name: 'pe-probe' }),
                empty: () => ({ id: '', name: 'pe-probe' }),
            }

            for (let [vn, vf] of Object.entries(UNSETV)) {
                for (let fn of ['insert', 'insertBulk', 'save', 'del']) {
                    it(`${fn} 主鍵為${vn}(未帶)且autoGenPk為false: 值為未帶即短路, 不以主鍵欄查描述子(0次)`, async function() {
                        //S2: 先以既有路徑取值, 值為未帶即短路
                        await reset(SEED_Y)
                        let hits = await spy(async() => {
                            await settle((fn === 'del' ? adm : wF)[fn](vf()))
                        })
                        assert.strictEqual(hits, 0)
                    })
                }
            }

            for (let fn of ['insert', 'save', 'del']) {
                it(`${fn} 主鍵為自有有效值(給了): 才查描述子(至少1次), 結果照常`, async function() {
                    //S2: 只有值為[給了]才查描述子
                    await reset(SEED_Y)
                    let hits = await spy(async() => {
                        await settle((fn === 'del' ? adm : wF)[fn]({ id: 'a9', name: 'pe-probe' }))
                    })
                    assert.ok(hits >= 1, `hits=${hits}`)
                })
            }

            it('autoGenPk為true且主鍵為未帶: 補值時setPk查一次(選定寫入方式), 不多於1次', async function() {
                //S2: 補值前之判定不查, 補值時只為選定寫入方式查一次
                await reset(SEED_Y)
                let hits = await spy(async() => {
                    await wT.insert({ name: 'pe-probe' })
                })
                assert.strictEqual(hits, 1)
            })

        })

    })

}

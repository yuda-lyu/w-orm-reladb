/* eslint-disable no-new-wrappers */ //包裝物件(new String、new Number)為被測之輸入, 非筆誤
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import { NOT_GIVEN, GIVEN_BAD, HOSTILE, withId, msgOf, isGen } from './tools/hostile.mjs'


//本檔為mssql與sqlite共用之主鍵[給了而非字串或有限數字]測試套組(rulebook R22, 第557項), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//規則(共同規則一, 本套件依R8之主鍵欄型別正規化而有限數字亦為有效主鍵, 與全族之[給了而非字串即拒絕]不同處見R22):
//  [未帶]只有undefined、null、空字串(含鍵不存在): autoGenPk為true時自動產生, 為false時整批reject(訊息invalid data[k].id, autoGenPk is false, 不變);
//  [給了而非字串或有限數字](布林、物件、陣列、NaN、±Infinity、BigInt、Symbol、Date、函數、new String、new Number、new Boolean等包裝物件、讀取即拋錯之值等)一律拒絕, 不得靜默換成自動產生之主鍵寫入, 不隨autoGenPk改變:
//    insert、insertBulk整批reject(error事件恰一次、同批皆不寫入), save該筆ok為0附err(同批其他筆照常, error事件恰一次), 訊息invalid id: not a string or finite number at [data[<k>].id], 不回顯值;
//  del、selectByPk修前即拒絕/回null, 核實不變(del該筆ok為0附invalid data[k].id、selectByPk回null)
//  有限數字為有效主鍵(R8, 不變); new String、new Number為物件, 不拆包裝而拒絕(第557項全族對齊輪, 共同規則一第6點; 與w-orm-mdb之normPk一致), selectByPk回null、del該筆ok為0
//第569項(R25)更正: 主鍵只認自有可列舉之資料屬性, 經原型存取器取得(繼承)之主鍵(含不可讀之物件)視為[未帶], 不屬上述[給了而非字串或有限數字]; 讀取即拋錯之存取器(無從判定其值)仍歸入拒絕(見api-pkown.mjs)
//model: twf(id STRING主鍵, name TEXT; 專用資料表)、tpkint(id INTEGER主鍵)


let MSG = (k) => `invalid id: not a string or finite number at [data[${k}].id]`


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql')
 * @param {Function} getOpt 輸入取得建構設定之函數
 */
export function definePkGivenSuites(label, getOpt) {

    describe(`${label} 主鍵給了而非字串或有限數字之拒絕(R22)`, function() {

        let mk = (ex) => {
            let w = wo(getOpt({ cl: 'twf', ...ex }))
            w.on('error', (mode, data, err) => {
                ev.error.push({ mode, data, err: msgOf(err) })
            })
            w.on('change', (mode) => {
                ev.change.push(mode)
            })
            return w
        }

        let ev = { error: [], change: [] }
        let adm = null //供播種與讀回, 另有自己之事件監聽(測試期間不計)
        let wT = null //autoGenPk true
        let wF = null //autoGenPk false
        let admI = null
        let wI = null //tpkint

        let seedRows = [{ id: 'a', name: 'seed-a' }, { id: '5', name: 'seed-5' }]
        let seedExp = ['5:seed-5', 'a:seed-a']

        let rows = async (a = adm) => {
            let rs = await a.select()
            return rs.map((r) => `${isGen(r.id) ? 'GEN' : r.id}:${r.name}`).sort()
        }
        let reset = async () => {
            await adm.delAll()
            await adm.insert(seedRows)
            ev.error = []
            ev.change = []
        }
        let settle = (p) => p.then((v) => ({ v })).catch((err) => ({ err }))
        let errCount = () => ev.error.length

        before(async function() {
            adm = wo(getOpt({ cl: 'twf', autoGenPk: false }))
            adm.on('error', () => {})
            await adm.createStorage()
            wT = mk({ autoGenPk: true })
            wF = mk({ autoGenPk: false })
            admI = wo(getOpt({ cl: 'tpkint', autoGenPk: false }))
            admI.on('error', () => {})
            await admI.createStorage()
            wI = mk({ cl: 'tpkint', autoGenPk: false })
        })

        beforeEach(async function() {
            await reset()
        })

        //給了而非字串或有限數字: insert、insertBulk整批reject
        for (let ag of [true, false]) {
            for (let [vn, f] of Object.entries(GIVEN_BAD)) {
                for (let fn of ['insert', 'insertBulk']) {
                    it(`${fn} autoGenPk=${ag}: id為${vn}整批reject(error事件恰一次、同批不寫入、不補新主鍵)`, async function() {
                        //R22.2: 給了而非字串或有限數字一律拒絕, 訊息invalid id: not a string or finite number at [data[<k>].id]; R22.3: 不隨autoGenPk改變
                        let w = ag ? wT : wF
                        let r = await settle(w[fn]([{ id: 'ok1', name: 'good' }, withId(f()), { id: 'ok2', name: 'good2' }]))
                        assert.ok(r.err !== undefined, `應reject, 實得${JSON.stringify(r.v)}`)
                        assert.strictEqual(msgOf(r.err), MSG(1))
                        assert.strictEqual(errCount(), 1, 'error事件恰一次')
                        assert.deepStrictEqual([ev.error[0].mode, ev.error[0].err], [fn, MSG(1)])
                        //A4(第557項全族對齊輪): invalid id已過入口階段(選項與資料之讀取、判定與複製), error事件之data不變, 為複製後之輸入(非null)
                        assert.notStrictEqual(ev.error[0].data, null, 'invalid id之error事件data為複製後之輸入, 不是null')
                        assert.strictEqual(ev.change.length, 0, 'change不發')
                        assert.deepStrictEqual(await rows(), seedExp, '同批皆不寫入, 不多出自動產生之主鍵')
                    })
                }

                it(`save autoGenPk=${ag}: id為${vn}該筆ok為0附err(error事件恰一次), 同批其他筆照常, 不補新主鍵`, async function() {
                    //R22.2、R22.3: save為逐筆通道(同R13之不合格主鍵)
                    let w = ag ? wT : wF
                    let r = await w.save([{ id: 'ok1', name: 'good' }, withId(f()), { id: 'ok2', name: 'good2' }])
                    assert.deepStrictEqual(r.map((v) => v.ok), [1, 0, 1])
                    assert.deepStrictEqual([r[1].n, r[1].nInserted, r[1].nModified, r[1].err], [1, 0, 0, MSG(1)])
                    assert.strictEqual(errCount(), 1, 'error事件恰一次')
                    assert.deepStrictEqual([ev.error[0].mode, ev.error[0].err], ['save', MSG(1)])
                    assert.deepStrictEqual(await rows(), [...seedExp, 'ok1:good', 'ok2:good2'].sort())
                })
            }
        }

        //經原型存取器取得之主鍵值(繼承): 第569項(R25)起主鍵只認自有可列舉之資料屬性, 繼承者(不論值之型別, 含不可讀之物件)視為[未帶], 不再屬R22之[給了而非字串或有限數字]而拒絕;
        //自有屬性者於複製階段即拋(見api-readable); 讀取即拋錯之存取器(無從判定其值)仍歸入R22之拒絕(見下一案)
        for (let [hn, hf] of Object.entries(HOSTILE)) {
            for (let ag of [true, false]) {
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    it(`${fn} autoGenPk=${ag}: id經原型存取器取得且為${hn}(繼承, R25視為未帶): ${ag ? '補新主鍵寫入' : '照未帶之既有訊息整批reject'}, 不讀取其值而外洩原例外文字`, async function() {
                        //R25(取代修前R22.2對繼承之不可讀物件之拒絕): 繼承之主鍵視為未帶, 與鍵不存在同處置; 資料檢核不走訪被遮蔽之繼承主鍵, 故不外洩原例外文字
                        let proto = {
                            get id() {
                                return hf()
                            },
                        }
                        let d = Object.create(proto, { name: { value: 'new', enumerable: true } })
                        let w = ag ? wT : wF
                        let r = await settle(w[fn](d))
                        if (ag) {
                            assert.ok(r.err === undefined, msgOf(r.err))
                            assert.strictEqual(errCount(), 0)
                            assert.deepStrictEqual(await rows(), [...seedExp, 'GEN:new'].sort())
                        }
                        else {
                            assert.ok(r.err !== undefined)
                            assert.strictEqual(msgOf(r.err), 'invalid data[0].id, autoGenPk is false')
                            assert.strictEqual(errCount(), 1)
                            assert.deepStrictEqual(await rows(), seedExp)
                        }
                        assert.ok(ev.error.every((e) => String(e.err).indexOf('SECRET') < 0))
                    })
                }
            }
        }

        //存取器拋錯與自訂valueOf拋錯之主鍵: 於讀取處捕捉並歸入[給了而非字串或有限數字](共同規則一.2、四.2), 不含原例外文字
        for (let ag of [true, false]) {
            for (let fn of ['insert', 'insertBulk', 'save']) {
                it(`${fn} autoGenPk=${ag}: id經原型存取器取得而拋錯、id為valueOf拋錯之String包裝(不拆包裝、不呼叫valueOf): 拒絕且固定詞彙不含原例外文字, 不補新主鍵`, async function() {
                    //R22.2、R23.3: 修前存取器拋錯為整批reject之原例外文字(save亦整批); 第557項全族對齊輪: 包裝物件不拆包裝, valueOf不被呼叫
                    let w = ag ? wT : wF
                    let mkAcc = () => Object.create({
                        get id() {
                            throw new Error('GETTER-SECRET-557')
                        },
                    }, { name: { value: 'new', enumerable: true } })
                    let mkVo = () => ({
                        id: Object.assign(new String('vo'), {
                            valueOf() {
                                throw new Error('VALUEOF-SECRET-557')
                            },
                        }),
                        name: 'new',
                    })
                    for (let [t, mk2] of [['存取器', mkAcc], ['valueOf', mkVo]]) {
                        ev.error = []
                        let r = await settle(w[fn](mk2()))
                        if (fn === 'save') {
                            assert.ok(r.err === undefined, `${t}: ${msgOf(r.err)}`)
                            assert.deepStrictEqual([r.v[0].ok, r.v[0].err], [0, MSG(0)], t)
                        }
                        else {
                            assert.ok(r.err !== undefined, t)
                            assert.strictEqual(msgOf(r.err), MSG(0), t)
                        }
                        assert.ok(ev.error.every((e) => String(e.err).indexOf('SECRET') < 0), t)
                        assert.deepStrictEqual(await rows(), seedExp, t)
                    }
                })
            }
        }

        //未帶(undefined、null、空字串、鍵不存在)
        for (let [vn, f] of Object.entries(NOT_GIVEN)) {
            for (let fn of ['insert', 'insertBulk', 'save']) {
                it(`${fn} autoGenPk=true: id為${vn}(未帶)自動產生新主鍵並寫入`, async function() {
                    //R22.1: 未帶只有undefined、null、空字串(含鍵不存在); autoGenPk為true時自動產生
                    let r = await wT[fn](withId(f()))
                    assert.ok(r !== undefined)
                    assert.strictEqual(errCount(), 0)
                    let rs = await rows()
                    assert.strictEqual(rs.length, 3)
                    assert.ok(rs.includes('GEN:new'), rs.join('|'))
                })

                it(`${fn} autoGenPk=false: id為${vn}(未帶)照既有訊息整批reject(autoGenPk is false), 不寫入`, async function() {
                    //R22.1: autoGenPk為false時照各庫既有之拒絕(訊息不變)
                    let r = await settle(wF[fn](withId(f())))
                    assert.ok(r.err !== undefined)
                    assert.strictEqual(msgOf(r.err), 'invalid data[0].id, autoGenPk is false')
                    assert.strictEqual(errCount(), 1)
                    assert.deepStrictEqual(await rows(), seedExp)
                })
            }
        }

        //有效主鍵不變(R8: 字串與有限數字為有效主鍵); 包裝物件(new String、new Number)不拆包裝而拒絕(第557項全族對齊輪, 共同規則一第6點)
        it('有效主鍵不變: 字串與有限數字(字串欄存為字串, 與字串主鍵欄之R8一致)', async function() {
            //R8: 字串類主鍵欄之有限數字以String(v)處置; R22不改變此契約
            assert.deepStrictEqual(await wT.insert({ id: 77, name: 'n77' }), { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(await wT.insert({ id: 's88', name: 'n88' }), { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(await wT.insertBulk({ id: 99, name: 'n99' }), { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(await wT.save({ id: 5, name: 'upd5' }), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.strictEqual(errCount(), 0)
            assert.deepStrictEqual(await rows(), ['5:upd5', '77:n77', '99:n99', 'a:seed-a', 's88:n88'])
        })

        it('有效主鍵之邊界: 0、負數、小數於字串欄存為字串', async function() {
            //R22.1: 有限數字(含0與負數)有效(R8)
            assert.deepStrictEqual(await wT.insert([{ id: 0, name: 'n0' }, { id: -5, name: 'nm5' }, { id: 1.5, name: 'n15' }]), { n: 3, nInserted: 3, ok: 1 })
            assert.deepStrictEqual(await rows(), [...seedExp, '-5:nm5', '0:n0', '1.5:n15'].sort())
            assert.strictEqual(errCount(), 0)
        })

        it('包裝物件不拆包裝(共同規則一第6點; 與w-orm-mdb之normPk一致): new String、new Number(含內容為空字串、0者)一律拒絕, 不補新主鍵、不寫入; selectByPk回null; del該筆ok為0', async function() {
            //第557項全族對齊輪: 修前拆包裝為原始值而照有效主鍵處理(new String('')視為未帶而補新主鍵)
            for (let [vn, f] of [['new String', () => new String('s88')], ['new String(空字串)', () => new String('')], ['new Number', () => new Number(99)], ['new Number(0)', () => new Number(0)]]) {
                for (let ag of [true, false]) {
                    let w = ag ? wT : wF
                    ev.error = []
                    let r1 = await settle(w.insert({ id: f(), name: 'wr' }))
                    assert.strictEqual(msgOf(r1.err), MSG(0), `insert ag=${ag} ${vn}`)
                    let r2 = await settle(w.insertBulk({ id: f(), name: 'wr' }))
                    assert.strictEqual(msgOf(r2.err), MSG(0), `insertBulk ag=${ag} ${vn}`)
                    let r3 = await w.save({ id: f(), name: 'wr' })
                    assert.deepStrictEqual([r3[0].ok, r3[0].err], [0, MSG(0)], `save ag=${ag} ${vn}`)
                    assert.strictEqual(errCount(), 3, `${vn}: 三入口各發一次error事件`)
                }
                assert.strictEqual(await wT.selectByPk(f()), null, `selectByPk ${vn}`)
                let rd = await adm.del([{ id: f() }])
                assert.deepStrictEqual([rd[0].ok, rd[0].err], [0, 'invalid data[0].id'], `del ${vn}`)
            }
            assert.deepStrictEqual(await rows(), seedExp, '資料庫不變, 不多出自動產生之主鍵')
            //對照: 以原始值給(同內容)有效
            assert.deepStrictEqual(await wT.insert({ id: 's88', name: 'ok' }), { n: 1, nInserted: 1, ok: 1 })
            assert.strictEqual((await wT.selectByPk('s88')).name, 'ok')
        })

        it('save搭配autoInsert為false: 給了而非有效之主鍵該筆ok為0(不讀取、不寫入), 其餘筆照常(只更新既有)', async function() {
            //R22.2、R13: 同批其他筆照常; autoInsert為false時不存在之主鍵不新增
            let r = await wT.save([{ id: 'a', name: 'upd-a' }, withId(true), { id: 'nope', name: 'x' }], { autoInsert: false })
            assert.deepStrictEqual(r.map((v) => v.ok), [1, 0, 1])
            assert.strictEqual(r[1].err, MSG(1))
            assert.deepStrictEqual(await rows(), ['5:seed-5', 'a:upd-a'])
        })

        it('DECIMAL主鍵欄(tpkdec): 給了而非字串或有限數字者拒絕, 有限數字有效且超出scale者仍為型別不符(R8不變)', async function() {
            //R22.2 + R8
            let admD = wo(getOpt({ cl: 'tpkdec', autoGenPk: false }))
            admD.on('error', () => {})
            await admD.createStorage()
            await admD.delAll()
            let wD = mk({ cl: 'tpkdec', autoGenPk: false })
            assert.deepStrictEqual(await wD.insert({ id: 1.25, name: 'd' }), { n: 1, nInserted: 1, ok: 1 })
            for (let [vn, f] of Object.entries(GIVEN_BAD)) {
                let r = await settle(wD.insert({ id: f(), name: 'bad' }))
                assert.strictEqual(msgOf(r.err), MSG(0), vn)
            }
            let r2 = await settle(wD.insert({ id: 1.254, name: 'scale' }))
            assert.ok(msgOf(r2.err).indexOf('type does not match pk column') >= 0, msgOf(r2.err))
            assert.deepStrictEqual((await admD.select()).map((v) => Number(v.id)), [1.25])
            await admD.delAll()
        })

        it('整數主鍵欄: 有限整數有效; true、NaN、物件、BigInt等給了而非字串或有限數字者拒絕(autoGenPk=false)', async function() {
            //R22.2 + R8: tpkint之id為INTEGER
            await admI.delAll()
            await admI.insert([{ id: 5, name: 'i5' }, { id: 12, name: 'i12' }])
            assert.deepStrictEqual(await wI.insert({ id: 13, name: 'i13' }), { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(await wI.insert({ id: '14', name: 'i14' }), { n: 1, nInserted: 1, ok: 1 })
            for (let [vn, f] of Object.entries(GIVEN_BAD)) {
                ev.error = []
                let r = await settle(wI.insert({ id: f(), name: 'bad' }))
                assert.ok(r.err !== undefined, vn)
                assert.strictEqual(msgOf(r.err), MSG(0), vn)
                assert.strictEqual(errCount(), 1, vn)
            }
            let ids = (await admI.select()).map((v) => v.id).sort((a, b) => a - b)
            assert.deepStrictEqual(ids, [5, 12, 13, 14])
        })

        //del與selectByPk修前即拒絕/回null, 核實不變
        for (let [vn, f] of Object.entries(GIVEN_BAD)) {
            it(`del: id為${vn}該筆ok為0附invalid data[k].id(第557項前即拒絕者核實不改; 包裝物件為全族對齊輪新增之拒絕), 不送查詢`, async function() {
                //R22.4: 刪查入口已拒絕者核實不改; 包裝物件(new String、new Number)不拆包裝而拒絕(共同規則一第6點)
                let r = await adm.del([{ id: 'a' }, withId(f())])
                assert.deepStrictEqual(r.map((v) => v.ok), [1, 0])
                assert.strictEqual(r[1].err, 'invalid data[1].id')
                assert.deepStrictEqual(await rows(), ['5:seed-5'])
            })

            it(`selectByPk: pk為${vn}(可讀而非字串、非有限數字)回null且不reject、不發error事件`, async function() {
                //R22.4: selectByPk可讀而非字串者回null(包裝物件不拆包裝, 同屬此類)
                assert.strictEqual(await wT.selectByPk(f()), null)
                assert.strictEqual(errCount(), 0)
            })
        }

        it('useStable為false時亦同(snap不經佇列): insert、save給了而非字串者拒絕、不補新主鍵', async function() {
            //R22.2/R22.3: 兩種useStable皆經snap與chkWf
            let w = mk({ autoGenPk: true, useStable: false })
            let r = await settle(w.insert(withId(true)))
            assert.strictEqual(msgOf(r.err), MSG(0))
            let rb = await settle(w.insertBulk(withId(new String('s1'))))
            assert.strictEqual(msgOf(rb.err), MSG(0), 'insertBulk(包裝物件不拆包裝)')
            let rs = await w.save(withId(NaN))
            assert.deepStrictEqual([rs[0].ok, rs[0].err], [0, MSG(0)])
            let rd = await w.del([{ id: 'a' }, withId(new Number(5))])
            assert.deepStrictEqual(rd.map((v) => v.ok), [1, 0], 'del: 包裝物件該筆ok為0')
            assert.deepStrictEqual(await rows(), ['5:seed-5'], '只刪除原始字串之a')
        })

        it('多筆: 索引最小之不合格筆決定訊息(insert), 不回顯值', async function() {
            //R22.2: 同R13, insert以索引最小者為準; 訊息不含值
            let r = await settle(wT.insert([{ id: 'x1' }, { id: Symbol('SECRET-557') }, { id: { v: 'SECRET-557' } }]))
            assert.strictEqual(msgOf(r.err), MSG(1))
            assert.ok(msgOf(r.err).indexOf('SECRET-557') < 0)
            assert.ok(ev.error.every((e) => String(e.err).indexOf('SECRET-557') < 0))
        })

    })

}

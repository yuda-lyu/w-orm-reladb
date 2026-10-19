import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import cvFindDef, * as cvMod from '../src/cvFind.mjs'
import cvOrmFind from 'wsemi/src/cvOrmFind.mjs'
import cvCases from 'wsemi/src/_cvOrmFindCases.mjs'


//本檔為mssql與sqlite共用之條件(find)白名單測試套組(CLAUDE_rulebook.md之R11), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//案例表為wsemi之契約案例表(src/_cvOrmFindCases.mjs, 純資料), 逐案對公開select/delAll執行, 使共用函數cvOrmFind被正確接線而非被後端略過;
//預期值取自案例表之ids.sql(SQL三值族: $ne/$nin不含NULL), 非現況指紋
//mssql之E25({name:'peter'})依預設定序不分大小寫, 命中a1與a2(sqlite為二進位比對, 只命中a2), 屬定序差異(設計, 已文件化於R11)


let { seed, cases } = cvCases

let ALL = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

let ids = (rs) => rs.map((v) => v.id).sort()

let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)

//fills, 產生n個不命中任何列之填充字串
let fills = (n) => Array.from({ length: n }, (_, i) => `k${i}`)

//settle, 執行promise並回傳{ok,v}或{err}
let settle = (pm) => pm.then((v) => ({ ok: true, v })).catch((err) => ({ err }))


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql'), 供describe標題與定序差異使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineWhitelistSuites(label, getOpt) {

    let ci = label === 'mssql' //預設定序不分大小寫


    describe(`${label} find白名單: 案例表逐案對select與delAll`, function() {

        let w = null
        let ins = null
        let cs = null

        //以共用instance執行各案, 免每次呼叫各自連線(案數多)
        let reset = async () => {
            await w.delAll({}, cs)
            let r = await w.insert(seed(), cs)
            assert.strictEqual(r.nInserted, 6)
        }

        let want = (c) => {
            if (ci && c.id === 'E25') {
                return ['a1', 'a2']
            }
            return c.ids.sql
        }

        before(async function() {
            w = wo(getOpt({ cl: 'tfind' }))
            await w.createStorage()
            ins = await w.init()
            cs = { instance: ins }
        })

        after(async function() {
            await ins.close()
        })

        it('案例表規模: 至少255案, 含ALL/OK/REJ三類', function() {
            assert.ok(cases.length >= 255, `案數 ${cases.length}`)
            for (let ex of ['ALL', 'OK', 'REJ']) {
                assert.ok(cases.some((c) => c.expect === ex), ex)
            }
        })

        for (let c of cases) {
            if (c.expect === 'REJ') {
                it(`${c.id} REJ ${c.label}: 兩函數皆reject、資料不變、error事件於reject前恰一次、change不發`, async function() {
                    await reset()
                    let before = await w.select({}, cs)
                    let evs = []
                    let fnE = (mode) => evs.push(`error:${mode}`)
                    let fnC = (mode) => evs.push(`change:${mode}`)
                    w.on('error', fnE)
                    w.on('change', fnC)
                    let ms = {}
                    try {
                        for (let mode of ['select', 'delAll']) {
                            let r = await settle(w[mode](c.find(), cs))
                            evs.push(`reject:${mode}`)
                            assert.ok(r.err !== undefined, `${mode} 未reject: ${JSON.stringify(r.v)}`)
                            ms[mode] = msgOf(r.err)
                        }
                    }
                    finally {
                        w.off('error', fnE)
                        w.off('change', fnC)
                    }
                    assert.deepStrictEqual(evs, ['error:select', 'reject:select', 'error:delAll', 'reject:delAll'])
                    for (let mode of ['select', 'delAll']) {
                        assert.strictEqual(ms[mode].indexOf('invalid find: '), 0, `${mode}: ${ms[mode]}`)
                        assert.ok(ms[mode].indexOf(c.why) >= 0, `${mode} 原因應含[${c.why}]: ${ms[mode]}`)
                    }
                    assert.deepStrictEqual(await w.select({}, cs), before)
                })
            }
            else {
                it(`${c.id} ${c.expect} ${c.label}: select命中 = delAll刪除 = 案例表ids.sql${c.schema ? '(schema案可reject)' : ''}`, async function() {
                    await reset()
                    let exp = want(c)
                    let rs = await settle(w.select(c.find(), cs))
                    if (rs.err !== undefined) {
                        //schema案: SQL族可因欄位不存在或型別檢核而reject, 此時兩函數須一致reject且資料不變
                        assert.ok(c.schema === true, `非schema案不得reject: ${msgOf(rs.err)}`)
                        assert.strictEqual(msgOf(rs.err).indexOf('invalid find: '), 0, msgOf(rs.err))
                        let before = await w.select({}, cs)
                        let rd = await settle(w.delAll(c.find(), cs))
                        assert.ok(rd.err !== undefined, 'select reject而delAll未reject')
                        assert.strictEqual(msgOf(rd.err), msgOf(rs.err))
                        assert.deepStrictEqual(await w.select({}, cs), before)
                        return
                    }
                    assert.deepStrictEqual(ids(rs.v), exp, 'select之命中')
                    let r = await w.delAll(c.find(), cs)
                    let left = ids(await w.select({}, cs))
                    let gone = ALL.filter((v) => left.indexOf(v) < 0)
                    assert.deepStrictEqual(gone, exp, 'delAll之刪除')
                    assert.deepStrictEqual(r, { n: exp.length, nDeleted: exp.length, ok: 1 })
                })
            }
        }

    })


    describe(`${label} find白名單: 專屬斷言`, function() {

        let w = null
        let w2 = null
        let ins = null
        let cs = null

        let reset = async () => {
            await w.delAll({}, cs)
            await w.insert(seed(), cs)
        }

        before(async function() {
            w = wo(getOpt({ cl: 'tfind' }))
            await w.createStorage()
            ins = await w.init()
            cs = { instance: ins }
            w2 = wo(getOpt({ cl: 'tfind', logging: true })) //不給instance, 每次呼叫各自連線並輸出實際執行之sql
        })

        after(async function() {
            await ins.close()
        })

        it('壞find不送出任何SQL: 形狀不合法者reject, error事件於reject前恰一次', async function() {
            await reset()
            let logs = []
            let old = console.log
            console.log = (...a) => logs.push(a.map((v) => String(v)).join(' '))
            let bads = []
            let n = 0
            try {
                for (let c of cases.filter((v) => v.expect === 'REJ')) {
                    let evs = []
                    let fnE = (mode) => evs.push(`error:${mode}`)
                    w2.on('error', fnE)
                    let nb = logs.length
                    let rs = await settle(w2.select(c.find()))
                    evs.push('reject:select')
                    let rd = await settle(w2.delAll(c.find()))
                    evs.push('reject:delAll')
                    w2.off('error', fnE)
                    n++
                    if (logs.length !== nb) {
                        bads.push(`${c.id} 送出SQL: ${logs.slice(nb).join(' | ').slice(0, 120)}`)
                    }
                    if (rs.err === undefined || rd.err === undefined) {
                        bads.push(`${c.id} 未reject`)
                    }
                    else if (evs.join() !== 'error:select,reject:select,error:delAll,reject:delAll') {
                        bads.push(`${c.id} 事件順序 ${evs.join()}`)
                    }
                }
                //對照: 合法find會輸出sql, 確認攔截有效
                let nb = logs.length
                await w2.select({ id: 'a1' })
                assert.ok(logs.length > nb && logs.slice(nb).some((v) => v.indexOf('Executing') >= 0), '對照組未輸出sql, 攔截無效')
            }
            finally {
                console.log = old
            }
            assert.ok(n >= 100, `REJ案數過少: ${n}`)
            assert.deepStrictEqual(bads, [], `下列壞find仍送出SQL:\n${bads.join('\n')}`)
        })

        it('形狀檢核先於model載入與sequelize實例建立: model檔缺失時壞find回invalid find, 合法find回can not import model', async function() {
            //R11: select/delAll於procClosed之後、initSequelize之前呼叫chkFindShape; 檢核若在載入model之後(HEAD之順序), 壞find會被model載入失敗之訊息掩蓋
            let wm = wo(getOpt({ cl: 'nomodel' }))
            let old = console.log
            console.log = () => {} //initSequelize於model載入失敗時以console.log輸出細節
            try {
                for (let mode of ['select', 'delAll']) {
                    let evs = []
                    let fn = (m) => evs.push(m)
                    wm.on('error', fn)
                    let bad = await settle(wm[mode]({ age: { $foo: 1 } }))
                    let good = await settle(wm[mode]({}))
                    wm.off('error', fn)
                    assert.ok(bad.err !== undefined && msgOf(bad.err).indexOf('invalid find: unsupported operator [$foo]') === 0, `${mode} 壞find: ${bad.err && msgOf(bad.err)}`)
                    assert.ok(good.err !== undefined && msgOf(good.err).indexOf('can not import model: nomodel') === 0, `${mode} 合法find(對照): ${good.err && msgOf(good.err)}`)
                    assert.deepStrictEqual(evs, [mode, mode], `${mode}: error事件各一次`)
                }
            }
            finally {
                console.log = old
            }
        })

        for (let op of ['$or', '$and']) {
            it(`${op} 999項可、1000項reject(SQLite平鋪1000項為DB錯誤, 由maxList:999於形狀階段先擋)`, async function() {
                await reset()
                let mk = (n) => {
                    //首項命中a1, 其餘為不改變結果之填充(取代$or之k無命中列; $and之g不等於zz恆真於a1)
                    return op === '$or'
                        ? { $or: [{ id: 'a1' }, ...fills(n - 1).map((k) => ({ id: k }))] }
                        : { $and: [{ id: 'a1' }, ...fills(n - 1).map((k) => ({ g: { $ne: k } }))] }
                }
                let rs = await w.select(mk(999), cs)
                assert.deepStrictEqual(ids(rs), ['a1'])
                let r = await w.delAll(mk(999), cs)
                assert.deepStrictEqual(r, { n: 1, nDeleted: 1, ok: 1 })
                assert.deepStrictEqual(ids(await w.select({}, cs)), ['a2', 'a3', 'a4', 'a5', 'a6'])
                await reset()
                let before = await w.select({}, cs)
                for (let mode of ['select', 'delAll']) {
                    let x = await settle(w[mode](mk(1000), cs))
                    assert.ok(x.err !== undefined, `${mode} 1000項應reject`)
                    assert.ok(msgOf(x.err).indexOf('invalid find: array is too large (> 999)') === 0, msgOf(x.err))
                }
                assert.deepStrictEqual(await w.select({}, cs), before)
            })
        }

        //nest, 以op包n層, 每層width項(其餘為不改變結果之填充); nestedFirst決定內層位於清單首或末; 'mix'為逐層交替$or與$and
        //葉為{id:'a1'}, 預期命中a1(填充: $or之{id:never}恆假、$and之{g:{$ne:never}}於a1恆真; 各層可選帶並列欄位使同物件內之隱含AND亦巢狀累加)
        let nest = (op, levels, width, nestedFirst, extra) => {
            let f = { id: 'a1' }
            for (let d = 0; d < levels; d++) {
                let o = op === 'mix' ? (d % 2 === 0 ? '$or' : '$and') : op
                let fills = Array.from({ length: width - 1 }, (_, i) => (o === '$or' ? { id: `never${d}_${i}` } : { g: { $ne: `never${d}_${i}` } }))
                let key = extra ? { [o]: nestedFirst ? [f, ...fills] : [...fills, f], name: { $ne: 'zz' }, age: { $gt: 0 }, g: { $ne: 'zz' }, flag: true, d: { $gte: new Date(0) } } : { [o]: nestedFirst ? [f, ...fills] : [...fills, f] }
                f = key
            }
            return f
        }
        for (let [op, levels, width, nestedFirst, extra] of [
            ['$or', 32, 33, true, false],
            ['$or', 32, 33, false, false],
            ['$and', 32, 33, true, false],
            ['$and', 32, 33, false, false],
            ['mix', 32, 33, true, false],
            ['$or', 32, 99, true, false],
            ['$and', 32, 99, false, false],
            ['$or', 4, 999, true, false],
            ['$and', 4, 999, false, false],
            ['$or', 32, 4, true, true],
            ['mix', 32, 33, false, true],
        ]) {
            it(`巢狀 × 清單長度: ${op} ${levels}層 × 每層${width}項${extra ? ' × 每層並列5欄(隱含AND)' : ''}(內層在${nestedFirst ? '首' : '末'}): select與delAll皆可執行且命中一致(樹深不隨巢狀 × 項數線性累加)`, async function() {
                await reset()
                let rs = await settle(w.select(nest(op, levels, width, nestedFirst, extra), cs))
                assert.ok(rs.err === undefined, `select: ${rs.err && msgOf(rs.err)}`)
                assert.deepStrictEqual(ids(rs.v), ['a1'])
                let rd = await settle(w.delAll(nest(op, levels, width, nestedFirst, extra), cs))
                assert.ok(rd.err === undefined, `delAll: ${rd.err && msgOf(rd.err)}`)
                assert.deepStrictEqual(rd.v, { n: 1, nDeleted: 1, ok: 1 })
            })
        }

        it('預檢失敗於初始化之前時, 不得關閉呼叫端先前持有之instance(只關閉本次呼叫自己建立者)', async function() {
            let wc = wo(getOpt({ cl: 'tfind' }))
            let instance = await wc.init()
            try {
                for (let mode of ['select', 'delAll']) {
                    let x = await settle(wc[mode]({ g: { $bad: 1 } })) //未帶instance
                    assert.ok(x.err !== undefined && msgOf(x.err).indexOf('invalid find: unsupported operator [$bad]') === 0, `${mode}: ${x.err && msgOf(x.err)}`)
                    //先前持有之instance仍可使用
                    let rs = await settle(wc.select({ id: 'a1' }, { instance }))
                    assert.ok(rs.err === undefined && Array.isArray(rs.v), `${mode}之後instance被關閉: ${rs.err && msgOf(rs.err)}`)
                }
            }
            finally {
                await instance.close()
            }
        })

        it('實例已關閉者先回closed訊息(isClosed先於find檢核); 實例未關閉而find壞者回invalid find', async function() {
            let wc = wo(getOpt({ cl: 'tfind' }))
            let instance = await wc.init()
            try {
                let x = await settle(wc.select(null, { instance }))
                assert.ok(x.err !== undefined && msgOf(x.err).indexOf('invalid find: ') === 0, x.err && msgOf(x.err))
                x = await settle(wc.delAll({ $nor: [{ g: 'A' }] }, { instance }))
                assert.ok(x.err !== undefined && msgOf(x.err).indexOf('invalid find: unsupported operator [$nor]') === 0, x.err && msgOf(x.err))
            }
            finally {
                await instance.close()
            }
            for (let bad of [null, [], { $not: { g: 'A' } }, { g: { $regex: 'A' } }]) {
                for (let mode of ['select', 'delAll']) {
                    let y = await settle(wc[mode](bad, { instance }))
                    assert.ok(y.err !== undefined && msgOf(y.err).indexOf('instance is closed') >= 0, `${mode}: ${y.err && msgOf(y.err)}`)
                }
            }
        })

        it('頂層: 未給、undefined、{}為全部; null、陣列、字串、數字等純量與陣列皆reject且不刪除任何數據', async function() {
            await reset()
            for (let f of [undefined, {}, Object.create(null)]) {
                assert.deepStrictEqual(ids(await w.select(f, cs)), ALL)
            }
            for (let f of [null, [], [{ id: 'a1' }], 'a1', 0, 1, true, false, () => ({}), Symbol('s'), BigInt(1)]) {
                for (let mode of ['select', 'delAll']) {
                    let x = await settle(w[mode](f, cs))
                    assert.ok(x.err !== undefined, `${mode}(${String(typeof f)}) 應reject`)
                }
            }
            assert.deepStrictEqual(ids(await w.select({}, cs)), ALL)
            let r = await w.delAll(undefined, cs)
            assert.deepStrictEqual(r, { n: 6, nDeleted: 6, ok: 1 })
        })

        it('檢查之值即使用之值: select與delAll皆逐屬性只讀一次並以所讀之值轉譯(Proxy之描述子陷阱於第二次讀取時回傳不同值)', async function() {
            for (let mode of ['select', 'delAll']) {
                await reset()
                let n = 0
                let p = new Proxy({ g: 'A' }, {
                    getOwnPropertyDescriptor(t, k) {
                        let d = Reflect.getOwnPropertyDescriptor(t, k)
                        if (k === 'g') {
                            n++
                            return { ...d, value: n === 1 ? 'A' : 'B' }
                        }
                        return d
                    }
                })
                let r = await w[mode](p, cs)
                if (mode === 'select') {
                    assert.deepStrictEqual(ids(r), ['a1', 'a2'], 'select之命中')
                }
                else {
                    assert.deepStrictEqual(r, { n: 2, nDeleted: 2, ok: 1 })
                    assert.deepStrictEqual(ids(await w.select({}, cs)), ['a3', 'a4', 'a5', 'a6'], 'delAll之刪除')
                }
                assert.strictEqual(n, 1, `${mode}: g被讀取次數`)
            }
        })

        it('匯出簽名不變: cvFind(find, ctx)、getColKind、getColScale、normPk(w-orm-mdb深引用)', function() {
            assert.strictEqual(typeof cvFindDef, 'function')
            assert.strictEqual(cvFindDef.length, 2)
            for (let [k, len] of [['getColKind', 2], ['getColScale', 2], ['normPk', 2]]) {
                assert.strictEqual(typeof cvMod[k], 'function', k)
                assert.strictEqual(cvMod[k].length, len, k)
            }
            //未給條件者回{}(全部), 不經sequelize
            assert.deepStrictEqual(cvFindDef(undefined, {}), {})
            assert.deepStrictEqual(cvFindDef({}, {}), {})
        })

        it('chkFindShape即cvOrmFind(find, {maxList:999}): 複本為null原型、與輸入無共用參照, 且對複本再檢核冪等', function() {
            let src = { g: 'A', $or: [{ age: { $in: [20, 30] } }, { d: { $gte: new Date(0) } }] }
            let cp = cvMod.chkFindShape(src)
            assert.strictEqual(Object.getPrototypeOf(cp), null)
            assert.notStrictEqual(cp.$or, src.$or)
            assert.notStrictEqual(cp.$or[1].d.$gte, src.$or[1].d.$gte)
            assert.deepStrictEqual(cvMod.chkFindShape(cp), cp)
            assert.deepStrictEqual(cp, cvOrmFind(src, { maxList: 999 }))
        })

    })

}

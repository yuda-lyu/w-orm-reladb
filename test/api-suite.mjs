import assert from 'assert'
import Sequelize from 'sequelize'
import wo from '../src/WOrmReladb.mjs'
import cvFind from '../src/cvFind.mjs'


//本檔為mssql與sqlite共用之測試套組, 令兩種後端以同一組斷言驗證, 避免各自漂移
//斷言皆為規格(w-orm系列套件統一規格.md)之可執行翻譯, 非現況指紋


//genRs, 初始插入數據
export let genRs = () => {
    return [
        { id: 'id-peter', name: 'peter', value: 123 },
        { id: 'id-rosemary', name: 'rosemary', value: 123.456 },
        { id: '', name: 'kettle', value: 456 },
    ]
}


//genRsm, 儲存(修改)數據, 第3筆id為空字串需視autoInsert決定是否插入
export let genRsm = () => {
    return [
        { id: 'id-peter', name: 'peter(modify)' },
        { id: 'id-rosemary', name: 'rosemary(modify)' },
        { id: '', name: 'kettle(modify)' },
    ]
}


//sortByName, select結果排序供穩定比對
export let sortByName = (rows) => {
    return [...rows].sort((a, b) => (a.name < b.name ? -1 : 1))
}


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串, 供describe標題使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineSuites(label, getOpt) {


    describe(`${label} crud`, function() {

        let w = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
            await w.delAll()
        })

        it('insert 3筆, 空主鍵自動產生', async function() {
            let msg = await w.insert(genRs())
            assert.deepStrictEqual(msg, { n: 3, nInserted: 3, ok: 1 })
        })

        it('save({autoInsert:true}) 修改2筆並插入1筆', async function() {
            let msg = await w.save(genRsm(), { autoInsert: true })
            assert.deepStrictEqual(msg, [
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 1, nInserted: 1, nModified: 0, ok: 1 },
            ])
        })

        it('select() 查全部得4筆且不含資料庫內部欄位', async function() {
            let ss = sortByName(await w.select())
            assert.strictEqual(ss.length, 4)
            let [kettle, kettleM, peter, rosemary] = ss
            assert.deepStrictEqual(Object.keys(peter).sort(), ['id', 'name', 'value'])
            assert.ok(kettle.id.length > 0)
            assert.strictEqual(kettle.name, 'kettle')
            assert.strictEqual(kettle.value, 456)
            assert.ok(kettleM.id.length > 0)
            assert.strictEqual(kettleM.name, 'kettle(modify)')
            assert.strictEqual(kettleM.value, null)
            assert.deepStrictEqual(peter, { id: 'id-peter', name: 'peter(modify)', value: 123 })
            assert.deepStrictEqual(rosemary, { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 })
        })

        it('select({主鍵}) 依主鍵查詢', async function() {
            let so = await w.select({ id: 'id-rosemary' })
            assert.deepStrictEqual(so, [{ id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }])
        })

        it('selectByPk 命中, 內容與select({主鍵})[0]相同', async function() {
            let v = await w.selectByPk('id-rosemary')
            let so = await w.select({ id: 'id-rosemary' })
            assert.deepStrictEqual(v, so[0])
        })

        it('selectByPk 未命中回null', async function() {
            assert.strictEqual(await w.selectByPk('id-nothere'), null)
        })

        it('selectByPk 主鍵值無效回null且不reject', async function() {
            assert.strictEqual(await w.selectByPk(null), null)
            assert.strictEqual(await w.selectByPk(undefined), null)
            assert.strictEqual(await w.selectByPk(''), null)
            assert.strictEqual(await w.selectByPk({}), null)
        })

        it('select $and+$gt+$lt', async function() {
            let sp = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
            assert.deepStrictEqual(sp, [{ id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }])
        })

        it('select $or+$gte+$lte', async function() {
            let sp = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
            assert.strictEqual(sp.length, 1)
            assert.strictEqual(sp[0].name, 'kettle')
        })

        it('select 巢狀$or+$and+$ne+$in+$nin', async function() {
            let sp = sortByName(await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] }))
            assert.strictEqual(sp.length, 2)
            assert.strictEqual(sp[0].name, 'kettle')
            assert.deepStrictEqual(sp[1], { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 })
        })

        it('select $regex(白名單外)整批reject', async function() {
            //rulebook R6/R11: $regex、$options已移除, 於形狀階段reject; 需子字串/不分大小寫者請select後於記憶體過濾
            let r = await w.select({ name: { $regex: 'PeT', $options: 'i' } }).then(() => null).catch((err) => String(err.message || err))
            assert.ok(r !== null && r.indexOf('invalid find: unsupported operator [$regex]') === 0, String(r))
        })

        it('del 刪除3筆並保留kettle', async function() {
            let ss = await w.select()
            let d = ss.filter((v) => v.name !== 'kettle')
            let msg = await w.del(d)
            assert.deepStrictEqual(msg, [
                { n: 1, nDeleted: 1, ok: 1 },
                { n: 1, nDeleted: 1, ok: 1 },
                { n: 1, nDeleted: 1, ok: 1 },
            ])
            let left = await w.select()
            assert.strictEqual(left.length, 1)
            assert.strictEqual(left[0].name, 'kettle')
        })

        it('delAll 清空後select回傳空陣列', async function() {
            let msg = await w.delAll()
            assert.deepStrictEqual(msg, { n: 1, nDeleted: 1, ok: 1 })
            assert.deepStrictEqual(await w.select(), [])
        })

    })


    describe(`${label} spec`, function() {

        let w = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
        })

        beforeEach(async function() {
            await w.delAll()
        })

        it('insert 主鍵已存在者跳過且不覆寫, 不reject', async function() {
            await w.insert({ id: 'k1', name: 'first', value: 1 })
            let msg = await w.insert({ id: 'k1', name: 'second', value: 2 })
            assert.deepStrictEqual(msg, { n: 1, nInserted: 0, ok: 1 })
            assert.deepStrictEqual(await w.selectByPk('k1'), { id: 'k1', name: 'first', value: 1 })
        })

        it('insert 同批含重複主鍵僅首筆計入nInserted', async function() {
            let msg = await w.insert([
                { id: 'k1', name: 'a' },
                { id: 'k1', name: 'b' },
                { id: 'k2', name: 'c' },
            ])
            assert.deepStrictEqual(msg, { n: 3, nInserted: 2, ok: 1 })
            assert.strictEqual((await w.selectByPk('k1')).name, 'a')
        })

        it('insert 全數已存在時nInserted為0且屬正常結果', async function() {
            await w.insert([{ id: 'k1' }, { id: 'k2' }])
            let msg = await w.insert([{ id: 'k1' }, { id: 'k2' }])
            assert.deepStrictEqual(msg, { n: 2, nInserted: 0, ok: 1 })
        })

        it('insert 輸入無效回空結果', async function() {
            for (let v of [null, undefined, '', 0, [], {}]) {
                assert.deepStrictEqual(await w.insert(v), { n: 0, nInserted: 0, ok: 1 })
            }
        })

        it('save 合併後內容相同者不寫入, nModified為0', async function() {
            await w.insert({ id: 'k1', name: 'A', value: 1 })
            let msg = await w.save({ id: 'k1', name: 'A', value: 1 })
            assert.deepStrictEqual(msg, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
        })

        it('save 只給部份欄位且值與現值相同, nModified為0', async function() {
            await w.insert({ id: 'k1', name: 'A', value: 1 })
            let msg = await w.save({ id: 'k1', name: 'A' })
            assert.deepStrictEqual(msg, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
            assert.deepStrictEqual(await w.selectByPk('k1'), { id: 'k1', name: 'A', value: 1 })
        })

        it('save 只給部份欄位而值不同, 未給欄位保留', async function() {
            await w.insert({ id: 'k1', name: 'A', value: 1 })
            let msg = await w.save({ id: 'k1', name: 'B' })
            assert.deepStrictEqual(msg, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.deepStrictEqual(await w.selectByPk('k1'), { id: 'k1', name: 'B', value: 1 })
        })

        it('save 主鍵不存在且autoInsert為true則插入', async function() {
            let msg = await w.save({ id: 'k9', name: 'N' }, { autoInsert: true })
            assert.deepStrictEqual(msg, [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }])
            assert.strictEqual((await w.selectByPk('k9')).name, 'N')
        })

        it('save 主鍵不存在且autoInsert為false則不寫入', async function() {
            let msg = await w.save({ id: 'k9', name: 'N' }, { autoInsert: false })
            assert.deepStrictEqual(msg, [{ n: 0, nInserted: 0, nModified: 0, ok: 1 }])
            assert.strictEqual(await w.selectByPk('k9'), null)
        })

        it('save 單一物件亦回傳長度1之陣列', async function() {
            let msg = await w.save({ id: 'k1', name: 'A' })
            assert.ok(Array.isArray(msg))
            assert.strictEqual(msg.length, 1)
        })

        it('save 單筆失敗不中斷整批, 該筆ok為0並附err', async function() {
            //以字串欄位塞入物件觸發sequelize於送出SQL前之驗證錯誤, 此驗證於JS層完成故各dialect一致
            let msg = await w.save([
                { id: 'k1', name: 'ok1' },
                { id: 'k2', name: {} },
                { id: 'k3', name: 'ok3' },
            ])
            assert.strictEqual(msg.length, 3)
            assert.deepStrictEqual(msg[0], { n: 1, nInserted: 1, nModified: 0, ok: 1 })
            assert.strictEqual(msg[1].ok, 0)
            assert.strictEqual(typeof msg[1].err, 'string')
            assert.ok(msg[1].err.length > 0)
            assert.deepStrictEqual(msg[2], { n: 1, nInserted: 1, nModified: 0, ok: 1 })
            //其餘筆數照常寫入
            assert.strictEqual((await w.selectByPk('k1')).name, 'ok1')
            assert.strictEqual((await w.selectByPk('k3')).name, 'ok3')
        })

        it('save 輸入無效回空陣列', async function() {
            for (let v of [null, undefined, '', 0, [], {}]) {
                assert.deepStrictEqual(await w.save(v), [])
            }
        })

        it('del 主鍵未命中為正常結果ok為1', async function() {
            let msg = await w.del({ id: 'nothere' })
            assert.deepStrictEqual(msg, [{ n: 0, nDeleted: 0, ok: 1 }])
        })

        it('del 未帶有效主鍵者ok為0並附err, 且與未命中可區辨', async function() {
            let msg = await w.del({ name: 'no-pk' })
            assert.strictEqual(msg.length, 1)
            assert.strictEqual(msg[0].n, 0)
            assert.strictEqual(msg[0].nDeleted, 0)
            assert.strictEqual(msg[0].ok, 0)
            assert.strictEqual(typeof msg[0].err, 'string')
        })

        it('del 未帶有效主鍵不中斷整批', async function() {
            await w.insert([{ id: 'k1' }, { id: 'k2' }])
            let msg = await w.del([{ id: 'k1' }, { name: 'no-pk' }, { id: 'k2' }])
            assert.strictEqual(msg.length, 3)
            assert.deepStrictEqual(msg[0], { n: 1, nDeleted: 1, ok: 1 })
            assert.strictEqual(msg[1].ok, 0)
            assert.deepStrictEqual(msg[2], { n: 1, nDeleted: 1, ok: 1 })
            assert.deepStrictEqual(await w.select(), [])
        })

        it('del 輸入無效回空陣列', async function() {
            for (let v of [null, undefined, '', 0, [], {}]) {
                assert.deepStrictEqual(await w.del(v), [])
            }
        })

        it('delAll 帶條件且僅部份命中', async function() {
            await w.insert([
                { id: 'k1', value: 1 },
                { id: 'k2', value: 2 },
                { id: 'k3', value: 2 },
            ])
            let msg = await w.delAll({ value: 2 })
            assert.deepStrictEqual(msg, { n: 2, nDeleted: 2, ok: 1 })
            let ss = await w.select()
            assert.strictEqual(ss.length, 1)
            assert.strictEqual(ss[0].id, 'k1')
        })

        it('delAll 條件無命中回0且不視為錯誤', async function() {
            let msg = await w.delAll({ id: 'nothere' })
            assert.deepStrictEqual(msg, { n: 0, nDeleted: 0, ok: 1 })
        })

        it('select 無符合恆回空陣列', async function() {
            assert.deepStrictEqual(await w.select({ id: 'nothere' }), [])
        })

    })


    describe(`${label} insert returnList`, function() {

        let w = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
        })

        beforeEach(async function() {
            await w.delAll()
        })

        it('兩種取值下之形狀: 預設回單一物件, 開啟回陣列', async function() {
            let m1 = await w.insert([{ id: 'k1' }, { id: 'k2' }])
            assert.ok(!Array.isArray(m1))
            await w.delAll()
            let m2 = await w.insert([{ id: 'k1' }, { id: 'k2' }], { returnList: true })
            assert.ok(Array.isArray(m2))
        })

        it('開啟時與輸入等長保序且對位正確', async function() {
            await w.insert({ id: 'k2', name: 'pre' })
            let msg = await w.insert([{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }], { returnList: true })
            assert.strictEqual(msg.length, 3)
            assert.deepStrictEqual(msg, [
                { n: 1, nInserted: 1, ok: 1 },
                { n: 1, nInserted: 0, ok: 1 }, //k2已存在
                { n: 1, nInserted: 1, ok: 1 },
            ])
        })

        it('同批重複主鍵僅首筆nInserted為1', async function() {
            let msg = await w.insert([{ id: 'k1' }, { id: 'k1' }, { id: 'k2' }], { returnList: true })
            assert.deepStrictEqual(msg, [
                { n: 1, nInserted: 1, ok: 1 },
                { n: 1, nInserted: 0, ok: 1 },
                { n: 1, nInserted: 1, ok: 1 },
            ])
        })

        it('filter計數等於聚合模式之nInserted', async function() {
            await w.insert({ id: 'k2', name: 'pre' })
            let rs = [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }, { id: 'k1' }]
            let ml = await w.insert(rs, { returnList: true })
            await w.delAll()
            await w.insert({ id: 'k2', name: 'pre' })
            let ma = await w.insert(rs)
            assert.strictEqual(ml.filter((v) => v.nInserted === 1).length, ma.nInserted)
            assert.strictEqual(ml.length, ma.n)
        })

        it('輸入無效時開啟回[], 關閉回聚合空結果', async function() {
            for (let v of [null, undefined, '', 0, [], {}]) {
                assert.deepStrictEqual(await w.insert(v, { returnList: true }), [])
                assert.deepStrictEqual(await w.insert(v), { n: 0, nInserted: 0, ok: 1 })
            }
        })

        it('逐筆元素鍵集合恰為{n,nInserted,ok}', async function() {
            let msg = await w.insert([{ id: 'k1' }], { returnList: true })
            assert.deepStrictEqual(Object.keys(msg[0]).sort(), ['n', 'nInserted', 'ok'])
        })

        it('change事件之res即實際回傳值', async function() {
            let evs = []
            let fn = (mode, data, res) => evs.push(res)
            w.on('change', fn)
            let msg = await w.insert([{ id: 'k1' }], { returnList: true })
            w.off('change', fn)
            assert.strictEqual(evs.length, 1)
            assert.deepStrictEqual(evs[0], msg)
            assert.ok(Array.isArray(evs[0]))
        })

        it('autoGenPk為false且未帶主鍵時仍為整批reject而不降為逐筆', async function() {
            let wNoGen = wo(getOpt({ autoGenPk: false }))
            let r = await wNoGen.insert([{ id: 'k1' }, { name: 'no-pk' }], { returnList: true })
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, '未reject')
            assert.ok(String(r.message || r).indexOf('autoGenPk is false') >= 0)
        })

    })


    describe(`${label} closed instance`, function() {

        let w = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
            await w.delAll()
            await w.insert([{ id: 'k1', name: 'A' }, { id: 'k2', name: 'B' }])
        })

        it('close後七函數皆須以整批性錯誤reject, 不得以正常空結果或逐筆ok為0回應', async function() {
            let instance = await w.init()
            await instance.close()
            let cs = { instance }

            let chk = async (t, fn) => {
                let r = await fn()
                    .then((v) => ({ RESOLVE: v }))
                    .catch((err) => ({ REJECT: String(err.message || err) }))
                assert.ok(r.REJECT !== undefined, `${t} 未reject, 實得 ${JSON.stringify(r.RESOLVE)}`)
                assert.ok(r.REJECT.indexOf('closed') >= 0, `${t} 之錯誤訊息未指明已關閉: ${r.REJECT}`)
            }

            await chk('select', () => w.select({}, cs))
            await chk('selectByPk', () => w.selectByPk('k1', cs))
            await chk('insert', () => w.insert({ id: 'k9' }, cs))
            await chk('insertBulk', () => w.insertBulk({ id: 'k8' }, cs))
            await chk('save', () => w.save({ id: 'k1', name: 'Z' }, cs))
            await chk('del', () => w.del({ id: 'k1' }, cs))
            await chk('delAll', () => w.delAll({}, cs))
        })

        it('close後select亦由入口守門reject, 訊息同其餘六函數', async function() {
            //rulebook R7: 七函數皆經procClosed, 不倚賴驅動層訊息恰含closed
            let instance = await w.init()
            await instance.close()
            let r = await w.select({ id: 'k1' }, { instance })
                .then((v) => ({ RESOLVE: v }))
                .catch((err) => ({ REJECT: String(err.message || err) }))
            assert.ok(r.REJECT !== undefined, `未reject, 實得 ${JSON.stringify(r.RESOLVE)}`)
            assert.ok(r.REJECT.indexOf('instance is closed') >= 0, `訊息非入口守門之訊息: ${r.REJECT}`)
        })

        it('close後selectByPk給無效主鍵亦須reject而非回null', async function() {
            let instance = await w.init()
            await instance.close()
            let r = await w.selectByPk(null, { instance })
                .then((v) => ({ RESOLVE: v }))
                .catch((err) => ({ REJECT: String(err.message || err) }))
            assert.ok(r.REJECT !== undefined, `未reject, 實得 ${JSON.stringify(r.RESOLVE)}`)
        })

        it('close後亦須發出error事件', async function() {
            let instance = await w.init()
            await instance.close()
            let evs = []
            let fn = (mode, data, err) => evs.push({ mode, err })
            w.on('error', fn)
            await w.del({ id: 'k1' }, { instance }).catch(() => {})
            w.off('error', fn)
            assert.strictEqual(evs.length, 1)
            assert.strictEqual(evs[0].mode, 'del')
            assert.ok(evs[0].err.indexOf('closed') >= 0)
        })

    })


    describe(`${label} insertBulk`, function() {

        let w = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
        })

        beforeEach(async function() {
            await w.delAll()
        })

        it('無衝突時nInserted等於n, 鍵集合與insert相同', async function() {
            let msg = await w.insertBulk([{ id: 'k1', name: 'a' }, { id: 'k2', name: 'b' }])
            assert.deepStrictEqual(msg, { n: 2, nInserted: 2, ok: 1 })
            assert.strictEqual((await w.select()).length, 2)
        })

        it('單一物件亦可, 回傳單一物件', async function() {
            let msg = await w.insertBulk({ id: 'k1', name: 'a' })
            assert.deepStrictEqual(msg, { n: 1, nInserted: 1, ok: 1 })
        })

        it('撞既有主鍵時整批reject, 且資料表無任何新增', async function() {
            await w.insert({ id: 'k1', name: 'pre' })
            let n0 = (await w.select()).length
            let r = await w.insertBulk([{ id: 'k2' }, { id: 'k3' }, { id: 'k1' }])
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, '未reject')
            let ss = await w.select()
            assert.strictEqual(ss.length, n0, '失敗後不得有任何新增')
            assert.strictEqual(ss[0].name, 'pre', '既有數據不得被改動')
        })

        it('同批含重複主鍵時整批reject, 且資料表無任何新增', async function() {
            let r = await w.insertBulk([{ id: 'k1' }, { id: 'k2' }, { id: 'k1' }])
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, '未reject')
            assert.deepStrictEqual(await w.select(), [])
        })

        it('大批次末筆衝突亦不得留下部份寫入', async function() {
            //mssql因綁定參數上限會由驅動層拆為多語句, 未包交易時前段會落盤
            this.timeout(120000)
            await w.insert({ id: 'b-999', name: 'pre' })
            let rs = []
            for (let i = 0; i < 1000; i++) {
                rs.push({ id: `b-${i}`, name: `n${i}`, value: i })
            }
            let r = await w.insertBulk(rs)
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, '未reject')
            let ss = await w.select()
            assert.strictEqual(ss.length, 1, `失敗後不得有任何新增, 實得${ss.length}筆`)
        })

        it('輸入無效回空結果', async function() {
            for (let v of [null, undefined, '', 0, [], {}]) {
                assert.deepStrictEqual(await w.insertBulk(v), { n: 0, nInserted: 0, ok: 1 })
            }
        })

        it('autoGenPk為true時未帶主鍵者自動產生', async function() {
            let msg = await w.insertBulk([{ name: 'a' }, { name: 'b' }])
            assert.deepStrictEqual(msg, { n: 2, nInserted: 2, ok: 1 })
            let ss = await w.select()
            assert.strictEqual(ss.length, 2)
            assert.ok(ss[0].id.length > 0)
        })

        it('autoGenPk為false時未帶主鍵須reject且同批皆不寫入', async function() {
            let wNoGen = wo(getOpt({ autoGenPk: false }))
            let r = await wNoGen.insertBulk([{ id: 'ok-1', name: 'a' }, { name: 'no-pk' }])
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, '未reject')
            assert.ok(String(r.message || r).indexOf('autoGenPk is false') >= 0)
            assert.strictEqual(await w.selectByPk('ok-1'), null)
        })

        it('成功發出change事件, 失敗發出error事件, mode皆為insertBulk', async function() {
            let evs = []
            let fnC = (mode, data, res) => evs.push({ ev: 'change', mode, res })
            let fnE = (mode, data, err) => evs.push({ ev: 'error', mode, err })
            w.on('change', fnC)
            w.on('error', fnE)

            await w.insertBulk({ id: 'k1' })
            await w.insertBulk({ id: 'k1' }).catch(() => {})

            w.off('change', fnC)
            w.off('error', fnE)

            assert.strictEqual(evs.length, 2)
            assert.deepStrictEqual(evs[0], { ev: 'change', mode: 'insertBulk', res: { n: 1, nInserted: 1, ok: 1 } })
            assert.strictEqual(evs[1].ev, 'error')
            assert.strictEqual(evs[1].mode, 'insertBulk')
            assert.strictEqual(typeof evs[1].err, 'string')
        })

        it('無衝突時與insert之可觀察結果完全相同', async function() {
            let rs = [{ id: 'k1', name: 'a' }, { id: 'k2', name: 'b' }]
            let m1 = await w.insertBulk(rs)
            await w.delAll()
            let m2 = await w.insert(rs)
            assert.deepStrictEqual(m1, m2)
        })

        it('呼叫端已給transaction時, 失敗僅回滾本次而不影響交易內先前之寫入', async function() {
            let instance = await w.init()
            let transaction = await w.genTransaction()
            let connState = { instance, transaction }
            try {

                //交易內先寫入一筆
                await w.insert({ id: 'tx-1', name: 'A' }, connState)

                //本次insertBulk撞該筆而失敗
                let r = await w.insertBulk([{ id: 'tx-2' }, { id: 'tx-1' }], connState)
                    .then(() => null)
                    .catch((err) => err)
                assert.ok(r !== null, '未reject')

                //交易內先前之寫入須保留, 本次之tx-2須不存在
                let ssIn = await w.select({}, connState)
                let ids = ssIn.map((v) => v.id).sort()
                assert.deepStrictEqual(ids, ['tx-1'])

                await transaction.commit()
            }
            catch (err) {
                await transaction.rollback().catch(() => {})
                throw err
            }
            finally {
                await instance.close().catch(() => {})
            }

            //commit後應僅有tx-1
            let ss = await w.select()
            assert.deepStrictEqual(ss.map((v) => v.id), ['tx-1'])
        })

    })


    describe(`${label} autoGenPk`, function() {

        let w = null
        let wNoGen = null

        before(async function() {
            w = wo(getOpt())
            wNoGen = wo(getOpt({ autoGenPk: false }))
            await w.createStorage()
            await w.delAll()
        })

        it('autoGenPk為true時未帶主鍵者自動產生', async function() {
            let msg = await w.insert({ name: 'auto-1' })
            assert.deepStrictEqual(msg, { n: 1, nInserted: 1, ok: 1 })
            let ss = await w.select({ name: 'auto-1' })
            assert.strictEqual(ss.length, 1)
            assert.ok(ss[0].id.length > 0)
        })

        it('autoGenPk為true時save未帶主鍵者亦自動產生', async function() {
            let msg = await w.save({ name: 'auto-2' })
            assert.deepStrictEqual(msg, [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }])
        })

        it('autoGenPk為false時insert未帶主鍵須reject', async function() {
            let r = await wNoGen.insert({ name: 'no-pk' })
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, 'insert未reject')
            assert.ok(String(r.message || r).indexOf('autoGenPk is false') >= 0)
        })

        it('autoGenPk為false時save未帶主鍵須reject', async function() {
            let r = await wNoGen.save({ name: 'no-pk' })
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, 'save未reject')
            assert.ok(String(r.message || r).indexOf('autoGenPk is false') >= 0)
        })

        it('autoGenPk為false而reject時, 同批之有效筆數亦不得被寫入', async function() {
            await w.delAll()
            let r = await wNoGen.insert([{ id: 'ok-1', name: 'a' }, { name: 'no-pk' }])
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null)
            assert.strictEqual(await w.selectByPk('ok-1'), null)
        })

        it('autoGenPk為false時del不受影響, 未帶主鍵仍為該筆ok為0', async function() {
            let msg = await wNoGen.del({ name: 'no-pk' })
            assert.strictEqual(msg.length, 1)
            assert.strictEqual(msg[0].ok, 0)
            assert.strictEqual(typeof msg[0].err, 'string')
        })

        it('autoGenPk為true但主鍵欄位非字串類型時, 補值須以明確訊息reject', async function() {
            let wBad = wo(getOpt({ pk: 'value' }))
            let r = await wBad.insert({ name: 'bad-pk' })
                .then(() => null)
                .catch((err) => err)
            assert.ok(r !== null, '未reject')
            let msg = String(r.message || r)
            assert.ok(msg.indexOf('autoGenPk is true') >= 0)
            assert.ok(msg.indexOf('FLOAT') >= 0)
        })

    })


    describe(`${label} event`, function() {

        let w = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
        })

        beforeEach(async function() {
            await w.delAll()
        })

        it('change事件參數為(mode, data, res)且逐筆函數整批發出一次', async function() {
            let evs = []
            let fn = (mode, data, res) => evs.push({ mode, data, res })
            w.on('change', fn)

            await w.insert([{ id: 'k1' }, { id: 'k2' }])
            await w.del([{ id: 'k1' }, { id: 'k2' }])

            w.off('change', fn)

            let ms = evs.map((v) => v.mode)
            assert.deepStrictEqual(ms, ['insert', 'del'])
            assert.strictEqual(evs[0].data.length, 2)
            assert.deepStrictEqual(evs[0].res, { n: 2, nInserted: 2, ok: 1 })
        })

        it('error事件參數為(mode, data, err)且err為字串', async function() {
            let evs = []
            let fn = (mode, data, err) => evs.push({ mode, data, err })
            w.on('error', fn)

            await w.del({ name: 'no-pk' })

            w.off('error', fn)

            assert.strictEqual(evs.length, 1)
            assert.strictEqual(evs[0].mode, 'del')
            assert.strictEqual(typeof evs[0].err, 'string')
            assert.ok(evs[0].err.length > 0)
        })

        it('正常結果不得發出error事件', async function() {
            let evs = []
            let fn = (mode, data, err) => evs.push({ mode, err })
            w.on('error', fn)

            await w.insert({ id: 'k1', name: 'A', value: 1 })
            await w.insert({ id: 'k1', name: 'B' }) //已存在而跳過
            await w.save({ id: 'k1', name: 'A', value: 1 }) //合併後內容相同
            await w.del({ id: 'nothere' }) //主鍵未命中
            await w.delAll({ id: 'nothere' }) //條件無命中
            await w.selectByPk('nothere') //查無數據
            await w.select({ id: 'nothere' })

            w.off('error', fn)

            assert.deepStrictEqual(evs, [])
        })

        it('訂閱函數拋錯不得影響本次操作之結果', async function() {
            let fn = () => {
                throw new Error('listener boom')
            }
            w.on('change', fn)

            let msg = await w.insert({ id: 'k1' })

            w.off('change', fn)

            assert.deepStrictEqual(msg, { n: 1, nInserted: 1, ok: 1 })
        })

        it('操作行為不因有無註冊error監聽而改變', async function() {
            let wWith = wo(getOpt())
            let wWithout = wo(getOpt())
            wWith.on('error', () => {})

            //逐筆失敗
            let a1 = await wWith.del({ name: 'no-pk' })
            let b1 = await wWithout.del({ name: 'no-pk' })
            assert.deepStrictEqual(a1, b1)

            //整批性錯誤
            let wgWith = wo(getOpt({ autoGenPk: false }))
            let wgWithout = wo(getOpt({ autoGenPk: false }))
            wgWith.on('error', () => {})
            let a2 = await wgWith.insert({ name: 'no-pk' }).then(() => 'resolve').catch((err) => `reject:${err.message}`)
            let b2 = await wgWithout.insert({ name: 'no-pk' }).then(() => 'resolve').catch((err) => `reject:${err.message}`)
            assert.strictEqual(a2, b2)
            assert.ok(a2.indexOf('reject:') === 0)
        })

    })


    describe(`${label} transaction commit`, function() {

        let w = null
        let instance = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
            await w.delAll()
        })

        after(async function() {
            if (instance) {
                await instance.close().catch(() => {})
            }
        })

        it('交易內insert+save+del, commit後數據持久化', async function() {
            instance = await w.init()
            let transaction = await w.genTransaction()
            let connState = { instance, transaction }

            let mi = await w.insert(genRs(), connState)
            assert.deepStrictEqual(mi, { n: 3, nInserted: 3, ok: 1 })

            let msv = await w.save(genRsm(), { ...connState, autoInsert: false })
            assert.deepStrictEqual(msv, [
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 0, nInserted: 0, nModified: 0, ok: 1 },
            ])

            let md = await w.del({ id: 'id-rosemary' }, connState)
            assert.deepStrictEqual(md, [{ n: 1, nDeleted: 1, ok: 1 }])

            //交易內select可查到暫時有效的數據
            let ssIn = sortByName(await w.select({}, connState))
            assert.strictEqual(ssIn.length, 2)
            assert.strictEqual(ssIn[0].name, 'kettle')
            assert.strictEqual(ssIn[1].name, 'peter(modify)')

            await transaction.commit()
            await instance.close()
            instance = null

            let ssFinal = sortByName(await w.select())
            assert.strictEqual(ssFinal.length, 2)
            assert.strictEqual(ssFinal[0].name, 'kettle')
            assert.strictEqual(ssFinal[0].value, 456)
            assert.deepStrictEqual(ssFinal[1], { id: 'id-peter', name: 'peter(modify)', value: 123 })
        })

    })


    describe(`${label} transaction rollback`, function() {

        let w = null
        let instance = null

        before(async function() {
            w = wo(getOpt())
            await w.createStorage()
            await w.delAll()
        })

        after(async function() {
            if (instance) {
                await instance.close().catch(() => {})
            }
        })

        it('交易內insert+save+del, rollback後數據全數還原', async function() {
            instance = await w.init()
            let transaction = await w.genTransaction()
            let connState = { instance, transaction }

            let mi = await w.insert(genRs(), connState)
            assert.deepStrictEqual(mi, { n: 3, nInserted: 3, ok: 1 })

            let msv = await w.save(genRsm(), { ...connState, autoInsert: false })
            assert.deepStrictEqual(msv, [
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 1, nInserted: 0, nModified: 1, ok: 1 },
                { n: 0, nInserted: 0, nModified: 0, ok: 1 },
            ])

            let md = await w.del({ id: 'id-rosemary' }, connState)
            assert.deepStrictEqual(md, [{ n: 1, nDeleted: 1, ok: 1 }])

            await transaction.rollback()
            await instance.close()
            instance = null

            assert.deepStrictEqual(await w.select(), [])
        })

    })


    describe(`${label} find`, function() {

        //條件(find)之轉譯, 對應CLAUDE_rulebook.md之R1–R7; 預期值皆由帳本規則推得, 非現況指紋
        //資料: r1–r5各欄有值, r6除主鍵外皆為null; r2之d為本地今日00:00(用以驗DATE條件不得以今日00:00比對而誤刪)

        let Op = Sequelize.Op
        let w = null

        let today0 = () => {
            let n = new Date()
            return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0)
        }

        let genRc = () => {
            return [
                { 'id': 'r1', 's': 's1', 't': 'peter', 'i': 1, 'f': 1.5, 'p': 1.5, 'dec': 1.25, 'b': true, 'd': new Date('2019-01-01T00:00:00Z'), 'length': 0, 'p$x': 'q' },
                { 'id': 'r2', 's': 's2', 't': 'Peter', 'i': 2, 'f': 2.5, 'p': 2.5, 'dec': 2.5, 'b': false, 'd': new Date('2026-06-15T00:00:00Z'), 'length': 3, 'p$x': 'w' },
                { 'id': 'r3', 's': 's3', 't': 'rose_mary', 'i': 3, 'f': 3.5, 'p': 3.5, 'dec': 3.75, 'b': true, 'd': new Date('2026-06-01T00:00:00Z'), 'length': 5, 'p$x': 'q' },
                { 'id': 'r4', 's': 's4', 't': '100%', 'i': 4, 'f': 4.5, 'p': 4.5, 'dec': 4.5, 'b': false, 'd': new Date('2026-06-02T00:00:00Z'), 'length': 7, 'p$x': 'e' },
                { 'id': 'r5', 's': 's5', 't': 'x[a-c]y', 'i': 5, 'f': 5.5, 'p': 5.5, 'dec': 5.5, 'b': true, 'd': new Date('2026-06-03T00:00:00Z'), 'length': 9, 'p$x': 'r' },
                { id: 'r6' },
            ]
        }
        let ALL = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
        let NN = ['r1', 'r2', 'r3', 'r4', 'r5']

        let ids = (rs) => rs.map((v) => v.id).sort()

        let reset = async () => {
            await w.delAll()
            let r = await w.insert(genRc())
            assert.strictEqual(r.nInserted, 6)
        }

        before(async function() {
            w = wo(getOpt({ cl: 'tcond' }))
            await w.createStorage()
        })

        //[說明, find, 預期命中之id]
        //(第33項批1: 白名單外之寫法〔$not $nor $regex $exists、RegExp、Symbol Op、陣列值、$in/$nin含null、空$nin、空子式〕已移至下方removed, 一律reject)
        let cases = [
            //R4 七欄型之等值
            ['STRING 等值', { s: 's1' }, ['r1']],
            ['TEXT 等值', { t: 'rose_mary' }, ['r3']],
            ['INTEGER 等值', { i: 1 }, ['r1']],
            ['FLOAT 等值', { f: 1.5 }, ['r1']],
            ['DECIMAL 等值', { dec: 1.25 }, ['r1']],
            ['BOOLEAN 等值', { b: true }, ['r1', 'r3', 'r5']],
            ['DATE 等值', { d: new Date('2019-01-01T00:00:00Z') }, ['r1']],
            //R4 七欄型 × 運算子
            ['STRING $gt', { s: { $gt: 's3' } }, ['r4', 'r5']],
            ['INTEGER $gt', { i: { $gt: 3 } }, ['r4', 'r5']],
            ['FLOAT $gt', { f: { $gt: 3.5 } }, ['r4', 'r5']],
            ['DECIMAL $gt', { dec: { $gt: 3.75 } }, ['r4', 'r5']],
            ['DATE $gt', { d: { $gt: new Date('2026-06-01T12:00:00Z') } }, ['r2', 'r4', 'r5']],
            ['INTEGER $ne(SQL三值不含null)', { i: { $ne: 1 } }, ['r2', 'r3', 'r4', 'r5']],
            ['BOOLEAN $ne', { b: { $ne: true } }, ['r2', 'r4']],
            ['INTEGER $in', { i: { $in: [1, 3] } }, ['r1', 'r3']],
            ['FLOAT $in', { f: { $in: [2.5] } }, ['r2']],
            ['DECIMAL $in', { dec: { $in: [2.5] } }, ['r2']],
            ['DATE $in', { d: { $in: [new Date('2019-01-01T00:00:00Z')] } }, ['r1']],
            ['INTEGER $nin', { i: { $nin: [1, 3] } }, ['r2', 'r4', 'r5']],
            ['同欄多運算子', { i: { $gt: 1, $lt: 5 } }, ['r2', 'r3', 'r4']],
            ['同欄三運算子併入同一欄位物件', { i: { $gt: 1, $lt: 5, $ne: 3 } }, ['r2', 'r4']],
            ['DATE 以帶時區之ISO字串比較', { d: { $lt: '2020-01-01T00:00:00Z' } }, ['r1']],
            ['DATE 以帶偏移之ISO字串比較', { d: { $lt: '2020-01-01T08:00:00+08:00' } }, ['r1']],
            ['DOUBLE $gt', { p: { $gt: 3.5 } }, ['r4', 'r5']],
            ['INTEGER 以數值字串比較', { i: '2' }, ['r2']],
            //R3 邏輯
            ['$and', { $and: [{ i: { $gte: 2 } }, { b: false }] }, ['r2', 'r4']],
            ['$or', { $or: [{ s: 's1' }, { i: 5 }] }, ['r1', 'r5']],
            ['$and 內含$or', { $and: [{ $or: [{ s: 's1' }, { i: 5 }] }, { b: true }] }, ['r1', 'r5']],
            //R5 NULL
            ['{t:null}', { t: null }, ['r6']],
            ['$eq null', { t: { $eq: null } }, ['r6']],
            ['$ne null', { t: { $ne: null } }, NN],
            ['$ne不含NULL(SQL三值)', { t: { $ne: 'rose_mary' } }, ['r1', 'r2', 'r4', 'r5']],
            ['$nin不含NULL(SQL三值)', { t: { $nin: ['rose_mary'] } }, ['r1', 'r2', 'r4', 'r5']],
            ['可攜寫法: 排除NULL', { $and: [{ t: { $ne: null } }, { t: { $ne: 'rose_mary' } }] }, ['r1', 'r2', 'r4', 'r5']],
            ['可攜寫法: 含NULL', { $or: [{ t: null }, { t: { $ne: 'rose_mary' } }] }, ['r1', 'r2', 'r4', 'r5', 'r6']],
            ['$in 空陣列為無', { i: { $in: [] } }, []],
            //R2 特殊鍵
            ['欄名length不得使條件失效', { s: 's1', length: 0 }, ['r1']],
            ['欄名length帶運算子', { length: { $gte: 5 } }, ['r3', 'r4', 'r5']],
            ['DECIMAL 以不超過scale之字串', { dec: '1.25' }, ['r1']],
            ['DATE 以epoch數值比較', { d: { $lt: Date.parse('2020-01-01T00:00:00Z') } }, ['r1']],

            //審計02(規格句 R5): 欄名正確時, 空$in引用其欄位(f IS NULL AND 1 = 0)後, 命中集合須為無且不使其他分支失效; select命中 = delAll刪除(R1)
            ['TEXT $in 空陣列為無', { t: { $in: [] } }, []],
            ['主鍵欄 $in 空陣列為無', { id: { $in: [] } }, []],
            ['DATE 欄 $in 空陣列為無', { d: { $in: [] } }, []],
            ['BOOLEAN 欄 $in 空陣列為無', { b: { $in: [] } }, []],
            ['$and 含空$in 為無', { $and: [{ t: { $in: [] } }, { s: 's1' }] }, []],
            ['$or 含空$in 不使其他分支失效', { $or: [{ t: { $in: [] } }, { s: 's1' }] }, ['r1']],
            ['$in空與$nin並存為無', { t: { $in: [], $nin: ['x'] } }, []],
            //BOOLEAN之比較依1/0
            ['BOOLEAN $gt false', { b: { $gt: false } }, ['r1', 'r3', 'r5']],
        ]

        for (let [t, find, exp] of cases) {
            it(`一致性: ${t}`, async function() {
                //rulebook R1: select命中 = delAll刪除 = 規則推得之常數, 且n與nDeleted為刪除數
                await reset()
                assert.deepStrictEqual(ids(await w.select(find)), exp, 'select之命中')
                let r = await w.delAll(find)
                let left = ids(await w.select())
                let gone = ALL.filter((v) => left.indexOf(v) < 0)
                assert.deepStrictEqual(gone, exp, 'delAll之刪除')
                assert.deepStrictEqual(r, { n: exp.length, nDeleted: exp.length, ok: 1 })
            })
        }

        it('DATE 清除舊資料只刪舊列, 不得刪除本地今日00:00之列', async function() {
            //rulebook R4: 修正前DATE欄之運算子物件被stringify為本地今日00:00而刪錯列並回報成功
            await reset()
            await w.insert({ id: 'rt', d: today0() })
            let r = await w.delAll({ d: { $lt: new Date('2020-01-01T00:00:00Z') } })
            assert.deepStrictEqual(r, { n: 1, nDeleted: 1, ok: 1 })
            let left = ids(await w.select())
            assert.deepStrictEqual(left, ['r2', 'r3', 'r4', 'r5', 'r6', 'rt'])
        })

        //[說明, find, reject訊息須含之字串]
        //第33項批1: 形狀不合法者由wsemi之cvOrmFind於連線前reject(訊息格式invalid find: 原因 at [路徑]), 翻譯層(欄名嚴格鍵、欄位型別、主鍵)之reject維持
        let bads = [
            ['未知運算子', { i: { $foo: 1 } }, 'unsupported operator [$foo]'],
            ['頂層未知運算子', { $foo: 1 }, 'unsupported operator [$foo]'],
            ['sequelize專屬名稱', { s: { $like: 's%' } }, 'unsupported operator [$like]'],
            ['頂層$not', { $not: { s: 's1' } }, 'unsupported operator [$not]'],
            ['MongoDB之$type', { i: { $type: 'number' } }, 'unsupported operator [$type]'],
            ['比較運算子之值為物件', { d: { $gt: { x: 1 } } }, 'unsupported value type'],
            ['DATE欄收非日期字串', { d: { $lt: 'garbage' } }, 'does not match column type'],
            ['數值欄收非數值字串', { i: { $lt: 'abc' } }, 'does not match column type'],
            ['字串欄收數值', { s: 1 }, 'does not match column type'],
            ['undefined值', { s: undefined }, 'undefined is not allowed'],
            ['NaN', { i: NaN }, 'number is not finite'],
            ['空運算子物件', { i: {} }, 'empty operator object'],
            ['巢狀欄位物件', { s: { a: 1 } }, 'unexpected key'],
            ['空字串欄名', { '': 1 }, 'unsupported column name'],
            ['非sequelize運算子之Symbol', { [Symbol('or')]: [{ s: 's1' }] }, 'symbol key is not allowed'],
            ['欄位層非運算子之Symbol', { i: { [Symbol('gt')]: 1 } }, 'symbol key is not allowed'],
            ['欄位層Op.or', { i: { [Sequelize.Op.or]: [{ [Sequelize.Op.eq]: 1 }], [Sequelize.Op.gt]: 10 } }, 'symbol key is not allowed'],
            ['稀疏陣列', { $and: new Array(2) }, 'sparse array hole'],
            ['整數欄超出安全整數', { i: Number('9007199254740993') }, 'does not match column type [int]'],
            ['$and空陣列', { $and: [] }, '$and with empty array'],
            ['$or空陣列', { $or: [] }, '$or with empty array'],
            ['$nor空陣列', { $nor: [] }, 'unsupported operator [$nor]'],
            ['DATE欄收無時區之日期字串', { d: { $lt: '2020-01-01' } }, 'does not match column type [date]'],
            ['DATE欄收不存在之日期', { d: { $lt: '2026-02-30T00:00:00Z' } }, 'does not match column type [date]'],
            ['DOUBLE欄收非數值字串', { p: { $lt: 'abc' } }, 'does not match column type [num]'],
            ['非十進位之數值字串', { i: { $lt: '0x10' } }, 'does not match column type [int]'],
            ['前後空白之數值字串', { i: ' 5' }, 'does not match column type [int]'],
            ['整數欄收指數或小數寫法之字串', { i: '1e3' }, 'does not match column type [int]'],
            ['DECIMAL欄收指數寫法之字串', { dec: '1e3' }, 'does not match column type [num]'],
            ['DECIMAL欄收超過scale之字串', { dec: '1.254' }, 'with scale [2]'],
            ['DATE欄收超出Date範圍之epoch', { d: { $lt: 1e16 } }, 'does not match column type [date]'],
            ['原型上之條件', Object.create({ s: 's1' }), 'condition must be a plain object'],
            ['帶toStringTag之物件', { s: 's1', [Symbol.toStringTag]: 'Q' }, 'condition must be a plain object'],
            ['欄位層Op.or空陣列', { i: { [Sequelize.Op.or]: [] } }, 'symbol key is not allowed'],

            //第33項批1(R11): 白名單外之寫法一律reject(原為支援或部分支援, 見帳本〈破壞性變更紀錄(第33項批1)〉)
            ['欄位層$not', { i: { $not: { $gt: 2 } } }, 'unsupported operator [$not]'],
            ['$not包空$in', { i: { $not: { $in: [] } } }, 'unsupported operator [$not]'],
            ['文件層$nor', { $nor: [{ s: 's1' }, { i: 5 }] }, 'unsupported operator [$nor]'],
            ['$nor含空條件', { $nor: [{}] }, 'unsupported operator [$nor]'],
            ['$exists true', { i: { $exists: true } }, 'unsupported operator [$exists]'],
            ['$exists false', { i: { $exists: false } }, 'unsupported operator [$exists]'],
            ['$regex', { t: { $regex: '_' } }, 'unsupported operator [$regex]'],
            ['$regex + $options', { t: { $regex: 'PET', $options: 'i' } }, 'unsupported operator [$regex]'],
            ['$regex RegExp值', { t: { $regex: /PET/i } }, 'unsupported operator [$regex]'],
            ['單獨$options', { t: { $options: 'i' } }, 'unsupported operator [$options]'],
            ['$regex用於非字串欄', { i: { $regex: '1' } }, 'unsupported operator [$regex]'],
            ['RegExp作為值', { t: /PET/i }, 'unsupported value type [RegExp]'],
            ['陣列值即$in(已移除)', { i: [1, 2] }, 'array value is not supported, use $in'],
            ['空陣列值', { t: [] }, 'array value is not supported, use $in'],
            ['陣列值含null', { t: [null, 'rose_mary'] }, 'array value is not supported, use $in'],
            ['Symbol Op.or', { [Op.or]: [{ s: 's1' }, { s: 's2' }] }, 'symbol key is not allowed'],
            ['Symbol Op.in', { i: { [Op.in]: [1, 2] } }, 'symbol key is not allowed'],
            ['Symbol Op.notIn空陣列', { i: { [Op.notIn]: [] } }, 'symbol key is not allowed'],
            ['Symbol Op.not', { i: { [Op.not]: { [Op.gt]: 2 } } }, 'symbol key is not allowed'],
            ['Symbol Op.between', { i: { [Op.between]: [1, 2] } }, 'symbol key is not allowed'],
            ['Symbol Op.like', { t: { [Op.like]: 'p%' } }, 'symbol key is not allowed'],
            ['同義之$lt與Op.lt', { i: { $lt: 3, [Op.lt]: 100 } }, 'symbol key is not allowed'],
            ['$and與Op.and並存', { $and: [{ i: { $gte: 2 } }], [Op.and]: [{ i: { $lte: 3 } }] }, 'symbol key is not allowed'],
            ['$in含null', { t: { $in: [null, 'rose_mary'] } }, 'null is not allowed here'],
            ['$in:[null]', { t: { $in: [null] } }, 'null is not allowed here'],
            ['$nin含null', { t: { $nin: [null, 'rose_mary'] } }, 'null is not allowed here'],
            ['$nin:[null]', { t: { $nin: [null] } }, 'null is not allowed here'],
            ['比較運算子之值為null', { i: { $gt: null } }, 'null is not allowed here'],
            ['空$nin', { i: { $nin: [] } }, '$nin with empty array is always true'],
            ['$or含空$nin', { $or: [{ t: { $nin: [] } }, { s: 'zz' }] }, '$nin with empty array is always true'],
            ['$or含空條件', { $or: [{}, { s: 's1' }] }, 'empty condition'],
            ['$and含空條件', { $and: [{}] }, 'empty condition'],
            ['欄名含$', { 'p$x': 'q' }, 'unsupported column name [p$x]'],
            ['頂層null(原為全部)', null, 'condition must be a plain object'],
            ['頂層陣列(原為全部)', [], 'condition must be a plain object'],
            ['頂層字串(原為全部)', 's1', 'condition must be a plain object'],

            //run04(規格句 R4欄名解析 嚴格鍵): 鍵須與屬性名或資料庫欄名完全相符, 其餘一律於轉譯階段reject, 不倚賴資料庫之識別字解析(兩方言同結果、兩函數訊息相同);
            //原sqlite下型別不符之變體鍵使delAll刪除全部非NULL列, 並有sqlite隱含欄rowid、引號被sequelize刪除而成既有欄、mssql之全形/尾端空白/可忽略字元等價之繞過
            //(第33項批1: 尾端空白、全形空白、可忽略字元等含非字母數字底線者於形狀階段即reject為unsupported column name; 全形字母、等價字母等仍屬欄名文法, 由嚴格鍵reject為unknown column name)
            ['欄名大小寫變體 × 非數值字串', { I: { $lt: 'abc' } }, 'unknown column name [I]'],
            ['欄名大小寫變體 × 非日期字串', { D: { $lt: 'garbage' } }, 'unknown column name [D]'],
            ['欄名全形變體(mssql預設定序視為同一識別字)', { 'ｉ': { $lt: 'abc' } }, 'unknown column name'],
            ['欄名尾端空白(mssql忽略識別字尾端空白)', { 'i ': { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名尾端全形空白', { ['i' + String.fromCharCode(0x3000)]: { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名附加可忽略字元(mssql預設定序視為同一識別字)', { ['i' + String.fromCharCode(0xFEFF)]: { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名以mssql預設定序之等價字元(U+026A)取代i', { [String.fromCharCode(0x26A)]: { $lt: 'abc' } }, 'unknown column name'],
            ['sqlite隱含欄rowid(attrs未列)', { rowid: { $lt: 'abc' } }, 'unknown column name [rowid]'],
            ['欄名含反引號(sqlite之quoteIdentifier刪除之而成i)', { 'i`': { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名含方括號(mssql之quoteIdentifier刪除之而成i)', { 'i[]': { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名含單引號', { 'i\'': { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名含雙引號', { 'i"': { $lt: 'abc' } }, 'unsupported column name'],
            ['欄名含點(JSON路徑/表.欄)', { 'i.x': { $lt: 'abc' } }, 'unsupported column name'],
            ['Object.prototype成員名', { constructor: { $lt: 'abc' } }, 'unsupported column name [constructor]'],
            //run04(sol H1)於第33項批1: $options不再受理, 僅有$options者為白名單外之運算子
            ['僅$options為undefined', { s: { $options: undefined } }, 'unsupported operator [$options]'],
            //審計02 外審 opus [2](規格句 R4 DATE: 換算UTC後年份須在1–9999): 年10000起 sequelize 以5位數格式化, sqlite 以文字比較致 $gt 命中並刪除全部日期列
            ['DATE欄收UTC年10000之Date', { d: { $gt: new Date(253402300800000) } }, 'does not match column type [date]'],
            ['DATE欄收UTC年10000之epoch', { d: { $gt: 253402300800000 } }, 'does not match column type [date]'],
            ['DATE欄收UTC年10000之ISO字串', { d: { $gt: '9999-12-31T23:30:00-05:00' } }, 'does not match column type [date]'],
            ['DATE欄收UTC年0000之epoch', { d: { $lt: -62135596800001 } }, 'does not match column type [date]'],
            ['讀值之getter不被執行而reject(存取器屬性)', Object.defineProperty({}, 's', {
                enumerable: true,
                get: () => {
                    throw new Error('getter boom')
                }
            }), 'accessor property is not allowed'],
        ]

        //run04(規格句 R3欄位引用不變式、R4嚴格鍵、系列最低要求②③): attrs已給時不存在之欄 × 空集合各入口於轉譯階段reject(原常數形式使delAll清空全表;
        //HEAD改為引用欄位後仰賴資料庫回報, 現由嚴格鍵直接reject, 兩函數訊息相同, mssql同一語句多次引用不存在之欄而err.message為空之情形不再可達)
        for (let [t, col, find] of [
            ['空$in', 'nocol', { nocol: { $in: [] } }],
            ['$or含空$in', 'nocol', { $or: [{ nocol: { $in: [] } }, { id: 'zz' }] }],
            ['$and含空$in', 'nocol', { $and: [{ nocol: { $in: [] } }, { id: 'r1' }] }],
            ['欄名打錯且空$in', 'sttus', { sttus: { $in: [] } }],
            ['欄名打錯且$in有值', 'sttus', { sttus: { $in: ['x'] } }],
        ]) {
            bads.push([`不存在之欄 × ${t}`, find, `unknown column name [${col}]`])
        }
        //合法值 × 各欄型之大小寫變體鍵: 不論型別相符與否一律reject(原與屬性名鍵同結果, 見帳本〈破壞性變更紀錄〉)
        for (let [col, val] of [['s', 's1'], ['t', 'peter'], ['i', 1], ['f', 1.5], ['p', 1.5], ['dec', 1.25], ['b', true], ['d', new Date('2019-01-01T00:00:00Z')], ['d', '2019-01-01T00:00:00Z'], ['d', { $gt: Date.parse('2030-01-01T00:00:00Z') }]]) {
            bads.push([`欄名大小寫變體(${col}) × 合法值`, { [col.toUpperCase()]: val }, `unknown column name [${col.toUpperCase()}]`])
        }

        for (let [t, find, msg] of bads) {
            it(`不合法條件兩函數皆reject且資料不變: ${t}`, async function() {
                //rulebook R3/R4/R6/R7: 不得靜默忽略或改變語意; 兩函數訊息相同且各發一次error事件
                await reset()
                let evs = []
                let fn = (mode, data, err) => evs.push({ mode, err })
                w.on('error', fn)
                let rs = await w.select(find).then(() => null).catch((err) => String(err.message || err))
                let rd = await w.delAll(find).then(() => null).catch((err) => String(err.message || err))
                w.off('error', fn)
                assert.ok(rs !== null && rs.indexOf(msg) >= 0, `select: ${rs}`)
                assert.strictEqual(rd, rs)
                assert.deepStrictEqual(evs.map((v) => v.mode), ['select', 'delAll'])
                assert.strictEqual(evs[0].err, rs)
                assert.strictEqual((await w.select()).length, 6)
            })
        }

    })


    describe(`${label} pk type`, function() {

        //rulebook R8(run04): 主鍵值依model主鍵欄型別正規化, 與w-orm-mdb之normPk同一規則(主控複審run03第二節之表);
        //型別不符或無效者: selectByPk回null、del該筆ok為0、save/insert/insertBulk整批reject、select/delAll reject
        //users之id為STRING, tpkint之id為INTEGER

        let w = null
        let wi = null
        let wd = null

        let errOf = (p) => p.then(() => null).catch((err) => String(err.message || err))

        before(async function() {
            w = wo(getOpt())
            w.on('error', () => {})
            await w.createStorage()
            wi = wo(getOpt({ cl: 'tpkint', autoGenPk: false }))
            wi.on('error', () => {})
            await wi.createStorage()
            wd = wo(getOpt({ cl: 'tpkdec', autoGenPk: false }))
            wd.on('error', () => {})
            await wd.createStorage()
        })

        describe('字串主鍵欄', function() {

            let ids = async () => (await w.select()).map((v) => v.id).sort()

            beforeEach(async function() {
                await w.delAll()
                await w.insert([{ id: '123', name: 'n123' }, { id: '45', name: 'n45' }, { id: 'abc', name: 'nabc' }])
            })

            it('selectByPk 收有限數字視為String(v)而命中', async function() {
                //R8: 字串類主鍵欄之有限數字以String(v)處置
                assert.deepStrictEqual(await w.selectByPk(123), { id: '123', name: 'n123', value: null })
                assert.deepStrictEqual(await w.selectByPk('123'), { id: '123', name: 'n123', value: null })
                assert.strictEqual(await w.selectByPk(1.5), null) //即'1.5', 不存在
            })

            it('selectByPk 收無效值回null且不reject', async function() {
                //R8: NaN、±Infinity、空字串、布林、物件、陣列、null、undefined為無效
                for (let v of [NaN, Infinity, -Infinity, '', true, {}, [123], null, undefined]) {
                    assert.strictEqual(await w.selectByPk(v), null, String(v))
                }
            })

            it('insert與insertBulk 收有限數字存為字串, 其後各函數視為同一主鍵', async function() {
                //R8: 正規化值就地寫回數據後寫入, 令insert之寫入值與selectByPk、insert去重之比對值一致(規格:265)
                let evs = []
                let fn = (mode, data) => evs.push(data)
                w.on('change', fn)
                let r1 = await w.insert({ id: 456, name: 'n456' })
                w.off('change', fn)
                assert.deepStrictEqual(r1, { n: 1, nInserted: 1, ok: 1 })
                assert.strictEqual(evs[0][0].id, '456') //事件之數據即實際寫入者
                assert.strictEqual((await w.select({ id: '456' }))[0].id, '456')
                assert.deepStrictEqual(await w.insert({ id: '456' }), { n: 1, nInserted: 0, ok: 1 })
                assert.deepStrictEqual(await w.insert({ id: 123 }), { n: 1, nInserted: 0, ok: 1 })
                assert.strictEqual((await w.selectByPk(456)).name, 'n456')
                assert.deepStrictEqual(await w.insertBulk([{ id: 789, name: 'n789' }]), { n: 1, nInserted: 1, ok: 1 })
                assert.ok(await errOf(w.insertBulk([{ id: '789' }])) !== null, 'insertBulk未把789與\'789\'視為同一主鍵')
                assert.deepStrictEqual(await ids(), ['123', '45', '456', '789', 'abc'])
            })

            it('save 收有限數字視為字串而更新既有數據', async function() {
                //R8: 有效主鍵之正規化值供save之預讀與更新條件
                assert.deepStrictEqual(await w.save({ id: 123, name: 'x' }), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                assert.strictEqual((await w.selectByPk('123')).name, 'x')
                assert.deepStrictEqual(await ids(), ['123', '45', 'abc'])
            })

            it('del 收有限數字視為字串而刪除, 收無效值該筆ok為0', async function() {
                //R8: del之無效 → 該筆{n:0,nDeleted:0,ok:0,err}, 不中斷他筆
                let msg = await w.del([{ id: 123 }, { id: true }, { id: 45 }])
                assert.deepStrictEqual(msg.map((v) => [v.n, v.nDeleted, v.ok]), [[1, 1, 1], [0, 0, 0], [1, 1, 1]])
                assert.strictEqual(typeof msg[1].err, 'string')
                assert.deepStrictEqual(await ids(), ['abc'])
            })

            //[說明, find, 預期命中之id]
            let cases = [
                ['等值', { id: 123 }, ['123']],
                ['$eq', { id: { $eq: 45 } }, ['45']],
                ['$in', { id: { $in: [123, 45] } }, ['123', '45']],
                ['$nin', { id: { $nin: [123] } }, ['45', 'abc']],
                ['$ne', { id: { $ne: 45 } }, ['123', 'abc']],
                ['$gt以字串比較', { id: { $gt: 2 } }, ['45', 'abc']],
                ['$or', { $or: [{ id: 123 }, { name: 'nabc' }] }, ['123', 'abc']],
            ]
            for (let [t, find, exp] of cases) {
                it(`select與delAll 主鍵欄之數字條件值視為字串且兩者一致: ${t}`, async function() {
                    //R8: 主鍵欄之條件值依normPk正規化($gt:2即> '2'之字串比較); R1: select命中 = delAll刪除 = 本表常數
                    assert.deepStrictEqual((await w.select(find)).map((v) => v.id).sort(), exp)
                    assert.deepStrictEqual(await w.delAll(find), { n: exp.length, nDeleted: exp.length, ok: 1 })
                    assert.deepStrictEqual(await ids(), ['123', '45', 'abc'].filter((v) => exp.indexOf(v) < 0))
                })
            }

            let bads = [
                ['布林', { id: true }],
                ['空字串', { id: '' }],
                ['$ne空字串', { id: { $ne: '' } }],
                ['$in含布林', { id: { $in: [123, false] } }],
            ]
            for (let [t, find] of bads) {
                it(`select與delAll 主鍵欄之無效條件值皆reject且不刪除: ${t}`, async function() {
                    //R8: 無效之主鍵條件值reject(同R4之訊息), 不誤刪
                    let rs = await errOf(w.select(find))
                    let rd = await errOf(w.delAll(find))
                    assert.ok(rs !== null && rs.indexOf('does not match column type [str]') >= 0, `select: ${rs}`)
                    assert.strictEqual(rd, rs)
                    assert.deepStrictEqual(await ids(), ['123', '45', 'abc'])
                })
            }

        })

        describe('整數主鍵欄', function() {

            let ids = async () => (await wi.select()).map((v) => v.id).sort((a, b) => a - b)

            beforeEach(async function() {
                await wi.delAll()
                await wi.insert([{ id: 12, name: 'n12' }, { id: 5, name: 'n5' }])
            })

            it('selectByPk 收標準整數寫法之字串視為整數而命中', async function() {
                //R8: 整數類主鍵欄之標準整數寫法字串(String(Number(s))===s)轉為Number(s)
                assert.strictEqual((await wi.selectByPk('12')).name, 'n12')
                assert.strictEqual((await wi.selectByPk(12)).name, 'n12')
                assert.strictEqual((await wi.selectByPk('12')).id, 12)
            })

            it('selectByPk 收非標準寫法之字串與非整數為型別不符而回null', async function() {
                //R8: '012'、'+12'、'12.0'、'1e1'、' 12'、'0x0c'、'abc'、12.4為型別不符, 不送查詢
                for (let v of ['012', '+12', '12.0', '1e1', ' 12', '0x0c', 'abc', 12.4]) {
                    assert.strictEqual(await wi.selectByPk(v), null, String(v))
                }
            })

            it('insert收標準整數寫法之字串存為整數; 收型別不符者insert、insertBulk、save皆整批reject且不寫入', async function() {
                //R8: 有效者正規化後寫入; 型別不符者寫入前整批reject, 不以自動產生之主鍵取代
                assert.deepStrictEqual(await wi.insert({ id: '13', name: 'n13' }), { n: 1, nInserted: 1, ok: 1 })
                assert.strictEqual((await wi.selectByPk(13)).id, 13)
                assert.deepStrictEqual(await wi.insert({ id: 13 }), { n: 1, nInserted: 0, ok: 1 })
                for (let bad of ['012', 12.4, 'abc']) {
                    let r = await errOf(wi.insert([{ id: 14 }, { id: bad }]))
                    assert.ok(r !== null && r.indexOf('type does not match pk column') >= 0, `insert ${bad}: ${r}`)
                    let rb = await errOf(wi.insertBulk([{ id: 14 }, { id: bad }]))
                    assert.ok(rb !== null && rb.indexOf('type does not match pk column') >= 0, `insertBulk ${bad}: ${rb}`)
                    let rv = await errOf(wi.save([{ id: 14 }, { id: bad }]))
                    assert.ok(rv !== null && rv.indexOf('type does not match pk column') >= 0, `save ${bad}: ${rv}`)
                }
                assert.deepStrictEqual(await ids(), [5, 12, 13])
            })

            it('save收標準整數寫法之字串視為整數而更新', async function() {
                //R8: 有效主鍵之正規化值供save之預讀與更新條件
                assert.deepStrictEqual(await wi.save({ id: '12', name: 'x' }), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                assert.strictEqual((await wi.selectByPk(12)).name, 'x')
                assert.deepStrictEqual(await ids(), [5, 12])
            })

            it('del收標準整數寫法之字串而刪除; 型別不符者該筆ok為0且不送查詢', async function() {
                //R8: del之型別不符 → 該筆{n:0,nDeleted:0,ok:0,err}, 不中斷他筆
                let msg = await wi.del([{ id: '012' }, { id: 12.4 }, { id: 'abc' }, { id: '12' }])
                assert.deepStrictEqual(msg.map((v) => [v.n, v.nDeleted, v.ok]), [[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, 1]])
                for (let k = 0; k < 3; k++) {
                    assert.ok(msg[k].err.indexOf('type does not match pk column') >= 0, msg[k].err)
                }
                assert.deepStrictEqual(await ids(), [5])
            })

            //[說明, find, 預期命中之id]
            let cases = [
                ['等值字串', { id: '12' }, [12]],
                ['$in字串', { id: { $in: ['12', '5'] } }, [5, 12]],
                ['$gt字串', { id: { $gt: '6' } }, [12]],
                ['$nin字串', { id: { $nin: ['12'] } }, [5]],
            ]
            for (let [t, find, exp] of cases) {
                it(`select與delAll 主鍵欄之整數寫法字串視為整數且兩者一致: ${t}`, async function() {
                    //R8: 主鍵欄之條件值依normPk正規化; R1: select命中 = delAll刪除 = 本表常數
                    assert.deepStrictEqual((await wi.select(find)).map((v) => v.id).sort((a, b) => a - b), exp)
                    assert.deepStrictEqual(await wi.delAll(find), { n: exp.length, nDeleted: exp.length, ok: 1 })
                    assert.deepStrictEqual(await ids(), [5, 12].filter((v) => exp.indexOf(v) < 0))
                })
            }

            let bads = [
                ['前導零', { id: '012' }],
                ['非整數', { id: 12.4 }],
                ['非數值字串', { id: { $in: ['abc'] } }],
                ['$ne前導零', { id: { $ne: '012' } }],
            ]
            for (let [t, find] of bads) {
                it(`select與delAll 主鍵欄之型別不符條件值皆reject且不刪除: ${t}`, async function() {
                    //R8: 型別不符之主鍵條件值reject(同R4之訊息), 不誤刪
                    let rs = await errOf(wi.select(find))
                    let rd = await errOf(wi.delAll(find))
                    assert.ok(rs !== null && rs.indexOf('does not match column type [int]') >= 0, `select: ${rs}`)
                    assert.strictEqual(rd, rs)
                    assert.deepStrictEqual(await ids(), [5, 12])
                })
            }


            //run04(規格句 R4欄名解析 嚴格鍵、R8): 主鍵欄之非完全相符鍵一律於轉譯階段reject, 不倚賴資料庫之識別字解析(原大小寫變體於兩方言、
            //mssql之全形/尾端空白/可忽略字元等價皆繞過R8而命中並刪除id=12; 合法值之變體亦reject, 見帳本〈破壞性變更紀錄〉)
            let ws = String.fromCharCode(0x3000)
            let fe = String.fromCharCode(0xFEFF)
            let ip = String.fromCharCode(0x26A)
            let badKeys = [
                ['欄名大小寫變體+前導零', { ID: '012' }, 'unknown column name [ID]'],
                ['欄名大小寫變體+整數寫法字串', { ID: '12' }, 'unknown column name [ID]'],
                ['欄名大小寫變體+$in字串', { Id: { $in: ['12', '5'] } }, 'unknown column name [Id]'],
                ['欄名大小寫變體+非整數', { Id: 12.4 }, 'unknown column name [Id]'],
                ['欄名全形變體+前導零', { 'ＩＤ': '012' }, 'unknown column name'],
                ['欄名尾端空白+前導零', { 'id ': '012' }, 'unsupported column name'],
                ['欄名大寫+尾端空白+前導零', { 'ID  ': '012' }, 'unsupported column name'],
                ['欄名尾端全形空白+前導零', { ['id' + ws]: '012' }, 'unsupported column name'],
                ['欄名附加可忽略字元+前導零', { ['id' + fe]: '012' }, 'unsupported column name'],
                ['欄名以U+026A取代i+前導零', { [ip + 'd']: '012' }, 'unknown column name'],
                ['欄名含反引號+前導零', { 'i`d': '012' }, 'unsupported column name'],
                ['欄名含方括號+前導零', { 'i[d]': '012' }, 'unsupported column name'],
                ['欄名含單引號+前導零', { 'i\'d': '012' }, 'unsupported column name'],
            ]
            for (let [t, find, msg] of badKeys) {
                it(`select與delAll 主鍵欄之非完全相符鍵皆reject且不刪除: ${t}`, async function() {
                    let rs = await errOf(wi.select(find))
                    let rd = await errOf(wi.delAll(find))
                    assert.ok(rs !== null && rs.indexOf(msg) >= 0, `select: ${rs}`)
                    assert.strictEqual(rd, rs)
                    assert.deepStrictEqual(await ids(), [5, 12])
                })
            }

        })

        describe('DECIMAL主鍵欄', function() {

            //tpkdec之id為DECIMAL(10,2)

            let ids = async () => (await wd.select()).map((v) => Number(v.id)).sort((a, b) => a - b)

            beforeEach(async function() {
                await wd.delAll()
                await wd.insert([{ id: 1.25, name: 'a' }, { id: 0.5, name: 'b' }])
            })

            it('標準數字字串視為數值, selectByPk、select、del之命中一致', async function() {
                //R8: 其他數值類主鍵欄之標準數字字串(String(Number(s))===s)轉為數值
                assert.strictEqual((await wd.selectByPk('1.25')).name, 'a')
                assert.deepStrictEqual((await wd.select({ id: '0.5' })).map((v) => v.name), ['b'])
                assert.deepStrictEqual((await wd.del({ id: '1.25' })).map((v) => [v.n, v.nDeleted, v.ok]), [[1, 1, 1]])
                assert.deepStrictEqual(await ids(), [0.5])
            })

            for (let bad of [1.254, '1.254']) {
                it(`小數位多於scale者為型別不符, 各函數皆不寫入、不命中、不刪除: ${typeof bad} ${bad}`, async function() {
                    //R8(表外細化): 寫入時會被四捨五入而改變鍵(mssql存為1.25而insert回報已存在、selectByPk卻回null), 故視為型別不符
                    assert.strictEqual(await wd.selectByPk(bad), null)
                    for (let [k, fn] of [['insert', () => wd.insert({ id: bad })], ['insertBulk', () => wd.insertBulk({ id: bad })], ['save', () => wd.save({ id: bad, name: 'x' })]]) {
                        let r = await errOf(fn())
                        assert.ok(r !== null && r.indexOf('type does not match pk column') >= 0, `${k}: ${r}`)
                    }
                    let md = await wd.del({ id: bad })
                    assert.deepStrictEqual([md[0].n, md[0].nDeleted, md[0].ok], [0, 0, 0])
                    let rs = await errOf(wd.select({ id: bad }))
                    let rd = await errOf(wd.delAll({ id: bad }))
                    assert.ok(rs !== null && rs.indexOf('does not match column type [num]') >= 0, `select: ${rs}`)
                    assert.strictEqual(rd, rs)
                    assert.deepStrictEqual(await ids(), [0.5, 1.25])
                    assert.strictEqual((await wd.selectByPk(1.25)).name, 'a')
                })
            }

        })

    })

    describe(`${label} dateNoTz`, function() {

        //審計02(規格句 R4 ctx.dateNoTz②④⑤): cvFind之ctx.dateNoTz='local'(由呼叫端明示, 供w-orm-mdb等無時區日期後端)——
        //無時區字串依主機時區解析, select與delAll之命中須等於以本地時間分量建構之Date之命中(命中集合由JS端獨立算出); 不合法值仍reject且資料不變; 未給時維持reject
        //以cvFind直接轉譯後交sequelize執行(WOrmReladb本身不設定該選項, R4③)

        let sq = null
        let md = null

        //withTz, 暫時切換主機時區; 還原須以賦值而非delete: Windows上delete process.env.TZ不會還原主機時區(實測仍停在最後設定之時區), 故載入時先記下主機時區名稱
        let hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        let withTz = async (tz, fn) => {
            let old = process.env.TZ
            if (tz !== null) {
                process.env.TZ = tz
            }
            try {
                return await fn()
            }
            finally {
                if (tz !== null) {
                    if (old !== undefined) {
                        process.env.TZ = old
                    }
                    else if (process.platform === 'win32') {
                        process.env.TZ = hostTz
                    }
                    else {
                        delete process.env.TZ
                    }
                }
            }
        }

        let L = (a) => new Date(a[0], a[1] - 1, a[2], a[3] || 0, a[4] || 0, a[5] || 0, a[6] || 0)
        let rowsDef = {
            r1: [2026, 1, 1, 0, 0, 0, 0],
            r2: [2026, 6, 15, 8, 30, 15, 123],
            r3: [2026, 6, 15, 8, 30, 15, 0],
            r4: [2026, 12, 31, 23, 59, 59, 999],
        }
        let ALL = ['r1', 'r2', 'r3', 'r4', 'r5']
        let ctx = (ex = {}) => ({ escape: (v) => sq.escape(v), attrs: md.rawAttributes, dialect: label, pk: 'id', ...ex })
        let ids = async () => (await md.findAll({ raw: true })).map((v) => v.id).sort()
        let orc = (fn) => Object.entries(rowsDef).filter(([, a]) => fn(L(a).getTime())).map(([id]) => id).sort()
        let T = (a) => L(a).getTime()
        let S0 = [2026, 6, 15, 8, 30, 15, 0]

        before(async function() {
            let o = getOpt()
            if (label === 'sqlite') {
                sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
            }
            else {
                let u = new URL(o.url)
                sq = new Sequelize(o.db, decodeURIComponent(u.username), decodeURIComponent(u.password), { dialect: 'mssql', host: u.hostname, port: Number(u.port), logging: false })
            }
            md = sq.define('tdtz', { id: { type: Sequelize.STRING, primaryKey: true }, d: { type: Sequelize.DATE } }, { tableName: 'tdtz', timestamps: false })
            await md.sync({ force: true })
        })

        after(async function() {
            if (md) {
                await md.drop()
            }
            if (sq) {
                await sq.close()
            }
        })

        let seed = async () => {
            await md.destroy({ where: {} })
            let rs = Object.entries(rowsDef).map(([id, a]) => ({ id, d: L(a) }))
            rs.push({ id: 'r5', d: null })
            await md.bulkCreate(rs)
        }

        //[說明, find, 預期命中之id的述詞(t: 該列之毫秒時間; 於withTz內以當下時區之本地時間分量求值, 與被測實作無共用程式碼)或id陣列]
        let cases = [
            ['等值(T分隔,秒)', { d: '2026-01-01T00:00:00' }, (t) => t === T([2026, 1, 1])],
            ['等值(空白分隔)', { d: '2026-06-15 08:30:15' }, (t) => t === T(S0)],
            ['等值(省秒)', { d: '2026-01-01T00:00' }, (t) => t === T([2026, 1, 1])],
            ['等值(毫秒.123)', { d: '2026-06-15T08:30:15.123' }, (t) => t === T([2026, 6, 15, 8, 30, 15, 123])],
            ['等值(.123456截斷至123ms)', { d: '2026-06-15T08:30:15.123456' }, (t) => t === T([2026, 6, 15, 8, 30, 15, 123])],
            ['$gt', { d: { $gt: '2026-06-15T08:30:15' } }, (t) => t > T(S0)],
            ['$gte', { d: { $gte: '2026-06-15T08:30:15' } }, (t) => t >= T(S0)],
            ['$lt', { d: { $lt: '2026-06-15T08:30:15' } }, (t) => t < T(S0)],
            ['$lte', { d: { $lte: '2026-06-15T08:30:15' } }, (t) => t <= T(S0)],
            ['$ne(SQL三值不含NULL列)', { d: { $ne: '2026-06-15T08:30:15' } }, (t) => t !== T(S0)],
            ['$in', { d: { $in: ['2026-01-01T00:00:00', '2026-12-31T23:59:59.999'] } }, (t) => t === T([2026, 1, 1]) || t === T([2026, 12, 31, 23, 59, 59, 999])],
            ['$nin(SQL三值不含NULL列)', { d: { $nin: ['2026-01-01T00:00:00', '2026-12-31T23:59:59.999'] } }, (t) => t !== T([2026, 1, 1]) && t !== T([2026, 12, 31, 23, 59, 59, 999])],
            ['範圍$gte+$lt', { d: { $gte: '2026-06-15T00:00:00', $lt: '2026-06-16T00:00:00' } }, (t) => t >= T([2026, 6, 15]) && t < T([2026, 6, 16])],
            ['$gte+$lte同欄(取代原Op.between)', { d: { $gte: '2026-06-15T08:30:15', $lte: '2026-12-31T23:59:59.999' } }, (t) => t >= T(S0) && t <= T([2026, 12, 31, 23, 59, 59, 999])],
            ['$in混有帶時區字串', { d: { $in: ['2026-01-01T00:00:00', '2026-06-15T00:30:15.123Z'] } }, (t) => t === T([2026, 1, 1]) || t === Date.parse('2026-06-15T00:30:15.123Z')],
            ['null照舊', { d: null }, ['r5']],
        ]

        for (let tz of [null, 'UTC', 'America/New_York']) {
            for (let [t, find, pe] of cases) {
                it(`dateNoTz=local 之 select 與 delAll 命中一致且等於本地時間分量之命中 [TZ=${tz === null ? 'host' : tz}]: ${t}`, async function() {
                    await withTz(tz, async () => {
                        //預期值於該時區下以本地時間分量獨立求出(非經被測實作)
                        let exp = typeof pe === 'function' ? orc(pe) : pe
                        await seed()
                        let w = cvFind(find, ctx({ dateNoTz: 'local' }))
                        let hit = (await md.findAll({ where: w, raw: true })).map((v) => v.id).sort()
                        assert.deepStrictEqual(hit, exp, 'select之命中')
                        let r = await md.destroy({ where: w })
                        let left = await ids()
                        let gone = ALL.filter((v) => left.indexOf(v) < 0)
                        assert.deepStrictEqual(gone, hit, 'delAll之刪除')
                        assert.strictEqual(r, hit.length)
                    })
                })
            }
        }

        //不合法值與未給時之拒收, 於轉譯階段即拋錯(不交給資料庫), 屬純函數行為, 由test/unit-cvfind.test.mjs之「審計02」組逐案斷言
        //WOrmReladb未接線dateNoTz, 故不在此以select/delAll重述
    })


    describe(`${label} 欄名別名與撞名`, function() {

        //審計02 外審修正輪2、run04 重構(規格句 R4欄名解析〔嚴格鍵〕、R4 DATE通過檢核者轉Date送出; 系列最低要求①②): 屬性名≠欄名之model於資料庫上實跑——
        //(1)資料庫欄名 ≡ 屬性名: select命中 = delAll刪除 = 由seed數據獨立推得之id集合(大小寫變體等非完全相符之鍵一律reject, 見bads); (2)型別不符reject且資料不變;
        //(3)撞名(屬性ra之欄名rb恰為屬性rb之名稱, sequelize把鍵ra映射為rb後以rawAttributes.rb之型別序列化值): 反查所得非本屬性者reject(不論型別類別), 資料不變
        //以cvFind直接轉譯後交sequelize之findAll/destroy執行(與WOrmReladb之select/delAll同一路徑), 同dateNoTz段

        let sq = null
        let md = null
        let ALL = ['r1', 'r2', 'r3', 'r4']
        let ctx = () => ({ escape: (v) => sq.escape(v), attrs: md.rawAttributes, dialect: label, pk: 'id' })
        let ids = async () => (await md.findAll({ raw: true })).map((v) => v.id).sort()
        let hit = async (find) => (await md.findAll({ where: cvFind(find, ctx()), raw: true })).map((v) => v.id).sort()
        //errOf, 執行fn並回傳其拋出之訊息(未拋錯為null); cvFind於轉譯階段同步拋錯, 故須包在函數內
        let errOf = async (fn) => {
            try {
                await fn()
                return null
            }
            catch (e) {
                return String(e.message)
            }
        }

        before(async function() {
            let o = getOpt()
            if (label === 'sqlite') {
                sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
            }
            else {
                let u = new URL(o.url)
                sq = new Sequelize(o.db, decodeURIComponent(u.username), decodeURIComponent(u.password), { dialect: 'mssql', host: u.hostname, port: Number(u.port), logging: false })
            }
            md = sq.define('talias', {
                id: { type: Sequelize.STRING, primaryKey: true },
                ageNum: { type: Sequelize.INTEGER, field: 'age_num' },
                title: { type: Sequelize.TEXT, field: 'physical_title' },
                at: { type: Sequelize.DATE, field: 'at_col' },
                ra: { type: Sequelize.DATE, field: 'rb' }, //欄名rb, 恰為下一屬性之名稱
                rb: { type: Sequelize.INTEGER, field: 'rc' },
            }, { tableName: 'talias', timestamps: false })
            await md.sync({ force: true })
        })

        after(async function() {
            if (md) {
                await md.drop()
            }
            if (sq) {
                await sq.close()
            }
        })

        let seed = async () => {
            await md.destroy({ where: {} })
            await md.bulkCreate([
                { id: 'r1', ageNum: 5, title: 'rose_mary', at: new Date('2019-01-01T00:00:00Z'), ra: new Date('2019-01-01T00:00:00Z'), rb: 5 },
                { id: 'r2', ageNum: 6, title: 'Peter', at: new Date('2026-06-15T00:00:00Z'), ra: new Date('2026-06-15T00:00:00Z'), rb: 6 },
                { id: 'r3', ageNum: 7, title: '100%', at: new Date('2026-06-01T00:00:00Z'), ra: new Date('2026-06-01T00:00:00Z'), rb: 7 },
                { id: 'r4' },
            ])
        }

        //[說明, 屬性名, 資料庫欄名, 值, 預期命中之id]; 預期命中由seed()之數據獨立推得(非取自同一實作之屬性名鍵命中, run05 sol F08、opus [8]):
        //ageNum: r1=5 r2=6 r3=7 r4=NULL; title: r1='rose_mary' r2='Peter' r3='100%' r4=NULL; at: r1=2019-01-01 r2=2026-06-15 r3=2026-06-01 r4=NULL
        let alias = [
            ['INTEGER 等值', 'ageNum', 'age_num', 5, ['r1']],
            ['INTEGER 等值(另一列)', 'ageNum', 'age_num', 6, ['r2']],
            ['INTEGER $gt', 'ageNum', 'age_num', { $gt: 5 }, ['r2', 'r3']],
            ['INTEGER 數值字串', 'ageNum', 'age_num', '7', ['r3']],
            ['INTEGER 空$in', 'ageNum', 'age_num', { $in: [] }, []],
            ['TEXT 等值', 'title', 'physical_title', 'Peter', ['r2']],
            ['DATE $lt ISO字串', 'at', 'at_col', { $lt: '2026-06-01T00:00:00Z' }, ['r1']],
            ['DATE $gt epoch', 'at', 'at_col', { $gt: Date.parse('2020-01-01T00:00:00Z') }, ['r2', 'r3']],
            ['DATE $in 混合', 'at', 'at_col', { $in: [new Date('2019-01-01T00:00:00Z'), '2026-06-15T00:00:00Z', Date.parse('2026-06-02T00:00:00Z')] }, ['r1', 'r2']],
            ['DATE 等值Date', 'at', 'at_col', new Date('2019-01-01T00:00:00Z'), ['r1']],
            ['DATE null', 'at', 'at_col', null, ['r4']],
        ]
        for (let [t, prop, col, val, exp] of alias) {
            it(`資料庫欄名 ≡ 屬性名, select命中 = delAll刪除: ${t}`, async function() {
                await seed()
                let a = await hit({ [prop]: val })
                assert.deepStrictEqual(a, exp, 'select: 屬性名鍵之命中須等於由seed數據獨立推得者')
                let b = await hit({ [col]: val })
                assert.deepStrictEqual(b, exp, 'select: 欄名鍵之命中須等於由seed數據獨立推得者')
                await md.destroy({ where: cvFind({ [col]: val }, ctx()) })
                let left = await ids()
                assert.deepStrictEqual(ALL.filter((v) => left.indexOf(v) < 0), exp, 'delAll: 刪除者須等於由seed數據獨立推得者')
            })
        }

        //未給attrs(深引用者可不給; 鍵不解析而交資料庫, R4)之空集合各入口經資料庫實跑: 原badsNoCol段於嚴格鍵改制後移除, 此處保留其資料庫實跑之證據(run05 opus [9])
        //屬性名鍵仍由sequelize映射為資料庫欄名; 不存在之欄須由資料庫回報而不得清空或刪除
        let ctx0 = () => ({ escape: (v) => sq.escape(v), dialect: label })
        let hit0 = async (find) => (await md.findAll({ where: cvFind(find, ctx0()), raw: true })).map((v) => v.id).sort()
        it('未給attrs: 空集合$in於資料庫實跑之命中(A2), 欄名經sequelize映射', async function() {
            await seed()
            assert.deepStrictEqual(await hit0({ ageNum: { $in: [] } }), [])
            assert.deepStrictEqual(await hit0({ age_num: { $in: [] } }), [])
            assert.deepStrictEqual(await hit0({ ageNum: 5 }), ['r1'])
        })
        for (let [t, find] of [
            ['$in:[]', { nocol: { $in: [] } }],
            ['$or含空$in', { $or: [{ nocol: { $in: [] } }, { id: 'zz' }] }],
        ]) {
            it(`未給attrs: 不存在之欄 × 空集合由資料庫回報而reject, 資料不變: ${t}`, async function() {
                await seed()
                let rs = await errOf(() => md.findAll({ where: cvFind(find, ctx0()), raw: true }))
                let rd = await errOf(() => md.destroy({ where: cvFind(find, ctx0()) }))
                assert.ok(rs !== null, 'select未reject')
                assert.ok(rd !== null, 'delAll未reject')
                assert.deepStrictEqual(await ids(), ALL)
            })
        }

        //型別不符須於轉譯階段reject: 原sqlite下 age_num < 'abc' 恆真而delAll刪除全部非NULL列
        let bads = [
            ['整數欄之欄名 × 非數值字串', { age_num: { $lt: 'abc' } }, '[int]'],
            ['整數欄之欄名大小寫變體(不解析)', { AGE_NUM: 'abc' }, 'unknown column name [AGE_NUM]'],
            ['DATE欄之欄名 × 非日期字串', { at_col: { $lt: 'garbage' } }, '[date]'],
            ['整數欄之欄名 × $regex(白名單外)', { age_num: { $regex: '1' } }, 'unsupported operator [$regex]'],
            ['DATE欄之欄名大小寫變體 × 合法epoch', { AT_COL: { $gt: Date.parse('2030-01-01T00:00:00Z') } }, 'unknown column name [AT_COL]'],
            ['屬性rb(欄rc) × 非數值字串', { rb: { $lt: 'abc' } }, '[int]'],
            ['欄名rc × 非數值字串', { rc: { $lt: 'abc' } }, '[int]'],
        ]
        for (let [t, find, msg] of bads) {
            it(`型別不符reject且資料不變: ${t}`, async function() {
                await seed()
                let rs = await errOf(() => md.findAll({ where: cvFind(find, ctx()), raw: true }))
                let rd = await errOf(() => md.destroy({ where: cvFind(find, ctx()) }))
                assert.ok(rs !== null && rs.indexOf(msg) >= 0, `select: ${rs}`)
                assert.ok(rd !== null && rd.indexOf(msg) >= 0, `delAll: ${rd}`)
                assert.deepStrictEqual(await ids(), ALL)
            })
        }

        //撞名: 屬性ra(DATE, 欄rb)之值若照常轉Date送出, sequelize把鍵ra映射為rb後取到屬性rb(INTEGER)之型別, 以NUMBER序列化而成Date.toString文字,
        //sqlite以文字比較而命中並刪除全部非NULL之rb列(HEAD對直接給Date者即如此); 反查所得非本屬性者須reject(不論型別類別)
        let clash = [
            ['DATE $lt ISO字串', { ra: { $lt: '2026-01-01T00:00:00Z' } }],
            ['DATE 等值Date', { ra: new Date('2019-01-01T00:00:00Z') }],
            ['DATE $gt epoch', { ra: { $gt: Date.parse('2030-01-01T00:00:00Z') } }],
            ['DATE $in', { ra: { $in: ['2019-01-01T00:00:00Z'] } }],
            ['DATE $nin', { ra: { $nin: [new Date('2019-01-01T00:00:00Z')] } }],
        ]
        for (let [t, find] of clash) {
            it(`屬性之欄名恰為他屬性之名稱而型別類別不同: 兩函數皆reject且資料不變: ${t}`, async function() {
                await seed()
                let rs = await errOf(() => md.findAll({ where: cvFind(find, ctx()), raw: true }))
                let rd = await errOf(() => md.destroy({ where: cvFind(find, ctx()) }))
                assert.ok(rs !== null && rs.indexOf('ambiguous column name [ra]') >= 0, `select: ${rs}`)
                assert.ok(rd !== null && rd.indexOf('ambiguous column name [ra]') >= 0, `delAll: ${rd}`)
                assert.deepStrictEqual(await ids(), ALL)
            })
        }

        it('撞名之他屬性(rb, 欄rc)不受影響: 屬性名鍵、欄名鍵之命中一致', async function() {
            await seed()
            let a = await hit({ rb: { $gt: 5 } })
            assert.deepStrictEqual(a, ['r2', 'r3'])
            assert.deepStrictEqual(await hit({ rc: { $gt: 5 } }), a)
            await md.destroy({ where: cvFind({ rc: { $gt: 5 } }, ctx()) })
            assert.deepStrictEqual(await ids(), ['r1', 'r4'])
        })

    })


    describe(`${label} 欄名邊界`, function() {

        //run05 sol F01/F02、opus [1][2][4]、自查(規格句 R4欄名解析(b)(c), 系列最低要求①②③): 欄名恰為sequelize於轉成SQL前重新解讀之形態, 於資料庫實跑——
        //(1)映射後之欄名為空字串: sync以field||name建欄(欄名為屬性名)而mapWhereFieldNames把鍵映射為'', _joinKeyValue遇空鍵只回值, 條件成常數(WHERE (5)), delAll刪全表;
        //(2)首尾皆$且中間有換行: isColString只比首尾字元, 比對的是去掉$之另一欄; $regex加i時LOWER(col)卻引用完整欄名, 同一find因旗標而命中不同列;
        //(3)共用一欄: 欄名恰為先定義者之名稱時, sequelize依先定義者之型別序列化, 實體欄之型別卻由最後定義者決定
        let sq = null
        let mdE = null
        let mdV = null
        let mdS = null
        let ctx = (md) => ({ escape: (v) => sq.escape(v), attrs: md.rawAttributes, dialect: label, pk: 'id' })
        let ids = async (md) => (await md.findAll({ raw: true, attributes: ['id'] })).map((v) => v.id).sort()
        let errOf = async (fn) => {
            try {
                await fn()
                return null
            }
            catch (e) {
                return String(e.message)
            }
        }

        before(async function() {
            let o = getOpt()
            if (label === 'sqlite') {
                sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
            }
            else {
                let u = new URL(o.url)
                sq = new Sequelize(o.db, decodeURIComponent(u.username), decodeURIComponent(u.password), { dialect: 'mssql', host: u.hostname, port: Number(u.port), logging: false })
            }
            //(1)
            mdE = sq.define('tempfd', {
                id: { type: Sequelize.STRING, primaryKey: true },
                a: { type: Sequelize.INTEGER, field: '' },
            }, { tableName: 'tempfd', timestamps: false })
            //(2)
            mdV = sq.define('tdollar', {
                id: { type: Sequelize.STRING, primaryKey: true },
                t: { type: Sequelize.STRING, field: '\nname' },
                w: { type: Sequelize.STRING, field: '$\nname$' },
            }, { tableName: 'tdollar', timestamps: false })
            //(3)
            mdS = sq.define('tshare', {
                id: { type: Sequelize.STRING, primaryKey: true },
                sa: { type: Sequelize.DATE, field: 'sa' },
                sb: { type: Sequelize.INTEGER, field: 'sa' },
            }, { tableName: 'tshare', timestamps: false })
            await mdE.sync({ force: true })
            await mdV.sync({ force: true })
            await mdS.sync({ force: true })
        })

        after(async function() {
            for (let md of [mdE, mdV, mdS]) {
                if (md) {
                    await md.drop()
                }
            }
            if (sq) {
                await sq.close()
            }
        })

        //rej, select與delAll(以cvFind直接轉譯後交sequelize之findAll/destroy, 同WOrmReladb之路徑)皆須於轉譯階段reject且資料不變
        let rej = async (md, seed, find, msg) => {
            await md.destroy({ where: {} })
            await md.bulkCreate(seed)
            let before = await ids(md)
            let rs = await errOf(() => md.findAll({ where: cvFind(find, ctx(md)), raw: true }))
            let rd = await errOf(() => md.destroy({ where: cvFind(find, ctx(md)) }))
            assert.ok(rs !== null && rs.indexOf(msg) >= 0, `select: ${rs}`)
            assert.ok(rd !== null && rd.indexOf(msg) >= 0, `delAll: ${rd}`)
            assert.deepStrictEqual(await ids(md), before, '資料須不變')
        }

        for (let [t, find] of [
            ['等值', { a: 5 }],
            ['$gt', { a: { $gt: 100 } }],
            ['$in', { a: { $in: [5] } }],
            ['空$in', { a: { $in: [] } }],
        ]) {
            it(`映射後之欄名為空字串: 兩函數皆reject且資料不變: ${t}`, async function() {
                //mssql之sync會把rawAttributes.a.field由''正規化為'a'(2026-10-16實測), 該model於mssql無此形態; sqlite不正規化(實測 WHERE (5) 刪全表), 故僅sqlite實跑, 兩方言之轉譯階段拒收由單元測試涵蓋
                if (label !== 'sqlite') {
                    this.skip()
                }
                await rej(mdE, [{ id: 'r1', a: 0 }, { id: 'r2', a: 5 }, { id: 'r3' }], find, 'unsupported column name []')
            })
        }

        for (let [t, find] of [
            ['等值', { w: 'needle' }],
            ['$in', { w: { $in: ['needle'] } }],
        ]) {
            it(`首尾皆$且中間有換行之欄名: 兩函數皆reject且資料不變: ${t}`, async function() {
                await rej(mdV, [{ id: 'r1', t: 'needle', w: 'x' }, { id: 'r2', t: 'x', w: 'needle' }, { id: 'r3' }], find, 'unsupported column name [$\nname$]')
            })
        }

        for (let [t, find] of [
            ['先定義者 × 日期字串', { sa: { $lt: '2030-01-01T00:00:00Z' } }],
            ['先定義者 × epoch', { sa: { $gt: 1893456000000 } }],
            ['先定義者 × Date', { sa: new Date(0) }],
            ['先定義者 × 空$in', { sa: { $in: [] } }],
        ]) {
            it(`共用一欄且欄名恰為先定義者之名稱: 兩函數皆reject且資料不變: ${t}`, async function() {
                await rej(mdS, [{ id: 'r1', sb: 1 }, { id: 'r2', sb: 2 }, { id: 'r3' }], find, 'ambiguous column name [sa]')
            })
        }

        //後定義者sb之欄名sa恰為先定義者之名稱: sequelize以rawAttributes.sa(DATE)序列化sb之值, 同樣不可信, 亦reject(單元測試涵蓋共用非屬性名之欄時最後定義者照常)
        it('共用一欄且欄名恰為先定義者之名稱: 後定義者亦reject(sequelize依先定義者之型別序列化其值), 資料不變', async function() {
            await rej(mdS, [{ id: 'r1', sb: 1 }, { id: 'r2', sb: 2 }, { id: 'r3' }], { sb: { $lt: 2 } }, 'ambiguous column name [sb]')
        })

    })


}

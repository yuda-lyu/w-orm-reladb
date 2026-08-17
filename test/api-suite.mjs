import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'


//本檔為mssql與sqlite共用之測試套組, 令兩種後端以同一組斷言驗證, 避免各自漂移
//斷言皆為規格(資料庫函數回傳定義計算.md)之可執行翻譯, 非現況指紋


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

        it('select $regex不分大小寫', async function() {
            let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
            assert.deepStrictEqual(sr, [{ id: 'id-peter', name: 'peter(modify)', value: 123 }])
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
                let ssIn = await w.select(null, connState)
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
            let ssIn = sortByName(await w.select(null, connState))
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


}

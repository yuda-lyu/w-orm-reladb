import assert from 'assert'
import cloneDeep from 'lodash-es/cloneDeep.js'
import Sequelize from 'sequelize'
import wo from '../src/WOrmReladb.mjs'


//本檔為mssql與sqlite共用之寫入側DATE範圍檢核測試套組(CLAUDE_rulebook.md之R12), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//規格句(R12, dspec〈一之三〉8.): 以文字儲存日期之後端, 寫入拒收範圍外Date——DATE/DATEONLY欄之值須為年份在1–9999之有效時間,
//範圍外與無效時間(Invalid Date、NaN、垃圾字串…, sqlite會存為字典序大於任何年份之文字Invalid date)皆使insert、insertBulk、save整批reject且資料庫不變;
//訊息不回顯值; error事件於reject前恰一次、change不發; 兩方言行為一致(mssql於送出前即拒); 檢查之值即使用之值(具狀態之valueOf不得於二次求值時存入範圍外年份)
//檢核優先序: 已關閉 → 初始化 → procPk(缺主鍵) → normPks(主鍵型別不符) → 日期檢核
//model為models/tdate.js: d、d2為DATE, o為DATEONLY, n為STRING(非日期欄不檢); models/tdatei.js: 整數主鍵 + DATE欄d(測檢核優先序)


let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)

let settle = (pm) => pm.then((v) => ({ ok: true, v })).catch((err) => ({ err }))

let byId = (a, b) => (a.id < b.id ? -1 : 1)

//期望之訊息: 不回顯值, 只含索引與欄名
let want = (i, col) => `invalid data: date is not a valid time in years 1-9999 at [data[${i}].${col}]`

//normD, 讀回之DATE值統一為ISO字串: sqlite讀回為文字'YYYY-MM-DD HH:mm:ss.SSS +00:00', mssql為Date
let normD = (x) => {
    if (x === null || x === undefined) {
        return null
    }
    if (x instanceof Date) {
        return x.toISOString()
    }
    let m = String(x).match(/^(\d{4,6})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) \+00:00$/)
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}Z` : String(x)
}

//normO, 讀回之DATEONLY值統一為'YYYY-MM-DD': sqlite為文字, mssql可能為Date(UTC午夜)
let normO = (x) => {
    if (x === null || x === undefined) {
        return null
    }
    if (x instanceof Date) {
        return x.toISOString().slice(0, 10)
    }
    return String(x).slice(0, 10)
}


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql'), 供describe標題使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineDateWriteSuites(label, getOpt) {


    describe(`${label} 寫入側DATE範圍: 入口 × 拒收值 × 欄位`, function() {

        let w = null
        let ins = null
        let cs = null

        //種子: 3列合法數據, 供「資料庫不變」與save更新既有之用
        let seed = () => [
            { id: 's1', n: 'a', d: new Date('2000-01-01T00:00:00Z'), d2: null, o: '2000-01-01' },
            { id: 's2', n: 'b', d: new Date('2010-06-15T12:30:00Z'), d2: new Date('2011-01-01T00:00:00Z'), o: null },
            { id: 's3', n: 'c', d: null, d2: null, o: '2020-12-31' },
        ]

        let dump = async () => {
            let rs = await w.select({}, cs)
            return rs.sort(byId)
        }

        let reset = async () => {
            await w.delAll({}, cs)
            let r = await w.insert(seed(), cs)
            assert.strictEqual(r.nInserted, 3)
        }

        before(async function() {
            w = wo(getOpt({ cl: 'tdate' }))
            await w.createStorage()
            ins = await w.init()
            cs = { instance: ins }
        })

        after(async function() {
            await ins.close()
        })

        //入口: [名稱, 事件mode, 呼叫函數, 是否針對既有主鍵]
        let entries = [
            ['insert', 'insert', (rs) => w.insert(rs, cs), false],
            ['insertBulk', 'insertBulk', (rs) => w.insertBulk(rs, cs), false],
            ['save(自動插入)', 'save', (rs) => w.save(rs, { ...cs, autoInsert: true }), false],
            ['save(更新既有)', 'save', (rs) => w.save(rs, { ...cs, autoInsert: true }), true],
            ['save(autoInsert:false且主鍵不存在)', 'save', (rs) => w.save(rs, { ...cs, autoInsert: false }), false],
        ]

        //mk, 產生3筆記錄, patches為[[筆索引, 欄名, 值]…]; 其餘欄與其餘筆皆合法
        let mk = (existing, patches) => {
            let ids = existing ? ['s1', 's2', 's3'] : ['x1', 'x2', 'x3']
            let rs = ids.map((id) => ({ id, n: 'new', d: new Date('2030-01-01T00:00:00Z'), o: '2030-01-01' }))
            for (let [p, col, v] of patches) {
                rs[p][col] = v
            }
            return rs
        }

        //runReject, 呼叫入口並斷言: reject、訊息(不回顯值)、error事件於reject前恰一次且mode/err一致、change不發、資料庫逐列不變、呼叫端數據不變
        let runReject = async (entry, rs, msg) => {
            let [, mode, fn] = entry
            await reset()
            let before = await dump()
            let snap = cloneDeep(rs)
            let evs = []
            let errs = []
            let fnE = (m, data, e) => {
                evs.push(`error:${m}`)
                errs.push(e)
            }
            let fnC = (m) => evs.push(`change:${m}`)
            w.on('error', fnE)
            w.on('change', fnC)
            let r
            try {
                r = await settle(fn(rs))
                evs.push('reject')
            }
            finally {
                w.off('error', fnE)
                w.off('change', fnC)
            }
            assert.ok(r.err !== undefined, `未reject: ${JSON.stringify(r.v)}`)
            assert.strictEqual(msgOf(r.err), msg)
            assert.deepStrictEqual(evs, [`error:${mode}`, 'reject'], 'error事件於reject前恰一次, change不發')
            assert.deepStrictEqual(errs, [msg], 'error事件之err與reject訊息一致')
            assert.deepStrictEqual(await dump(), before, '資料庫逐列不變')
            assert.deepStrictEqual(rs, snap, '呼叫端數據不變')
        }

        // ---- DATE欄之拒收值 × 5入口: 中間筆(第2筆)違規, 其餘合法筆亦不得寫入 ----
        let badDate = [
            ['Date 年0末刻', () => new Date('0000-12-31T23:59:59.999Z')],
            ['Date 年10000首刻', () => new Date('+010000-01-01T00:00:00.000Z')],
            ['Date 8.64e15', () => new Date(8.64e15)],
            ['Date -8.64e15', () => new Date(-8.64e15)],
            ['epoch 8.64e15', () => 8.64e15],
            ['epoch -8.64e15', () => -8.64e15],
            ['ISO字串 年0末刻', () => '0000-12-31T23:59:59.999Z'],
            ['ISO字串 年10000首刻', () => '+010000-01-01T00:00:00Z'],
            ['Number包裝物件 8.64e15', () => Object(8.64e15)],
        ]
        for (let entry of entries) {
            for (let [lab, gen] of badDate) {
                it(`${entry[0]} × DATE欄 ${lab}: 整批reject、資料不變`, async function() {
                    await runReject(entry, mk(entry[3], [[1, 'd', gen()]]), want(1, 'd'))
                })
            }
        }

        // ---- DATEONLY欄之拒收值 × 5入口 ----
        let badOnly = [
            ['Date 8.64e15', () => new Date(8.64e15)],
            ['Date -8.64e15', () => new Date(-8.64e15)],
            ['Date 年10000年中', () => new Date('+010000-06-15T12:00:00Z')],
            ['Date 年0年中', () => new Date('0000-06-15T12:00:00Z')],
            ['epoch 8.64e15', () => 8.64e15],
            ['ISO字串 年10000', () => '+010000-01-01'],
            ['ISO字串 年0', () => '0000-12-31'],
        ]
        for (let entry of entries) {
            for (let [lab, gen] of badOnly) {
                it(`${entry[0]} × DATEONLY欄 ${lab}: 整批reject、資料不變`, async function() {
                    await runReject(entry, mk(entry[3], [[1, 'o', gen()]]), want(1, 'o'))
                })
            }
        }

        // ---- 無效時間(sqlite會存為文字Invalid date, mssql由資料庫報錯)亦整批reject × 5入口 ----
        let badInvalid = [
            ['Invalid Date', () => new Date(NaN)],
            ['NaN', () => NaN],
            ['空字串', () => ''],
            ['垃圾字串', () => 'garbage'],
            ['超出Date範圍之epoch 1e16', () => 1e16],
            ['false', () => false],
        ]
        for (let entry of entries) {
            for (let [lab, gen] of badInvalid) {
                it(`${entry[0]} × DATE欄 無效時間 ${lab}: 整批reject、資料不變`, async function() {
                    await runReject(entry, mk(entry[3], [[1, 'd', gen()]]), want(1, 'd'))
                })
            }
            it(`${entry[0]} × DATEONLY欄 無效時間 垃圾字串: 整批reject、資料不變`, async function() {
                await runReject(entry, mk(entry[3], [[1, 'o', 'garbage']]), want(1, 'o'))
            })
        }

        // ---- 位置與多欄 × 5入口 ----
        let bad = () => new Date(8.64e15)
        let positions = [
            ['首筆', (e) => mk(e, [[0, 'd', bad()]]), want(0, 'd')],
            ['末筆', (e) => mk(e, [[2, 'd', bad()]]), want(2, 'd')],
            ['第二個DATE欄(d2)', (e) => mk(e, [[1, 'd2', bad()]]), want(1, 'd2')],
            ['同筆多欄違規: 回報model屬性定義順序之第一個(d先於d2先於o)', (e) => mk(e, [[1, 'o', bad()], [1, 'd2', bad()], [1, 'd', bad()]]), want(1, 'd')],
            ['同筆d2與o違規: 回報d2', (e) => mk(e, [[1, 'o', bad()], [1, 'd2', bad()]]), want(1, 'd2')],
            ['多筆違規: 回報索引最小者', (e) => mk(e, [[2, 'd', bad()], [1, 'd2', bad()]]), want(1, 'd2')],
        ]
        for (let entry of entries) {
            for (let [lab, gen, msg] of positions) {
                it(`${entry[0]} × 位置 ${lab}`, async function() {
                    await runReject(entry, gen(entry[3]), msg)
                })
            }
        }

        // ---- 單一物件(非陣列)輸入 × 5入口 ----
        for (let entry of entries) {
            it(`${entry[0]} × 單一物件(非陣列): 路徑索引為0`, async function() {
                let one = mk(entry[3], [[0, 'd', bad()]])[0]
                await runReject(entry, one, want(0, 'd'))
            })
        }

        // ---- 接受值 × 5入口: 邊界內合法、讀回等於寫入之值 ----
        let okCases = [
            ['Date 年1首刻', { d: new Date('0001-01-01T00:00:00.000Z') }, { d: '0001-01-01T00:00:00.000Z' }],
            ['Date 年9999末刻', { d: new Date('9999-12-31T23:59:59.999Z') }, { d: '9999-12-31T23:59:59.999Z' }],
            ['epoch 年1首刻與年9999末刻(d與d2)', { d: Date.parse('0001-01-01T00:00:00.000Z'), d2: Date.parse('9999-12-31T23:59:59.999Z') }, { d: '0001-01-01T00:00:00.000Z', d2: '9999-12-31T23:59:59.999Z' }],
            ['ISO字串 年1首刻與年9999末刻', { d: '0001-01-01T00:00:00.000Z', d2: '9999-12-31T23:59:59.999Z' }, { d: '0001-01-01T00:00:00.000Z', d2: '9999-12-31T23:59:59.999Z' }],
            ['DATEONLY 年1首日(字串)', { o: '0001-01-01' }, { o: '0001-01-01' }],
            ['DATEONLY 年9999末日(字串)', { o: '9999-12-31' }, { o: '9999-12-31' }],
            ['DATEONLY Date年中', { o: new Date('2026-06-15T12:00:00Z') }, { o: '2026-06-15' }],
            ['null與非日期欄形似範圍外日期之字串', { d: null, d2: null, o: null, n: '275760-09-13 +275760-09-13T00:00:00.000Z' }, { d: null, d2: null, o: null, n: '275760-09-13 +275760-09-13T00:00:00.000Z' }],
        ]
        for (let entry of entries) {
            if (entry[0] === 'save(autoInsert:false且主鍵不存在)') {
                continue //此入口不會寫入, 接受側以另案斷言resolve
            }
            for (let [lab, patch, exp] of okCases) {
                it(`${entry[0]} × 接受 ${lab}`, async function() {
                    await reset()
                    let ids = entry[3] ? ['s1', 's2', 's3'] : ['x1', 'x2', 'x3']
                    let rs = ids.map((id, k) => ({ id, ...(k === 1 ? patch : { n: 'other' }) }))
                    let r = await settle(entry[2](rs))
                    assert.ok(r.err === undefined, `不應reject: ${msgOf(r.err)}`)
                    let row = (await dump()).find((v) => v.id === ids[1])
                    for (let [k, v] of Object.entries(exp)) {
                        let got = k === 'o' ? normO(row[k]) : (k === 'n' ? row[k] : normD(row[k]))
                        assert.strictEqual(got, v, `${k} 讀回`)
                    }
                })
            }
        }

        it('save(autoInsert:false且主鍵不存在)接受合法邊界值: resolve且不寫入', async function() {
            await reset()
            let before = await dump()
            let r = await settle(w.save([{ id: 'x9', d: new Date('9999-12-31T23:59:59.999Z') }], { ...cs, autoInsert: false }))
            assert.ok(r.err === undefined, msgOf(r.err))
            assert.deepStrictEqual(r.v, [{ n: 0, nInserted: 0, nModified: 0, ok: 1 }])
            assert.deepStrictEqual(await dump(), before)
        })

        it('無日期值或日期欄為undefined之記錄不受影響', async function() {
            await reset()
            let r = await w.insert([{ id: 'u1', n: 'x' }, { id: 'u2', d: undefined, o: undefined }], cs)
            assert.deepStrictEqual(r, { n: 2, nInserted: 2, ok: 1 })
        })

    })


    describe(`${label} 寫入側DATE範圍: 情境與接縫`, function() {

        let w = null
        let ins = null
        let cs = null

        before(async function() {
            w = wo(getOpt({ cl: 'tdate' }))
            await w.createStorage()
            ins = await w.init()
            cs = { instance: ins }
        })

        after(async function() {
            await ins.close()
        })

        beforeEach(async function() {
            await w.delAll({}, cs)
        })

        it('修前紅之原始場景: 哨兵new Date(8.64e15)寫入即reject, 其後delAll({d:{$lt:日期}})只刪過期列, 永不過期之替代寫法(9999年末與null)不被刪', async function() {
            //規格句(R12): 「永不過期」哨兵寫入範圍外Date會於sqlite以文字比較被$lt誤中而遭delAll刪除; 現於寫入即拒收
            let r = await settle(w.insert({ id: 'sentinel', d: new Date(8.64e15) }, cs))
            assert.ok(r.err !== undefined, '哨兵須reject')
            await w.insert([
                { id: 'old', d: new Date('2000-01-01T00:00:00Z') },
                { id: 'never1', d: new Date('9999-12-31T23:59:59.999Z') },
                { id: 'never2', d: null },
            ], cs)
            assert.deepStrictEqual((await w.select({}, cs)).map((v) => v.id).sort(), ['never1', 'never2', 'old'])
            let rd = await w.delAll({ d: { $lt: new Date('3000-01-01T00:00:00Z') } }, cs)
            assert.deepStrictEqual(rd, { n: 1, nDeleted: 1, ok: 1 })
            assert.deepStrictEqual((await w.select({}, cs)).map((v) => v.id).sort(), ['never1', 'never2'])
            let rs = await w.select({ d: { $gt: new Date('3000-01-01T00:00:00Z') } }, cs)
            assert.deepStrictEqual(rs.map((v) => v.id), ['never1'])
        })

        it('不給instance之呼叫(內部自行初始化): 範圍外值reject、error事件恰一次, 連線已關閉且其後合法呼叫照常', async function() {
            let w2 = wo(getOpt({ cl: 'tdate' }))
            let evs = []
            w2.on('error', (m) => evs.push(m))
            let r = await settle(w2.insertBulk([{ id: 'a', d: new Date(8.64e15) }]))
            assert.strictEqual(msgOf(r.err), want(0, 'd'))
            assert.deepStrictEqual(evs, ['insertBulk'])
            let r2 = await w2.insertBulk([{ id: 'a', d: new Date('9999-12-31T23:59:59.999Z') }])
            assert.deepStrictEqual(r2, { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(evs, ['insertBulk'], '合法呼叫不發error')
        })

        it('呼叫端交易內: 範圍外值reject不影響交易, 同一交易其後合法寫入與commit照常', async function() {
            let transaction = await w.genTransaction()
            let ct = { instance: ins, transaction }
            let done = false
            try {
                let r = await settle(w.insertBulk([{ id: 't1', d: new Date('2001-01-01T00:00:00Z') }, { id: 't2', d: new Date(-8.64e15) }], ct))
                assert.strictEqual(msgOf(r.err), want(1, 'd'))
                let r2 = await w.insertBulk([{ id: 't3', d: new Date('2003-01-01T00:00:00Z') }], ct)
                assert.deepStrictEqual(r2, { n: 1, nInserted: 1, ok: 1 })
                await transaction.commit()
                done = true
            }
            finally {
                if (!done) {
                    await transaction.rollback().catch(() => {}) //斷言失敗時不留開啟中之交易(sqlite會鎖庫而連累後續案)
                }
            }
            assert.deepStrictEqual((await w.select({}, cs)).map((v) => v.id), ['t3'])
        })

        it('save更新既有列: 範圍外值reject後該列維持舊值, 合法值照常更新', async function() {
            await w.insert({ id: 'k', d: new Date('2000-01-01T00:00:00Z') }, cs)
            let r = await settle(w.save({ id: 'k', d: new Date(8.64e15) }, cs))
            assert.strictEqual(msgOf(r.err), want(0, 'd'))
            assert.strictEqual(normD((await w.selectByPk('k', cs)).d), '2000-01-01T00:00:00.000Z')
            let r2 = await w.save({ id: 'k', d: new Date('9999-12-31T23:59:59.999Z') }, cs)
            assert.deepStrictEqual(r2, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.strictEqual(normD((await w.selectByPk('k', cs)).d), '9999-12-31T23:59:59.999Z')
        })

        it('insert回傳逐筆結果模式(returnList)亦整批reject', async function() {
            let r = await settle(w.insert([{ id: 'a', d: new Date('2001-01-01T00:00:00Z') }, { id: 'b', d: new Date(8.64e15) }], { ...cs, returnList: true }))
            assert.strictEqual(msgOf(r.err), want(1, 'd'))
            assert.deepStrictEqual(await w.select({}, cs), [])
        })

        it('訊息不回顯值, 且不隨值而變: 各種範圍外值之訊息逐字相同', async function() {
            let vals = [new Date(8.64e15), new Date(-8.64e15), 8.64e15, '+010000-01-01T00:00:00Z', '0000-12-31T23:59:59.999Z']
            for (let v of vals) {
                let r = await settle(w.insert({ id: 'a', d: v }, cs))
                assert.strictEqual(msgOf(r.err), want(0, 'd'))
            }
        })

        it('缺主鍵(autoGenPk為false)之錯誤先於日期檢核(既有優先序不變): insert、insertBulk、save', async function() {
            let w2 = wo(getOpt({ cl: 'tdate', autoGenPk: false }))
            for (let [name, fn] of [['insert', (rs) => w2.insert(rs)], ['insertBulk', (rs) => w2.insertBulk(rs)], ['save', (rs) => w2.save(rs)]]) {
                let r = await settle(fn([{ d: new Date(8.64e15) }]))
                assert.ok(r.err !== undefined, name)
                assert.ok(msgOf(r.err).indexOf('autoGenPk is false') >= 0, `${name}: ${msgOf(r.err)}`)
            }
        })

        it('主鍵型別不符之錯誤先於日期檢核(既有優先序不變): 整數主鍵給\'abc\'且日期範圍外, insert、insertBulk、save', async function() {
            let wi = wo(getOpt({ cl: 'tdatei' }))
            await wi.createStorage()
            for (let [name, fn] of [['insert', (rs) => wi.insert(rs)], ['insertBulk', (rs) => wi.insertBulk(rs)], ['save', (rs) => wi.save(rs)]]) {
                let r = await settle(fn([{ id: 'abc', d: new Date(8.64e15) }]))
                assert.ok(r.err !== undefined, name)
                assert.ok(msgOf(r.err).indexOf('type does not match pk column') >= 0, `${name}: ${msgOf(r.err)}`)
            }
        })

        it('整數主鍵model之日期檢核照常: 主鍵合法而日期範圍外則整批reject', async function() {
            let wi = wo(getOpt({ cl: 'tdatei' }))
            await wi.createStorage()
            await wi.delAll()
            let r = await settle(wi.insert([{ id: 1, d: new Date('2001-01-01T00:00:00Z') }, { id: 2, d: new Date(-8.64e15) }]))
            assert.strictEqual(msgOf(r.err), want(1, 'd'))
            assert.deepStrictEqual(await wi.select({}), [])
        })

        // 規格句(R12): 檢查之值即使用之值——具狀態之valueOf第一次回傳合法值、其後回傳範圍外值者, 存入的是檢核時之值(物件值已換成標準值)
        let stateful = (a, b) => {
            let n = 0
            return {
                valueOf() {
                    return n++ === 0 ? a : b
                },
            }
        }

        it('檢查之值即使用之值(DATE, 具狀態valueOf): insert、insertBulk、save(更新既有)皆存入檢核時之值而非範圍外值', async function() {
            await w.insert({ id: 'upd', d: new Date('2000-01-01T00:00:00Z') }, cs)
            let entriesS = [
                ['insert', 'si', (r) => w.insert(r, cs)],
                ['insertBulk', 'sb', (r) => w.insertBulk(r, cs)],
                ['save(更新既有)', 'upd', (r) => w.save(r, cs)],
            ]
            for (let [name, id, fn] of entriesS) {
                let r = await settle(fn([{ id, d: stateful(0, 8.64e15) }]))
                assert.ok(r.err === undefined, `${name}: ${msgOf(r.err)}`)
                let row = await w.selectByPk(id, cs)
                assert.strictEqual(normD(row.d), '1970-01-01T00:00:00.000Z', name)
            }
        })

        it('檢查之值即使用之值(DATEONLY, 陣列元素具狀態toString): 存入檢核時之日期而非範圍外值', async function() {
            let n = 0
            let el = {
                toString() {
                    return n++ === 0 ? '2026' : '10000'
                },
            }
            let r = await settle(w.insert({ id: 'do1', o: [el, 0, 1] }, cs))
            assert.ok(r.err === undefined, msgOf(r.err))
            assert.strictEqual(normO((await w.selectByPk('do1', cs)).o), '2026-01-01')
        })

        it('Sequelize.literal等SQL運算式不被檢核或換值(照常交資料庫求值)', async function() {
            if (label !== 'sqlite') {
                return //運算式文法依方言
            }
            let r = await settle(w.insert({ id: 'lit', d: Sequelize.literal('\'2020-02-02 00:00:00.000 +00:00\'') }, cs))
            assert.ok(r.err === undefined, msgOf(r.err))
            assert.strictEqual(normD((await w.selectByPk('lit', cs)).d), '2020-02-02T00:00:00.000Z')
        })

        if (label === 'sqlite') {
            //README之清理範例: 庫內既有之範圍外日期文字(本版前寫入)可由save改寫為範圍內值或null; 以原生SQL模擬舊資料(修前寫入入口已被擋)
            it('既有資料不遷移: 庫內舊的範圍外日期文字不受影響, 可由save改寫為null與9999年末', async function() {
                let sq = new Sequelize({ dialect: 'sqlite', storage: getOpt().storage, logging: false })
                try {
                    await sq.query('INSERT INTO tdate (id, d) VALUES (?, ?)', { replacements: ['legacy', '275760-09-13 00:00:00.000 +00:00'] })
                }
                finally {
                    await sq.close()
                }
                let row = await w.selectByPk('legacy', cs)
                assert.strictEqual(normD(row.d), '275760-09-13T00:00:00.000Z', '舊資料維持原樣(不遷移)')
                await w.save({ id: 'legacy', d: null }, cs)
                assert.strictEqual((await w.selectByPk('legacy', cs)).d, null)
                await w.save({ id: 'legacy', d: new Date('9999-12-31T23:59:59.999Z') }, cs)
                assert.strictEqual(normD((await w.selectByPk('legacy', cs)).d), '9999-12-31T23:59:59.999Z')
                let r = await settle(w.save({ id: 'legacy', d: new Date(8.64e15) }, cs))
                assert.strictEqual(msgOf(r.err), want(0, 'd'), '以Date再寫範圍外仍被拒')
            })
        }

    })

}

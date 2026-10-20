import assert from 'assert'
import cloneDeep from 'lodash-es/cloneDeep.js'
import wo from '../src/WOrmReladb.mjs'
import cvStrCases from 'wsemi/src/_cvOrmStrCases.mjs'


//本檔為mssql與sqlite共用之字串良構測試套組(CLAUDE_rulebook.md之R13), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//規格句(dspec〈一之三〉9.): ORM字串(主鍵值、寫入資料之字串值與鍵名含巢狀與陣列元素、opt.db/opt.cl/opt.url/opt.storage)不得含孤立代理碼元, 主鍵另不得含NUL(值之NUL不拒);
//處置與既有[無效主鍵]同形: insert/insertBulk寫入前整批reject且不寫任何一筆; save/del該筆ok:0附err而同批其他筆照常; selectByPk回null; 建構時opt不合者throw;
//訊息為固定詞彙且不回顯值; 檢核作用於cloneDeep後之複本且先於isClosed以外之任何讀取、連線、寫入、刪除; 不隨autoGenPk改變
//案例表為wsemi之契約案例表(src/_cvOrmStrCases.mjs, 純資料), 逐案對公開API執行, 使共用函數chkOrmStr、chkOrmData被正確接線而非各寫一份;
//reladb之model固定欄位(users/twf只有id、name), 故需[資料可帶任意欄位名與巢狀結構](need含doc)之接受案略過, 拒收案不需doc(檢核先於欄位過濾)故照跑; 本套件無GridFS, need含gfs者略過
//model為models/twf.js(id STRING主鍵、name TEXT), 專用資料表, 不與其他套組共用


let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)

let settle = (pm) => pm.then((v) => ({ ok: true, v })).catch((err) => ({ err }))

let mk = (id, extra) => ({ id, name: 'n', ...extra })

let apiCases = cvStrCases.cases.filter((v) => v.group !== 'str' && v.group !== 'data')

//assertPartial, actual須含part之每個鍵且深度相等(其餘鍵不論)
let assertPartial = (actual, part, tag) => {
    assert.ok(actual !== null && actual !== undefined, `${tag}: 取回為${actual}`)
    for (let [k, v] of Object.entries(part)) {
        assert.deepStrictEqual(actual[k], v, `${tag}: 欄位[${k}]`)
    }
}

//不給instance(每次呼叫自行初始化與關閉)時只跑代表性子集, 因每次呼叫各自連線
let formsSub = ['HI_END', 'LO_MID', 'NUL_MID', 'EMOJI']


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql'), 供describe標題與方言差異使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineWellformedSuites(label, getOpt) {

    //runCase, 逐案執行(寫法依案例表檔頭[後端套用方式]); S={ w:驗證用物件, cs:驗證用option, call:呼叫用物件, callCs:呼叫用option, base:建構設定 }
    let runCase = async (c, S) => {
        let e = c.expect

        //throw, 建構函數同步throw
        if (e.kind === 'throw') {
            let args = c.args(mk, S.base)
            assert.throws(() => wo(...args), (err) => err instanceof Error && msgOf(err) === e.msg)
            return
        }

        //reset, 每案以全新資料表狀態與預存列開始
        await S.w.delAll({}, S.cs)
        let pre = c.pre(mk)
        if (pre.length > 0) {
            let rp = await S.w.insertBulk(pre, S.cs)
            assert.strictEqual(rp.nInserted, pre.length, '預存列')
        }

        //args, 第二引數為option(所有被測API皆如此), 合併instance
        let args = c.args(mk, S.base)
        args[1] = { ...(args[1] || {}), ...S.callCs }

        //before, 失敗之呼叫不得改動既有列(含不得多出鍵)
        let before = {}
        for (let id of (e.unchanged || [])) {
            before[id] = await S.w.selectByPk(id, S.cs)
        }

        //snap, 呼叫端物件不得被改動(取值一致案之存取器會因取快照而被讀取, 故略過)
        let snap = c.group === 'toctou' ? null : cloneDeep(args[0])

        //call
        let evs = []
        let fnE = (mode, data, err) => evs.push({ t: 'error', mode, err, nData: Array.isArray(data) ? data.length : -1 })
        let fnC = (mode) => evs.push({ t: 'change', mode })
        S.call.on('error', fnE)
        S.call.on('change', fnC)
        let r
        let rej
        try {
            let p = S.call[c.api](...args)
            if (c.afterCall) {
                c.afterCall(args)
            }
            r = await p
        }
        catch (err) {
            rej = err
        }
        finally {
            evs.push({ t: 'settle' })
            S.call.off('error', fnE)
            S.call.off('change', fnC)
        }
        let errs = evs.filter((v) => v.t === 'error')
        let chgs = evs.filter((v) => v.t === 'change')

        if (snap !== null) {
            assert.deepStrictEqual(args[0], snap, '呼叫端物件不變')
        }

        //kind
        if (e.kind === 'free') {
            //資料值與鍵名之NUL不屬共用檢核: 可接受, 亦可因資料庫自身限制拒收, 但訊息不得為共用檢核之詞彙
            let re = new RegExp(e.notMsg)
            if (rej !== undefined) {
                assert.ok(!re.test(msgOf(rej)), `free reject訊息不得為共用檢核詞彙: ${msgOf(rej)}`)
            }
            else if (Array.isArray(r)) {
                for (let x of r) {
                    assert.ok(x.err === undefined || !re.test(String(x.err)), `free 逐筆err不得為共用檢核詞彙: ${x.err}`)
                }
            }
        }
        else if (e.kind === 'rejectAll') {
            assert.ok(rej !== undefined, `應整批reject, 實得 ${JSON.stringify(r)}`)
            assert.strictEqual(msgOf(rej), e.msg)
            assert.deepStrictEqual(errs.map((v) => [v.mode, v.err]), [[c.api, e.msg]], 'error事件恰一次且mode/err一致')
            assert.strictEqual(chgs.length, 0, 'change不發')
            assert.ok(evs.findIndex((v) => v.t === 'error') < evs.findIndex((v) => v.t === 'settle'), 'error事件須於reject之前發出')
        }
        else {
            assert.ok(rej === undefined, `不得reject: ${msgOf(rej)}`)
            if (e.kind === 'null') {
                assert.strictEqual(r, null)
                assert.strictEqual(errs.length, 0)
                assert.strictEqual(chgs.length, 0)
            }
            if (e.kind === 'itemErr') {
                assert.ok(Array.isArray(r), '逐筆結果須為陣列')
                let nIn = Array.isArray(args[0]) ? args[0].length : 1
                assert.strictEqual(r.length, nIn, '回傳與輸入等長')
                r.forEach((x, i) => {
                    if (e.bad.includes(i)) {
                        let msg = e.msgs ? e.msgs[e.bad.indexOf(i)] : e.msg
                        assert.deepStrictEqual([x.ok, x.err], [0, msg], `第${i}筆`)
                        //不合格筆之結果形狀(save: n為1而不寫入, del: n與nDeleted為0)
                        if (c.api === 'save') {
                            assert.deepStrictEqual([x.n, x.nInserted, x.nModified], [1, 0, 0], `第${i}筆之形狀`)
                        }
                        else if (c.api === 'del') {
                            assert.deepStrictEqual([x.n, x.nDeleted], [0, 0], `第${i}筆之形狀`)
                        }
                    }
                    else {
                        assert.strictEqual(x.ok, 1, `第${i}筆應成功: ${JSON.stringify(x)}`)
                    }
                })
                let wants = e.bad.map((i) => (e.msgs ? e.msgs[e.bad.indexOf(i)] : e.msg)).sort()
                assert.deepStrictEqual(errs.map((v) => v.err).sort(), wants, 'error事件為各不合格筆之訊息')
                assert.ok(errs.every((v) => v.mode === c.api), 'error事件之mode')
                assert.ok(errs.every((v) => v.nData === 1), 'error事件之data為該筆(長度1之陣列)')
                assert.strictEqual(chgs.filter((v) => v.mode === c.api).length, 1, '逐筆處置之函數於結果定案後恰發出一次change(沿用既有行為)')
            }
            if (e.kind === 'ok') {
                assert.strictEqual(errs.length, 0)
                if (/^insert/.test(c.api)) {
                    assert.strictEqual(r.ok, 1)
                }
            }
        }

        //ids, 呼叫後資料表內全部id
        if (e.ids) {
            assert.deepStrictEqual((await S.w.select({}, S.cs)).map((v) => v.id).sort(), e.ids, '資料表內id集合')
        }

        //unchanged
        for (let id of (e.unchanged || [])) {
            assert.deepStrictEqual(await S.w.selectByPk(id, S.cs), before[id], `既有列[${id.length}碼元]不變`)
        }

        //result, rows
        if (e.kind === 'ok' && e.result) {
            assertPartial(r, e.result, 'result')
        }
        for (let [id, part] of Object.entries(e.rows || {})) {
            assertPartial(await S.w.selectByPk(id, S.cs), part, `rows[${id.length}碼元]`)
        }
    }

    //defineTable, 案例表逐案(filter為案例篩選, useInst為是否共用instance, optEx為追加之建構設定)
    let defineTable = (title, optEx, filter, useInst) => {
        describe(`${label} 字串良構: ${title}`, function() {
            let S = {}

            before(async function() {
                S.base = getOpt({ cl: 'twf', ...optEx })
                S.w = wo(S.base)
                await S.w.createStorage()
                let ins = await S.w.init()
                S.ins = ins
                S.cs = { instance: ins }
                if (useInst) {
                    S.call = S.w
                    S.callCs = S.cs
                }
                else {
                    S.call = wo(S.base) //不給instance時另用一個物件, 不與驗證用物件混用兩種風格
                    S.callCs = {}
                }
            })

            after(async function() {
                await S.ins.close()
            })

            for (let c of apiCases.filter(filter)) {
                it(`${c.id} ${c.label}`, async function() {
                    if (c.need.includes('gfs')) {
                        return this.skip() //本套件無GridFS
                    }
                    if (c.need.includes('doc')) {
                        return this.skip() //固定欄位之model無法[接受後讀回]巢狀結構與任意鍵名
                    }
                    await runCase(c, S)
                })
            }
        })
    }

    defineTable('案例表逐案(給instance, autoGenPk:true)', {}, () => true, true)
    defineTable('案例表逐案(給instance, autoGenPk:false; 檢核不隨autoGenPk改變)', { autoGenPk: false }, (c) => ['id', 'single', 'val', 'order'].includes(c.group), true)
    defineTable('案例表代表性子集(不給instance, 每次呼叫自行初始化與關閉)', {}, (c) => ['order', 'toctou'].includes(c.group) || (['id', 'single', 'val'].includes(c.group) && formsSub.includes(c.form)), false)


    describe(`${label} 字串良構: 專屬斷言`, function() {

        let w = null
        let ins = null
        let cs = null

        let reset = async () => {
            await w.delAll({}, cs)
        }

        let ids = async () => (await w.select({}, cs)).map((v) => v.id).sort()

        before(async function() {
            w = wo(getOpt({ cl: 'twf' }))
            await w.createStorage()
            ins = await w.init()
            cs = { instance: ins }
        })

        after(async function() {
            await ins.close()
        })

        beforeEach(async function() {
            await reset()
        })


        it('檢核先於連線與model載入: cl指向不存在之model時, 不合格輸入回報invalid、合格輸入回報can not import model(insert/insertBulk)', async function() {
            let wn = wo(getOpt({ cl: 'twf_nomodel' }))
            for (let api of ['insert', 'insertBulk']) {
                let r1 = await settle(wn[api]([mk('a\uD800')]))
                assert.strictEqual(msgOf(r1.err), 'invalid id: string contains lone surrogate at [data[0].id]', api)
                let r2 = await settle(wn[api]([mk('ok', { name: 'x\uD800' })]))
                assert.strictEqual(msgOf(r2.err), 'invalid data: string contains lone surrogate at [data[0].name]', api)
                let r3 = await settle(wn[api]([mk('a\u0000b')]))
                assert.strictEqual(msgOf(r3.err), 'invalid id: string contains NUL at [data[0].id]', api)
                let r4 = await settle(wn[api]([mk('ok')]))
                assert.ok(msgOf(r4.err).indexOf('can not import model') === 0, `${api} 合格輸入應走到model載入: ${msgOf(r4.err)}`)
            }
        })

        it('save/del: 全部不合格者不連線(回逐筆ok:0), 含合格者須連線(cl指向不存在之model時整批reject can not import model)', async function() {
            let wn = wo(getOpt({ cl: 'twf_nomodel' }))
            let r1 = await wn.save([mk('a\uD800'), mk('b\uDC00')])
            assert.deepStrictEqual(r1, [
                { n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'invalid id: string contains lone surrogate at [data[0].id]' },
                { n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'invalid id: string contains lone surrogate at [data[1].id]' },
            ])
            let r2 = await wn.del([mk('a\uD800'), mk('b\u0000')])
            assert.deepStrictEqual(r2.map((v) => [v.n, v.nDeleted, v.ok, v.err]), [
                [0, 0, 0, 'invalid id: string contains lone surrogate at [data[0].id]'],
                [0, 0, 0, 'invalid id: string contains NUL at [data[1].id]'],
            ])
            let r3 = await settle(wn.save([mk('a\uD800'), mk('ok')]))
            assert.ok(msgOf(r3.err).indexOf('can not import model') === 0, msgOf(r3.err))
            let r4 = await settle(wn.del([mk('a\uD800'), mk('ok')]))
            assert.ok(msgOf(r4.err).indexOf('can not import model') === 0, msgOf(r4.err))
        })

        it('selectByPk: 不合格主鍵回null且不連線(cl指向不存在之model時合格主鍵才reject)', async function() {
            let wn = wo(getOpt({ cl: 'twf_nomodel' }))
            for (let v of ['a\uD800', '\uDC00', 'x\uD800y', 'a\u0000b', '\u0000', Object('a\uD800'), Object('a\u0000')]) {
                assert.strictEqual(await wn.selectByPk(v), null)
            }
            let r = await settle(wn.selectByPk('ok'))
            assert.ok(msgOf(r.err).indexOf('can not import model') === 0, msgOf(r.err))
        })

        it('已關閉之instance先於檢核: 七函數中之寫入與讀取皆回報instance is closed, 不回報invalid', async function() {
            let wc = wo(getOpt({ cl: 'twf' }))
            let ic = await wc.init()
            await ic.close()
            let cc = { instance: ic }
            let bad = [mk('a\uD800', { name: 'x\uD800' })]
            for (let [api, args] of [['insert', [bad, cc]], ['insertBulk', [bad, cc]], ['save', [bad, cc]], ['del', [bad, cc]], ['selectByPk', ['a\uD800', cc]]]) {
                let r = await settle(wc[api](...args))
                assert.ok(r.err !== undefined, `${api} 未reject`)
                assert.ok(msgOf(r.err).indexOf('instance is closed') >= 0, `${api}: ${msgOf(r.err)}`)
            }
        })

        it('檢核失敗不關閉呼叫端先前以init()持有之instance(insert/insertBulk/save/del皆然)', async function() {
            let wk = wo(getOpt({ cl: 'twf' }))
            let ik = await wk.init()
            let ck = { instance: ik }
            try {
                for (let api of ['insert', 'insertBulk']) {
                    let r = await settle(wk[api]([mk('a\uD800')])) //不給instance: 預檢失敗於初始化之前
                    assert.strictEqual(msgOf(r.err), 'invalid id: string contains lone surrogate at [data[0].id]')
                    let r2 = await wk[api]([mk(`ok-${api}`)], ck) //先前持有之instance仍可用
                    assert.strictEqual(r2.nInserted, 1)
                }
                let r3 = await wk.save([mk('a\uD800')])
                assert.strictEqual(r3[0].ok, 0)
                let r4 = await wk.save([mk('ok-save')], ck)
                assert.strictEqual(r4[0].ok, 1)
                let r5 = await wk.del([mk('a\uD800')])
                assert.strictEqual(r5[0].ok, 0)
                let r6 = await wk.del([mk('ok-insert')], ck)
                assert.strictEqual(r6[0].nDeleted, 1)
            }
            finally {
                await ik.close()
            }
        })

        it('autoGenPk:true時不合格之主鍵不被自動產生之主鍵取代(整批reject, 資料表不變)', async function() {
            let wa = wo(getOpt({ cl: 'twf', autoGenPk: true }))
            let ia = await wa.init()
            let ca = { instance: ia }
            try {
                let r = await settle(wa.insert([{ id: 'a\uD800', name: 'x' }, { name: 'no pk' }], ca))
                assert.strictEqual(msgOf(r.err), 'invalid id: string contains lone surrogate at [data[0].id]')
                assert.deepStrictEqual(await ids(), [])
                let r2 = await wa.save([{ id: 'a\u0000b', name: 'x' }], ca)
                assert.deepStrictEqual(r2.map((v) => [v.ok, v.err]), [[0, 'invalid id: string contains NUL at [data[0].id]']])
                assert.deepStrictEqual(await ids(), [])
            }
            finally {
                await ia.close()
            }
        })

        it('未給主鍵者仍依autoGenPk自動產生(良構檢核不改變既有行為)', async function() {
            let r = await w.insertBulk([{ name: 'no pk 1' }, { id: 'e1', name: 'e' }], cs)
            assert.strictEqual(r.nInserted, 2)
            let rows = await w.select({}, cs)
            assert.strictEqual(rows.length, 2)
            assert.ok(rows.every((v) => v.id.isWellFormed()))
        })

        it('String包裝物件之主鍵: 良構者取原始值存放、含孤立代理或NUL者拒收', async function() {
            let r = await w.insert([{ id: Object('wrap-ok'), name: 'x' }], cs)
            assert.strictEqual(r.nInserted, 1)
            assert.deepStrictEqual(await ids(), ['wrap-ok'])
            let r1 = await settle(w.insert([{ id: Object('a\uD800'), name: 'x' }], cs))
            assert.strictEqual(msgOf(r1.err), 'invalid id: string contains lone surrogate at [data[0].id]')
            let r2 = await settle(w.insertBulk([{ id: Object('a\u0000'), name: 'x' }], cs))
            assert.strictEqual(msgOf(r2.err), 'invalid id: string contains NUL at [data[0].id]')
            let r3 = await w.del([{ id: Object('a\uD800') }, { id: Object('wrap-ok') }], cs)
            assert.deepStrictEqual(r3.map((v) => v.ok), [0, 1])
            assert.deepStrictEqual(await ids(), [])
        })

        it('檢查之值即使用之值(主鍵): 偽裝成String之物件其valueOf僅被讀取一次, 存入者即被檢核者', async function() {
            let n = 0
            let evil = {
                [Symbol.toStringTag]: 'String',
                valueOf() {
                    n++
                    return n === 1 ? 'evil-ok' : 'evil\uD800'
                },
            }
            let r = await settle(w.insert([{ id: evil, name: 'x' }], cs))
            assert.strictEqual(n, 1, `valueOf被讀取${n}次`)
            assert.ok(r.err === undefined, msgOf(r.err))
            assert.deepStrictEqual(await ids(), ['evil-ok'])
        })

        it('主鍵欄名非id(opt.pk為key): 檢核跟隨opt.pk, 訊息路徑用該欄名(insert、insertBulk、save、del、selectByPk)', async function() {
            let wk = wo(getOpt({ cl: 'twfk', pk: 'key' }))
            await wk.createStorage()
            let ik = await wk.init()
            let ck = { instance: ik }
            let mkk = (key, extra) => ({ key, name: 'n', ...extra })
            try {
                await wk.delAll({}, ck)
                await wk.insert([mkk('k0')], ck)
                for (let api of ['insert', 'insertBulk']) {
                    let r = await settle(wk[api]([mkk('g0'), mkk('a\uD800')], ck))
                    assert.strictEqual(msgOf(r.err), 'invalid id: string contains lone surrogate at [data[1].key]', api)
                    let r2 = await settle(wk[api]([mkk('g1', { name: 'x\uDC00' })], ck))
                    assert.strictEqual(msgOf(r2.err), 'invalid data: string contains lone surrogate at [data[0].name]', api)
                }
                let rs = await wk.save([mkk('s1'), mkk('b\u0000')], ck)
                assert.deepStrictEqual(rs.map((v) => [v.ok, v.err]), [[1, undefined], [0, 'invalid id: string contains NUL at [data[1].key]']])
                let rd = await wk.del([mkk('a\uD800'), mkk('s1')], ck)
                assert.deepStrictEqual(rd.map((v) => [v.ok, v.err]), [[0, 'invalid id: string contains lone surrogate at [data[0].key]'], [1, undefined]])
                assert.strictEqual(await wk.selectByPk('a\uD800', ck), null)
                assert.deepStrictEqual((await wk.select({}, ck)).map((v) => v.key), ['k0'])
            }
            finally {
                await ik.close()
            }
        })

        it('selectByPk: 包裝物件主鍵只求值一次(第一次良構、其後求值回不合格者不影響查詢鍵)', async function() {
            await w.insert([mk('k-1')], cs)
            let n = 0
            let pkObj = {
                [Symbol.toStringTag]: 'String',
                valueOf() {
                    n++
                    return n === 1 ? 'k-1' : 'k\uD800'
                },
            }
            let r = await w.selectByPk(pkObj, cs)
            assert.strictEqual(n, 1, `valueOf被讀取${n}次`)
            assert.strictEqual(r.id, 'k-1')
        })

        it('returnList與交易: 不合格輸入仍整批reject(不回傳逐筆陣列), 呼叫端交易不受影響', async function() {
            let r = await settle(w.insert([mk('a\uD800')], { ...cs, returnList: true }))
            assert.strictEqual(msgOf(r.err), 'invalid id: string contains lone surrogate at [data[0].id]')
            let transaction = await w.genTransaction()
            let ct = { instance: ins, transaction }
            let done = false
            try {
                let r1 = await settle(w.insertBulk([mk('t1'), mk('b\uDC00')], ct))
                assert.strictEqual(msgOf(r1.err), 'invalid id: string contains lone surrogate at [data[1].id]')
                let r2 = await w.insertBulk([mk('t3')], ct)
                assert.deepStrictEqual(r2, { n: 1, nInserted: 1, ok: 1 })
                await transaction.commit()
                done = true
            }
            finally {
                if (!done) {
                    await transaction.rollback().catch(() => {}) //斷言失敗時不留開啟中之交易(sqlite會鎖庫而連累後續案)
                }
            }
            assert.deepStrictEqual(await ids(), ['t3'])
        })

        it('數據於呼叫當下即複製(useStable:true經佇列延後執行與useStable:false皆然): 呼叫後立即改動原數據, 不影響檢核與寫入之值', async function() {
            for (let useStable of [true, false]) {
                let wu = wo(getOpt({ cl: 'twf', useStable }))
                let iu = await wu.init()
                let cu = { instance: iu }
                try {
                    for (let api of ['insert', 'insertBulk', 'save']) {
                        await wu.delAll({}, cu)
                        let docs = [mk(`${api}-1`), mk(`${api}-2`)]
                        let p = wu[api](docs, cu)
                        docs[1].name = 'x\uD800' //呼叫後立即改動(含不合格值)
                        docs[0].id = 'changed'
                        docs.length = 1
                        await p
                        let rows = (await wu.select({}, cu)).sort((a, b) => (a.id < b.id ? -1 : 1))
                        assert.deepStrictEqual(rows, [{ id: `${api}-1`, name: 'n' }, { id: `${api}-2`, name: 'n' }], `${api} useStable:${useStable}`)
                    }
                    await wu.delAll({}, cu)
                    await wu.insert([mk('del-1'), mk('del-2')], cu)
                    let docs = [{ id: 'del-1' }]
                    let p = wu.del(docs, cu)
                    docs[0].id = 'del-2'
                    let rd = await p
                    assert.deepStrictEqual(rd.map((v) => v.nDeleted), [1])
                    assert.deepStrictEqual((await wu.select({}, cu)).map((v) => v.id), ['del-2'], `del useStable:${useStable}`)
                }
                finally {
                    await iu.close()
                }
            }
        })

        it('複製拋錯(getter拋錯)時回傳rejected promise而非同步拋出(useStable:true與false)', async function() {
            for (let useStable of [true, false]) {
                let wu = wo(getOpt({ cl: 'twf', useStable }))
                for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                    let bad = {
                        id: 'g',
                        get name() {
                            throw new Error('boom')
                        },
                    }
                    let p
                    assert.doesNotThrow(() => {
                        p = wu[api](bad)
                    }, `${api} useStable:${useStable}`)
                    let r = await settle(p)
                    assert.strictEqual(msgOf(r.err), 'boom', `${api} useStable:${useStable}`)
                }
            }
        })

        it('save: 字串不合格之筆為逐筆失敗, 該筆之日期範圍外等批次性檢核不另行觸發; 合格筆之日期範圍外仍整批reject(既有行為不變)', async function() {
            let wd = wo(getOpt({ cl: 'tdate' }))
            await wd.createStorage()
            let idate = await wd.init()
            let cd = { instance: idate }
            try {
                await wd.delAll({}, cd)
                let r = await wd.save([
                    { id: 'd1', n: 'a\uD800', d: new Date(8.64e15) }, //字串不合格且日期範圍外
                    { id: 'd2', n: 'ok', d: new Date('2000-01-01T00:00:00Z') },
                ], cd)
                assert.deepStrictEqual(r.map((v) => v.ok), [0, 1])
                assert.strictEqual(r[0].err, 'invalid data: string contains lone surrogate at [data[0].n]')
                let r2 = await settle(wd.save([{ id: 'd3', n: 'a\uD800' }, { id: 'd4', d: new Date(8.64e15) }], cd))
                assert.strictEqual(msgOf(r2.err), 'invalid data: date is not a valid time in years 1-9999 at [data[1].d]')
                assert.deepStrictEqual((await wd.select({}, cd)).map((v) => v.id), ['d2'])
            }
            finally {
                await idate.close()
            }
        })

        it('save/del不合格筆之結果形狀與error事件: save為{n:1,nInserted:0,nModified:0,ok:0,err}, del為{n:0,nDeleted:0,ok:0,err}, 各發一次error事件(mode為函數名, data為該筆)', async function() {
            let evs = []
            let fnE = (mode, data, err) => evs.push([mode, data.length, err])
            w.on('error', fnE)
            try {
                let rs = await w.save([mk('a\uD800'), mk('s1')], cs)
                assert.deepStrictEqual(rs[0], { n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'invalid id: string contains lone surrogate at [data[0].id]' })
                assert.strictEqual(rs[1].ok, 1)
                let rd = await w.del([mk('b\uDC00'), mk('s1')], cs)
                assert.deepStrictEqual(rd[0], { n: 0, nDeleted: 0, ok: 0, err: 'invalid id: string contains lone surrogate at [data[0].id]' })
                assert.strictEqual(rd[1].nDeleted, 1)
            }
            finally {
                w.off('error', fnE)
            }
            assert.deepStrictEqual(evs, [
                ['save', 1, 'invalid id: string contains lone surrogate at [data[0].id]'],
                ['del', 1, 'invalid id: string contains lone surrogate at [data[0].id]'],
            ])
        })

        it('select/delAll之條件含孤立代理或NUL: 維持既有invalid find整批reject(條件側不變), 資料不變', async function() {
            await w.insert([mk('c1'), mk('c2')], cs)
            for (let find of [{ id: 'a\uD800' }, { name: 'x\uDC00' }, { id: { $in: ['c1', 'b\uD800'] } }, { id: 'a\u0000b' }]) {
                for (let api of ['select', 'delAll']) {
                    let r = await settle(w[api](find, cs))
                    assert.ok(msgOf(r.err).indexOf('invalid find: ') === 0, `${api}: ${msgOf(r.err)}`)
                    assert.ok(!msgOf(r.err).includes('\uD800'), '訊息不回顯值')
                }
            }
            assert.deepStrictEqual(await ids(), ['c1', 'c2'])
        })

        it('save重試耗盡(預讀見該列、更新連續3次未命中)之err不回顯主鍵值(以替身model方法構造)', async function() {
            let md = ins.mds.twf
            md.findOne = async () => ({ id: 'tries-secret', name: 'old' })
            md.update = async () => [0]
            try {
                let r = await w.save([{ id: 'tries-secret', name: 'new' }], cs)
                assert.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[0, 'can not save data[0].id in 3 tries']])
            }
            finally {
                delete md.findOne //還原為繼承之靜態方法
                delete md.update
            }
        })

        it('del只檢核主鍵: 資料欄位含孤立代理但主鍵良構者照常刪除', async function() {
            await w.insert([mk('d1')], cs)
            let r = await w.del([{ id: 'd1', name: 'x\uD800' }], cs)
            assert.deepStrictEqual(r.map((v) => [v.n, v.nDeleted, v.ok]), [[1, 1, 1]])
            assert.deepStrictEqual(await ids(), [])
        })

        it('良構之U+FFFD主鍵如常存取, 孤立代理字串不被當成同一鍵(selectByPk不命中、del該筆ok:0而U+FFFD列不被刪)', async function() {
            let r = await w.insert([mk('a\uFFFDb'), mk('g1')], cs)
            assert.strictEqual(r.nInserted, 2)
            assert.strictEqual((await w.selectByPk('a\uFFFDb', cs)).id, 'a\uFFFDb')
            assert.strictEqual(await w.selectByPk('a\uD800b', cs), null)
            let rd = await w.del([mk('a\uD800b'), mk('g1')], cs)
            assert.deepStrictEqual(rd.map((v) => v.ok), [0, 1])
            assert.deepStrictEqual(await ids(), ['a\uFFFDb'])
        })

        it('去回顯: 型別不符與無效主鍵之訊息不含被拒之值(insert、del)', async function() {
            let wi = wo(getOpt({ cl: 'tpkint' }))
            await wi.createStorage()
            let ii = await wi.init()
            let ci = { instance: ii }
            try {
                await wi.delAll({}, ci)
                let r = await settle(wi.insert([{ id: 12.4, name: 'x' }], ci))
                assert.ok(msgOf(r.err).indexOf('type does not match pk column') >= 0, msgOf(r.err))
                assert.strictEqual(msgOf(r.err).indexOf('12.4'), -1, msgOf(r.err))
                let secret = '0123456789012' //整數主鍵欄之非標準整數寫法字串
                let rd = await wi.del([{ id: secret }, { id: NaN }, { id: '' }], ci)
                for (let x of rd) {
                    assert.strictEqual(x.ok, 0)
                    assert.strictEqual(String(x.err).indexOf(secret), -1, x.err)
                }
                assert.deepStrictEqual(rd.map((v) => v.err), [
                    'invalid data[0].id, type does not match pk column',
                    'invalid data[1].id',
                    'invalid data[2].id',
                ])
            }
            finally {
                await ii.close()
            }
        })

        it('既有資料(D8): 庫內已存在之孤立代理主鍵不遷移; 可由select檢出並以他欄條件清除, 孤立主鍵之del被拒', async function() {
            //以sequelize直接寫入(不經本套件之檢核, 模擬舊版寫入的列): mssql之NVARCHAR保真, sqlite以UTF-8存放而改寫為U+FFFD(內容已損, 屬良構)
            let md = ins.mds.twf
            await md.create({ id: 'legacy\uD800', name: 'legacy' })
            let rows = await w.select({}, cs)
            let bads = rows.filter((v) => typeof v.id === 'string' && !v.id.isWellFormed())
            if (label === 'mssql') {
                assert.deepStrictEqual(bads.map((v) => v.id), ['legacy\uD800'], 'README之檢出法應檢出孤立代理主鍵')
                let rd = await w.del([{ id: 'legacy\uD800' }], cs)
                assert.deepStrictEqual(rd.map((v) => [v.ok, v.err]), [[0, 'invalid id: string contains lone surrogate at [data[0].id]']])
                assert.strictEqual((await w.select({}, cs)).length, 1, '孤立主鍵之del被拒, 列仍在')
                let ra = await w.delAll({ name: 'legacy' }, cs) //改以他欄條件清除
                assert.strictEqual(ra.nDeleted, 1)
            }
            else {
                assert.deepStrictEqual(bads, [], 'sqlite不可能存有孤立代理(UTF-8存放時已改寫)')
                assert.deepStrictEqual(rows.map((v) => v.id), ['legacy\uFFFD'], '已被改寫為U+FFFD(良構, 內容已損)')
                let ra = await w.delAll({ name: 'legacy' }, cs)
                assert.strictEqual(ra.nDeleted, 1)
            }
            assert.deepStrictEqual(await ids(), [])
        })

    })

}

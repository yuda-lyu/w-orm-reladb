import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import lowerCases from 'wsemi/src/_lowerFindCases.mjs'


//本檔為mssql與sqlite共用之wsemi契約案例表_lowerFindCases(方言中立條件IR之契約表, 85案)測試套組(CLAUDE_rulebook.md之R15), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//本套件不採IR, 但此表之hits(手寫, 依SQL三值邏輯手推)是SQL族對公開select與delAll之共同期望, 作為日後任何翻譯層變更之守門
//規則: 依表之columns建model(models/tlower.js), seed()6列; 逐案對公開select與delAll驗——
//  非schema案兩函數須皆接受, select命中 = delAll實際刪除之id集合 = hits; hits為[]者恆假;
//  hits為null(字串順序比較依collation而異)只驗兩函數一致; schema為true者(型別化後端可因欄位型別拒收)可reject, 但兩函數須一致reject、資料不變, 未reject時須 = hits


let { seed, semantics } = lowerCases

let ALL = [1, 2, 3, 4, 5, 6]

//案例表規模下限(wsemi 1.9.25為85案)與schema案之上限, 防止案例表被掏空後仍全綠
let nMin = 85

let ids = (rs) => rs.map((v) => v.id).sort((a, b) => a - b)

let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)

//settle, 執行promise並回傳{ok,v}或{err}
let settle = (pm) => pm.then((v) => ({ ok: true, v })).catch((err) => ({ err }))


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql'), 供describe標題使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineLowerCaseSuites(label, getOpt) {

    describe(`${label} lowerFind契約表: 案例逐案對select與delAll`, function() {

        let w = null
        let ins = null
        let cs = null

        //stats, 各案測試時累計, 供最末之防空轉斷言
        let stats = { accepted: 0, acceptedHit: 0, acceptedNull: 0, rejected: 0 }

        let reset = async () => {
            await w.delAll({}, cs)
            let r = await w.insert(seed(), cs)
            assert.strictEqual(r.nInserted, 6)
        }

        before(async function() {
            w = wo(getOpt({ cl: 'tlower' }))
            await w.createStorage()
            ins = await w.init()
            cs = { instance: ins }
        })

        after(async function() {
            await ins.close()
        })

        it(`案例表規模: 至少${nMin}案, 代號不重複, 含hits為[]、非空、null三類與schema案`, function() {
            assert.ok(semantics.length >= nMin, `案數 ${semantics.length}`)
            assert.strictEqual(new Set(semantics.map((c) => c.id)).size, semantics.length)
            assert.ok(semantics.some((c) => Array.isArray(c.hits) && c.hits.length === 0))
            assert.ok(semantics.some((c) => Array.isArray(c.hits) && c.hits.length > 0))
            assert.ok(semantics.some((c) => c.hits === null))
            assert.ok(semantics.some((c) => c.schema === true))
        })

        it('種子: 6列, id 1~6', async function() {
            let sd = seed()
            assert.deepStrictEqual(sd.map((v) => v.id), ALL)
            await reset()
            assert.deepStrictEqual(ids(await w.select({}, cs)), ALL)
        })

        for (let c of semantics) {

            it(`${c.id} (${c.node}): select命中 = delAll刪除 = hits${c.hits === null ? '(null: 只驗兩函數一致)' : ''}${c.schema ? '(schema案可reject)' : ''}`, async function() {
                await reset()
                let rs = await settle(w.select(c.find(), cs))
                if (rs.err !== undefined) {
                    //schema案: 型別化後端可因欄位型別檢核而reject, 此時兩函數須一致reject且資料不變
                    assert.ok(c.schema === true, `非schema案不得reject: ${msgOf(rs.err)}`)
                    assert.strictEqual(msgOf(rs.err).indexOf('invalid find: '), 0, msgOf(rs.err))
                    let before = ids(await w.select({}, cs))
                    let rd = await settle(w.delAll(c.find(), cs))
                    assert.ok(rd.err !== undefined, 'select reject而delAll未reject')
                    assert.strictEqual(msgOf(rd.err), msgOf(rs.err))
                    assert.deepStrictEqual(ids(await w.select({}, cs)), before)
                    stats.rejected += 1
                    return
                }
                let sel = ids(rs.v)
                if (c.hits !== null) {
                    assert.deepStrictEqual(sel, c.hits, 'select之命中')
                }
                let r = await w.delAll(c.find(), cs)
                let left = ids(await w.select({}, cs))
                let gone = ALL.filter((v) => left.indexOf(v) < 0)
                assert.deepStrictEqual(gone, sel, 'delAll之刪除 = select之命中')
                if (c.hits !== null) {
                    assert.deepStrictEqual(gone, c.hits, 'delAll之刪除')
                }
                assert.deepStrictEqual(r, { n: gone.length, nDeleted: gone.length, ok: 1 })
                stats.accepted += 1
                if (c.hits === null) {
                    stats.acceptedNull += 1
                }
                else if (c.hits.length > 0) {
                    stats.acceptedHit += 1
                }
            })

        }

        it('防空轉: 全部非schema案皆被接受(任一正常案全部reject即紅), 且命中非空之案數達標', function() {
            let nSchema = semantics.filter((c) => c.schema === true).length
            let nHit = semantics.filter((c) => Array.isArray(c.hits) && c.hits.length > 0).length
            assert.ok(stats.rejected <= nSchema, `reject ${stats.rejected} 案, 超過schema案數 ${nSchema}`)
            assert.ok(stats.accepted >= semantics.length - nSchema, `接受 ${stats.accepted} 案, 少於 ${semantics.length - nSchema}`)
            assert.ok(stats.acceptedHit >= nHit - nSchema, `命中非空之接受案 ${stats.acceptedHit} 少於 ${nHit - nSchema}`)
            assert.ok(stats.acceptedHit >= 50, `命中非空之接受案 ${stats.acceptedHit} 不足50`)
        })

    })

}

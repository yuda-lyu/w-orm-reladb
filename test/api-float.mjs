import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import cvFind, { toFloating } from '../src/cvFind.mjs'
import { withTz } from './tools/withTz.mjs'
import { TZS, TZS_DST_EAST, OPS, WALL, CONDS, pad, condVal, condWall, wantIdx, tzSelfCheck } from './tools/floatTools.mjs'


//本檔為mssql與sqlite共用之浮動時間測試套組(CLAUDE_rulebook.md之R14), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//模擬w-orm-mdb之queryMemory: 資料表之DATE欄存「牆上時間分量作為UTC瞬間」(數據列經toFloating), 條件走ctx.dateNoTz:'floating'經cvFind取得where, 由model執行findAll/destroy
//(WOrmReladb之getFindCtx不設定dateNoTz, 公開select/delAll不走此路徑; 數據由公開insert寫入, 取得where後由實例之model執行)
//預言機: 牆上時間字串以UTC分量數值比較(Jet語意: 無時區、無夏令), 與主機時區無關
//時區矩陣: 12個時區(含負偏移、半小時與45分偏移、+14、夏令跳過之UTC+時區), 以執行期賦值process.env.TZ切換, 每個時區先自證偏移


let rid = (i) => `r${pad(i)}`

let hostZones = TZS.concat(TZS_DST_EAST)


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql'), 供describe標題使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineFloatSuites(label, getOpt) {

    describe(`${label} 浮動時間: dateNoTz:'floating'與toFloating`, function() {

        let w = null
        let ins = null
        let md = null
        let cs = null

        //load, 清表後以公開insert寫入[id, d]
        let load = async (pairs) => {
            await md.destroy({ where: {} })
            let r = await w.insert(pairs.map(([id, d]) => ({ id, d })), cs)
            assert.strictEqual(r.nInserted, pairs.length)
        }

        //whereOf, 取經cvFind轉譯之where(attrs取實際執行where之model之rawAttributes, 同mdb之queryMemory)
        let whereOf = (find, ex = {}) => cvFind(find, { attrs: md.rawAttributes, pk: 'id', ...ex })

        let idsOf = async (find, ex = {}) => {
            let rs = await md.findAll({ where: whereOf(find, ex), attributes: ['id'], raw: true })
            return rs.map((r) => r.id).sort()
        }

        let allIds = async () => (await md.findAll({ attributes: ['id'], raw: true })).map((r) => r.id).sort()

        let msgOf = (e) => String(e && e.message !== undefined ? e.message : e)

        before(async function() {
            w = wo(getOpt({ cl: 'tfloat' }))
            await w.createStorage()
            ins = await w.init()
            md = ins.mds.tfloat
            cs = { instance: ins }
        })

        after(async function() {
            await ins.close()
        })

        //運算矩陣: 條件18個牆上時間(字串、本地分量建構之Date、其epoch) x 6運算子 = 108組, 數據20列(含哨兵9999、年0100、夏令跳過/重疊之牆上時間、NULL)
        for (let tz of hostZones) {

            it(`${tz}: 108組條件(18個牆上時間 x 6運算子)命中集合 = 牆上時間數值比較之預言機, 無錯誤無誤拒; delAll($lt 今日)不誤刪9999哨兵`, async function() {
                this.timeout(120000)
                await withTz(tz, async () => {
                    tzSelfCheck(tz)
                    //數據列: 牆上時間字串經toFloating(同mdb之資料列轉換; 轉換失敗須整批拒收, 此處所有值皆須可換算)
                    let pairs = WALL.map((x, i) => {
                        let v = x === null ? null : toFloating(x)
                        assert.ok(x === null || v !== null, `數據列無法換算: ${x}`)
                        return [rid(i), v]
                    })
                    await load(pairs)
                    let n = 0
                    let bads = []
                    for (let [wl, kind] of CONDS) {
                        for (let op of OPS) {
                            n += 1
                            let cw = condWall(wl, kind)
                            let want = wantIdx(op, cw).map(rid)
                            let got
                            try {
                                got = await idsOf({ d: { [op]: condVal(wl, kind) } }, { dateNoTz: 'floating' })
                            }
                            catch (e) {
                                got = `REJ:${msgOf(e).slice(0, 80)}`
                            }
                            if (JSON.stringify(got) !== JSON.stringify(want)) {
                                bads.push({ wl, kind, op, got, want })
                            }
                        }
                    }
                    assert.strictEqual(n, 108)
                    assert.deepStrictEqual(bads, [], `${tz}: 錯誤或誤拒 ${bads.length}/108`)

                    //delAll($lt 今日): 三列expired、never(9999-12-31 23:59:59)、future, 只刪expired
                    await load([['e', toFloating('2020-01-01 00:00:00')], ['n', toFloating('9999-12-31 23:59:59')], ['f', toFloating('2099-01-01 00:00:00')]])
                    await md.destroy({ where: whereOf({ d: { $lt: '2026-10-20T00:00:00' } }, { dateNoTz: 'floating' }) })
                    assert.deepStrictEqual(await allIds(), ['f', 'n'], `${tz}: delAll($lt 今日)誤刪哨兵`)

                    //哨兵本身作條件值: 可用, 且只命中never
                    assert.deepStrictEqual(await idsOf({ d: { $gte: '9999-12-31T23:59:59' } }, { dateNoTz: 'floating' }), ['n'])
                    assert.deepStrictEqual(await idsOf({ d: '9999-12-31T23:59:59' }, { dateNoTz: 'floating' }), ['n'])
                    assert.deepStrictEqual(await idsOf({ d: { $gt: '9999-12-31T23:59:58', $lte: '9999-12-31T23:59:59' } }, { dateNoTz: 'floating' }), ['n'])
                    //$gt哨兵無列; $lt哨兵命中其餘兩列
                    assert.deepStrictEqual(await idsOf({ d: { $gt: '9999-12-31T23:59:59' } }, { dateNoTz: 'floating' }), [])
                    assert.deepStrictEqual(await idsOf({ d: { $lt: '9999-12-31T23:59:59' } }, { dateNoTz: 'floating' }), ['f'])
                })
            })

        }

        it('$in/$nin: 浮動值逐元素比對(2個時區)', async function() {
            for (let tz of ['America/Los_Angeles', 'Asia/Taipei']) {
                await withTz(tz, async () => {
                    await load([['a', toFloating('2026-01-01 00:00:00')], ['b', toFloating('2026-06-01 12:00:00')], ['c', toFloating('9999-12-31 23:59:59')], ['z', null]])
                    assert.deepStrictEqual(await idsOf({ d: { $in: ['2026-01-01T00:00:00', '9999-12-31T23:59:59'] } }, { dateNoTz: 'floating' }), ['a', 'c'])
                    assert.deepStrictEqual(await idsOf({ d: { $nin: ['2026-01-01T00:00:00', '9999-12-31T23:59:59'] } }, { dateNoTz: 'floating' }), ['b'])
                    assert.deepStrictEqual(await idsOf({ d: { $in: [] } }, { dateNoTz: 'floating' }), [])
                    assert.deepStrictEqual(await idsOf({ d: null }, { dateNoTz: 'floating' }), ['z'])
                    assert.deepStrictEqual(await idsOf({ d: { $ne: null } }, { dateNoTz: 'floating' }), ['a', 'b', 'c'])
                })
            }
        })

        it('不合法條件於轉譯階段拒收(不送SQL、資料表不變): 帶時區字串之曆法不存在、年0、5位年、亂字串、純日期(外審minimax F7)', async function() {
            for (let tz of ['America/Los_Angeles', 'Asia/Taipei']) {
                await withTz(tz, async () => {
                    await load([['a', toFloating('2026-01-01 00:00:00')], ['b', toFloating('2026-06-01 00:00:00')]])
                    for (let s of ['2026-02-30T00:00:00Z', '2025-02-29T00:00:00+08:00', '2026-04-31T00:00:00-08:00', '0000-06-15T00:00:00Z', '0000-06-15T00:00:00', '10000-01-01T00:00:00Z', '10000-01-01T00:00:00', 'garbage', '2026-01-01']) {
                        let e = null
                        try {
                            await idsOf({ d: { $lt: s } }, { dateNoTz: 'floating' })
                        }
                        catch (err) {
                            e = msgOf(err)
                        }
                        assert.ok(e !== null && e.indexOf('does not match column type [date]') >= 0, `${tz} [${s}] 應拒收: ${e}`)
                    }
                    assert.deepStrictEqual(await allIds(), ['a', 'b'])
                })
            }
        })

        //判別力自證(僅sqlite: 年10000之文字可存入sqlite而mssql不可): 同一矩陣對'local'臂(數據列以sequelize預設new Date(字串)依主機時區入表)於負偏移時區須出現錯誤或誤拒,
        //證明上列矩陣與預言機能偵測此缺陷(現有mdb全套測試於TZ=PST8PDT亦全綠, 對此缺陷零偵測力)
        if (label === 'sqlite') {
            for (let tz of ['America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Etc/GMT+12']) {
                it(`${tz}: 判別力自證——'local'臂(數據列依主機時區入表)出現錯誤或誤拒, 且delAll($lt 今日)誤刪9999哨兵`, async function() {
                    await withTz(tz, async () => {
                        await md.destroy({ where: {} })
                        await md.bulkCreate(WALL.map((x, i) => ({ id: rid(i), d: x }))) //x為字串, sequelize以new Date(字串)依主機時區解析
                        let nBad = 0
                        for (let [wl, kind] of CONDS) {
                            for (let op of OPS) {
                                let want = wantIdx(op, condWall(wl, kind)).map(rid)
                                let got
                                try {
                                    got = await idsOf({ d: { [op]: condVal(wl, kind) } }, { dateNoTz: 'local' })
                                }
                                catch (e) {
                                    got = `REJ`
                                }
                                if (JSON.stringify(got) !== JSON.stringify(want)) {
                                    nBad += 1
                                }
                            }
                        }
                        assert.ok(nBad >= 20, `${tz}: 'local'臂僅 ${nBad}/108 組出錯, 矩陣的判別力不足`)
                        //delAll($lt 今日)
                        await md.destroy({ where: {} })
                        await md.bulkCreate([['e', '2020-01-01 00:00:00'], ['n', '9999-12-31 23:59:59'], ['f', '2099-01-01 00:00:00']].map(([id, d]) => ({ id, d })))
                        await md.destroy({ where: whereOf({ d: { $lt: '2026-10-20T00:00:00' } }, { dateNoTz: 'local' }) })
                        assert.deepStrictEqual(await allIds(), ['f'], `${tz}: 'local'臂應誤刪哨兵n(此為修前缺陷, 'local'不變)`)
                    })
                })
            }
        }

        //契約①: 編碼後之浮動Date(經資料庫讀回之Date)不可再當'floating'條件輸入
        it('契約①: 以toFloating入表之列, 經model讀回之Date再作條件輸入即二次位移(LA: $eq不命中該列、$ne命中; UTC: 恆等)', async function() {
            for (let tz of ['America/Los_Angeles', 'Asia/Taipei', 'UTC']) {
                await withTz(tz, async () => {
                    await load([['a', toFloating('2026-10-20 01:00:00')], ['b', toFloating('2026-10-21 01:00:00')]])
                    let row = (await md.findAll({ where: { id: 'a' } }))[0]
                    let back = row.get('d')
                    assert.ok(back instanceof Date)
                    assert.strictEqual(back.toISOString(), '2026-10-20T01:00:00.000Z', '讀回之Date即浮動瞬間')
                    //原條件(牆上時間字串)命中
                    assert.deepStrictEqual(await idsOf({ d: '2026-10-20T01:00:00' }, { dateNoTz: 'floating' }), ['a'])
                    //讀回之Date當條件
                    let eq = await idsOf({ d: { $eq: back } }, { dateNoTz: 'floating' })
                    let ne = await idsOf({ d: { $ne: back } }, { dateNoTz: 'floating' })
                    if (tz === 'UTC') {
                        assert.deepStrictEqual(eq, ['a'])
                        assert.deepStrictEqual(ne, ['b'])
                    }
                    else {
                        assert.deepStrictEqual(eq, [], `${tz}: 二次位移後不應命中該列`)
                        assert.deepStrictEqual(ne, ['a', 'b'], `${tz}: 二次位移後$ne命中該列(可被delAll刪除)`)
                    }
                })
            }
        })

        //契約②: toFloating回null者呼叫端須整批拒收, 不得以原值或NULL代入
        it('契約②: 參考之呼叫端轉換遇toFloating為null即整批拒收(資料表不變); 以NULL代入則該列被範圍條件漏掉、被IS NULL命中', async function() {
            let encode = (rows) => rows.map((r) => {
                let v = r.d === null || r.d === undefined ? r.d : toFloating(r.d)
                if (v === null) {
                    throw new Error(`invalid wall time at [${r.id}]`)
                }
                return { id: r.id, d: v }
            })
            await load([['k', toFloating('2020-01-01 00:00:00')]])
            let rows = [{ id: 'a', d: '2026-01-01 00:00:00' }, { id: 'b', d: '2026-02-30 00:00:00' }, { id: 'c', d: '2026-03-01 00:00:00' }]
            let r = null
            try {
                encode(rows)
            }
            catch (e) {
                r = msgOf(e)
            }
            assert.strictEqual(r, 'invalid wall time at [b]')
            assert.deepStrictEqual(await allIds(), ['k'], '整批拒收時不得有任何列寫入')

            //反例: 以NULL代入
            let filled = rows.map((x) => ({ id: x.id, d: toFloating(x.d) })) //b為null: 即以NULL代入
            assert.strictEqual(filled[1].d, null)
            let ins2 = await w.insert(filled, cs)
            assert.strictEqual(ins2.nInserted, 3)
            assert.ok((await idsOf({ d: { $lt: '2099-01-01T00:00:00' } }, { dateNoTz: 'floating' })).indexOf('b') < 0, 'NULL列不被範圍條件命中')
            assert.deepStrictEqual(await idsOf({ d: null }, { dateNoTz: 'floating' }), ['b'], 'NULL列被IS NULL命中')
        })

        //契約④: 條件走'floating'與資料側toFloating同進同退
        it('契約④: 同進同退——數據列經toFloating + floating條件得正確結果; 混用(數據列未經toFloating)於LA靜默誤命中', async function() {
            await withTz('America/Los_Angeles', async () => {
                let cond = { d: { $lt: '2026-10-20T04:00:00' } }

                //同進: 牆上01:00 < 04:00 命中, 牆上05:00不命中
                await load([['a', toFloating('2026-10-20 01:00:00')], ['b', toFloating('2026-10-20 05:00:00')]])
                assert.deepStrictEqual(await idsOf(cond, { dateNoTz: 'floating' }), ['a'])

                //混用: 數據列以本地分量建構之Date入表(PDT, UTC-7: 牆上01:00 = 08:00Z), 條件為浮動值(04:00Z)
                await load([['a', new Date(2026, 9, 20, 1, 0, 0)], ['b', new Date(2026, 9, 20, 5, 0, 0)]])
                assert.deepStrictEqual(await idsOf(cond, { dateNoTz: 'floating' }), [], '混用: 牆上01:00之列本應命中而被漏掉(靜默誤命中)')
                //另一方向: 浮動數據列配'local'條件亦錯位(牆上01:00 = 01:00Z, 'local'條件04:00本地 = 11:00Z)
                await load([['a', toFloating('2026-10-20 01:00:00')], ['b', toFloating('2026-10-20 05:00:00')], ['c', toFloating('2026-10-20 15:00:00')]])
                assert.deepStrictEqual(await idsOf(cond, { dateNoTz: 'local' }), ['a', 'b'], '混用: 浮動數據列配local條件, 牆上05:00之列被誤命中')
            })
        })

    })

}

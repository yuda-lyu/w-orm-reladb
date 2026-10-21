import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'


//本檔為mssql與sqlite共用之defaultScope測試套組(CLAUDE_rulebook.md之R16), 由api-sqlite.test.mjs與api-mssql.test.mjs引入
//sequelize預設以Object.assign合併scope.where與傳入where(同名頂層鍵後者覆寫), scope.where為Sequelize.literal或Sequelize.where(非一般物件)時scope直接被丟棄;
//WOrmReladb於Sequelize實例之define層級設定whereMergeStrategy:'and', 令兩者一律以AND結合
//5種defaultScope(純鍵、Op.or、Op.and、Sequelize.literal、Sequelize.where) x 5種find, 對公開select與delAll:
//  select之命中 = delAll實際刪除之主鍵集合 = 手推期望(scope範圍內且符合find之列); delAll實際刪除之主鍵以不套scope之讀取(unscoped)取得, 不以select代替
//Op.and之scope: chkScopeForDelAll維持拒收delAll(R1), select則須套用該scope


let ROWS = [
    { id: '1', g: 'A', name: 'x' },
    { id: '2', g: 'B', name: 'x' },
    { id: '3', g: 'A', name: 'y' },
    { id: '4', g: 'C', name: 'x' },
]

//SCOPES, where為寫入model檔之defaultScope.where原始碼, inScope為scope範圍之手推判定
let SCOPES = [
    { key: 'pk', label: '純鍵', where: '{ g: \'A\' }', inScope: (r) => r.g === 'A', delAllRejects: false },
    { key: 'or', label: 'Op.or', where: '{ [Op.or]: [{ g: \'A\' }, { g: \'C\' }] }', inScope: (r) => r.g === 'A' || r.g === 'C', delAllRejects: false },
    { key: 'and', label: 'Op.and', where: '{ [Op.and]: [{ g: \'A\' }] }', inScope: (r) => r.g === 'A', delAllRejects: true },
    { key: 'lit', label: 'Sequelize.literal', where: 'sequelize.literal(\'g = \\\'A\\\'\')', inScope: (r) => r.g === 'A', delAllRejects: false },
    { key: 'whr', label: 'Sequelize.where', where: 'sequelize.where(sequelize.col(\'g\'), \'A\')', inScope: (r) => r.g === 'A', delAllRejects: false },
    //model自身指定whereMergeStrategy:'overwrite'(蓋過Sequelize實例之define預設): 匯入後仍強制為'and'(外審sol F2)
    { key: 'ovw', label: 'Sequelize.literal + model自身指定whereMergeStrategy overwrite', where: 'sequelize.literal(\'g = \\\'A\\\'\')', modelOpt: ', whereMergeStrategy: \'overwrite\'', inScope: (r) => r.g === 'A', delAllRejects: false },
]

//FINDS, p為find之手推判定
let FINDS = [
    { label: '{g:"B"}(與scope同欄之單葉)', find: () => ({ g: 'B' }), p: (r) => r.g === 'B' },
    { label: '{name:"x"}(他欄單葉)', find: () => ({ name: 'x' }), p: (r) => r.name === 'x' },
    { label: '$or根', find: () => ({ $or: [{ g: 'B' }, { name: 'y' }] }), p: (r) => r.g === 'B' || r.name === 'y' },
    { label: 'and根(多欄)', find: () => ({ name: 'x', g: { $ne: 'Z' } }), p: (r) => r.name === 'x' && r.g !== 'Z' },
    { label: '{}(全部)', find: () => ({}), p: () => true },
]

let ids = (rs) => rs.map((v) => v.id).sort()

let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)

let genModel = (cl, where, modelOpt = '') => {
    return [
        'module.exports = function(sequelize, DataTypes) {',
        '    let Op = require(\'sequelize\').Op',
        `    return sequelize.define('${cl}', {`,
        '        id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },',
        '        g: { type: DataTypes.STRING, allowNull: true },',
        '        name: { type: DataTypes.STRING, allowNull: true },',
        `    }, { tableName: '${cl}', defaultScope: { where: ${where} }${modelOpt} })`,
        '}',
        '',
    ].join('\n')
}


/**
 * 定義共用測試套組
 *
 * @param {String} label 輸入後端名稱字串('sqlite'或'mssql'), 供describe標題與暫存夾使用
 * @param {Function} getOpt 輸入取得建構設定之函數, 於hook內呼叫以取得當下有效之連線資訊
 */
export function defineScopeSuites(label, getOpt) {

    let fd = `./test/_tmp/api-scope-${label}`

    describe(`${label} defaultScope: 6種scope(含model自身指定overwrite) x 5種find, select與delAll不越出scope`, function() {

        before(function() {
            fs.mkdirSync(fd, { recursive: true })
            for (let sc of SCOPES) {
                fs.writeFileSync(path.join(fd, `tsc${sc.key}.js`), genModel(`tsc${sc.key}`, sc.where, sc.modelOpt), 'utf8')
            }
        })

        after(function() {
            fs.rmSync(fd, { recursive: true, force: true })
        })

        for (let sc of SCOPES) {

            describe(`scope ${sc.label}`, function() {

                let cl = `tsc${sc.key}`
                let w = null
                let ins = null
                let cs = null

                //unscoped, 不套scope之全表讀取(取delAll實際刪除之主鍵), 不經select
                let unscoped = async () => {
                    return ids(await ins.mds[cl].unscoped().findAll({ raw: true }))
                }

                before(async function() {
                    w = wo(getOpt({ cl, fdModels: fd }))
                    await w.createStorage()
                    ins = await w.init()
                    cs = { instance: ins }
                })

                after(async function() {
                    await ins.close()
                })

                beforeEach(async function() {
                    await ins.mds[cl].unscoped().destroy({ where: {} })
                    let r = await w.insert(ROWS, cs)
                    assert.strictEqual(r.nInserted, 4)
                    assert.deepStrictEqual(await unscoped(), ['1', '2', '3', '4'])
                })

                it('合併策略: Sequelize實例之define預設與匯入後之model皆為whereMergeStrategy:and(model自身指定overwrite者亦被改為and)', function() {
                    let md = ins.mds[cl]
                    assert.strictEqual(md.sequelize.options.define.whereMergeStrategy, 'and')
                    assert.strictEqual(md.options.whereMergeStrategy, 'and')
                })

                it('前提: select({})僅回scope範圍內之列(scope確實套用)', async function() {
                    let exp = ids(ROWS.filter(sc.inScope))
                    assert.ok(exp.length > 0 && exp.length < ROWS.length, '夾具之scope須同時含範圍內外之列')
                    assert.deepStrictEqual(ids(await w.select({}, cs)), exp)
                })

                for (let f of FINDS) {

                    it(`${f.label}: select命中 = 手推期望(scope AND find)`, async function() {
                        let exp = ids(ROWS.filter((r) => sc.inScope(r) && f.p(r)))
                        assert.deepStrictEqual(ids(await w.select(f.find(), cs)), exp)
                    })

                    if (sc.delAllRejects) {
                        it(`${f.label}: delAll拒收(chkScopeForDelAll維持, 含Op.and之scope.where)且不刪除`, async function() {
                            let r = await w.delAll(f.find(), cs).then(() => null).catch((err) => msgOf(err))
                            assert.ok(r !== null && r.indexOf('defaultScope') >= 0, `未reject: ${r}`)
                            assert.deepStrictEqual(await unscoped(), ['1', '2', '3', '4'])
                        })
                    }
                    else {
                        it(`${f.label}: delAll實際刪除之主鍵集合 = 手推期望, 不越出scope`, async function() {
                            let exp = ids(ROWS.filter((r) => sc.inScope(r) && f.p(r)))
                            let r = await w.delAll(f.find(), cs)
                            let left = await unscoped()
                            let gone = ['1', '2', '3', '4'].filter((v) => left.indexOf(v) < 0)
                            assert.deepStrictEqual(gone, exp, `delAll刪除之主鍵(scope範圍: ${ids(ROWS.filter(sc.inScope))})`)
                            assert.ok(gone.every((v) => sc.inScope(ROWS.find((x) => x.id === v))), 'delAll刪到scope之外')
                            assert.deepStrictEqual(r, { n: exp.length, nDeleted: exp.length, ok: 1 })
                        })
                    }

                }

                it('scope內之主鍵: selectByPk命中、del實際刪除該列(其餘列不動)、save更新該列完整欄位(外審sol F5)', async function() {
                    let inRows = ROWS.filter(sc.inScope)
                    let inId = inRows[0].id
                    let other = ['1', '2', '3', '4'].filter((v) => v !== inId)
                    assert.deepStrictEqual(await w.selectByPk(inId, cs), ROWS.find((r) => r.id === inId))
                    //save: 更新scope內之列
                    let rs = await w.save({ id: inId, g: inRows[0].g, name: 'zz' }, cs)
                    assert.deepStrictEqual(rs, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                    assert.deepStrictEqual(await w.selectByPk(inId, cs), { id: inId, g: inRows[0].g, name: 'zz' })
                    //del: 刪除scope內之列
                    let rd = await w.del({ id: inId }, cs)
                    assert.deepStrictEqual(rd, [{ n: 1, nDeleted: 1, ok: 1 }])
                    assert.deepStrictEqual(await unscoped(), other, 'del只刪該列')
                })

                it('scope外已存在之主鍵: save(預設autoInsert:true)本筆失敗(ok:0, 預讀不見該列而改插入, 撞主鍵重試耗盡), 該列不改動(外審minimax F1; 修前literal/where scope下該列會被更新)', async function() {
                    let outRow = ROWS.find((r) => !sc.inScope(r))
                    let rs = await w.save({ id: outRow.id, g: outRow.g, name: 'zz' }, cs)
                    assert.strictEqual(rs.length, 1)
                    assert.strictEqual(rs[0].ok, 0, `scope外之既有主鍵save應失敗: ${JSON.stringify(rs)}`)
                    assert.strictEqual(rs[0].nModified, 0)
                    assert.strictEqual(rs[0].nInserted, 0)
                    assert.ok(String(rs[0].err).indexOf('can not save') >= 0, String(rs[0].err))
                    let row = (await ins.mds[cl].unscoped().findAll({ where: { id: outRow.id }, raw: true }))[0]
                    assert.strictEqual(row.name, outRow.name, 'scope外之列被改動')
                    assert.deepStrictEqual(await unscoped(), ['1', '2', '3', '4'])
                })

                it('scope外之主鍵: save(autoInsert:false)不改動該列(外審sol F5)', async function() {
                    let outRow = ROWS.find((r) => !sc.inScope(r))
                    let rs = await w.save({ id: outRow.id, g: outRow.g, name: 'zz' }, { ...cs, autoInsert: false })
                    assert.strictEqual(rs[0].nModified, 0, `save更新了scope外之列: ${JSON.stringify(rs)}`)
                    let row = (await ins.mds[cl].unscoped().findAll({ where: { id: outRow.id }, raw: true }))[0]
                    assert.strictEqual(row.name, outRow.name, 'scope外之列被改動')
                })

                it('selectByPk、del亦不越出scope(scope外之主鍵: selectByPk回null、del不刪)', async function() {
                    let outId = ROWS.find((r) => !sc.inScope(r)).id
                    let inId = ROWS.find((r) => sc.inScope(r)).id
                    assert.strictEqual(await w.selectByPk(outId, cs), null)
                    assert.ok((await w.selectByPk(inId, cs)) !== null)
                    let r = await w.del({ id: outId }, cs)
                    assert.deepStrictEqual(r, [{ n: 0, nDeleted: 0, ok: 1 }], 'del刪到scope外之列')
                    assert.deepStrictEqual(await unscoped(), ['1', '2', '3', '4'])
                })

            })

        }

    })

}

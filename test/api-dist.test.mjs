import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { execFile } from 'child_process'
import { createRequire } from 'module'


//rulebook R10: 經package.json之main(dist)使用時, js型model之importModels與各函數須與經src使用時同樣可用
//修正前dist內src/requireModel.js之require(fn)被rollup之commonjs外掛換成必拋[Could not dynamically require]之樁, 而測試只跑src未曾發現
//作法: 以toolg/gDistRollup.mjs原檔之設定只換輸出夾, 由目前src建置至已安裝佈局(app/node_modules/w-orm-reladb/dist), 再由app以套件名require
//僅以sqlite驗證, 因model檔之載入與資料庫種類無關


let fd = './test/_tmp/api-dist'
let fdApp = `${fd}/app`
let fdPkg = `${fdApp}/node_modules/w-orm-reladb`
let fdDist = `${fdPkg}/dist`
let fdModels = `${fd}/models`
let fpBundle = `${fdDist}/w-orm-reladb.umd.js`


//buildDist, 複製gDistRollup.mjs並只把fdTar換成已安裝佈局之dist後, 以子行程於專案根目錄執行(同發布時之cwd, 故babel.config.js與package.json同發布)
let buildDist = () => {
    let c = fs.readFileSync('./toolg/gDistRollup.mjs', 'utf8')
    let from = `let fdTar = './dist'`
    assert.strictEqual(c.split(from).length - 1, 1, `toolg/gDistRollup.mjs須恰有一處[${from}]供替換輸出夾`)
    c = c.replace(from, `let fdTar = '${fdDist}'`)
    let fpGen = `${fd}/gDistRollup.mjs`
    fs.writeFileSync(fpGen, c, 'utf8')
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [fpGen], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`build dist failed: ${err.message}\n${stderr}`))
                return
            }
            resolve(stdout)
        })
    })
}


describe('dist (installed layout)', function() {

    let wo = null

    before(async function() {

        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fdDist, { recursive: true })

        //build
        await buildDist()

        //已安裝佈局: 套件夾內之package.json(main指向dist), 相依(sequelize等)沿上層node_modules解析
        fs.copyFileSync('./package.json', `${fdPkg}/package.json`)

        //models, 複製至暫存夾, 不動版控中之models
        fs.mkdirSync(fdModels, { recursive: true })
        fs.copyFileSync('./models/users.js', `${fdModels}/users.js`)
        fs.copyFileSync('./models/users.json', `${fdModels}/users.json`)

        //require, 由app以套件名解析
        let req = createRequire(path.resolve(fdApp, 'index.js'))
        assert.strictEqual(req.resolve('w-orm-reladb'), path.resolve(fpBundle), '套件名須經package.json之main解析至建出之dist')
        wo = req('w-orm-reladb')

    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('建出之dist不含rollup動態require之樁', function() {
        //rulebook R10: 建置產物不得含[Could not dynamically require](含被打包之相依)
        let code = fs.readFileSync(fpBundle, 'utf8')
        assert.ok(code.length > 0)
        assert.strictEqual(code.indexOf('Could not dynamically require'), -1)
    })

    it('js型model: createStorage、insert、select、selectByPk、del皆成功且不發error事件', async function() {
        //rulebook R10: 預設modelType為js, 經main使用時importModels須可載入js型model
        assert.strictEqual(typeof wo, 'function')
        let w = wo({ url: 'sqlite://:', db: 'worm', cl: 'users', fdModels, storage: `${fd}/js.sqlite` })
        let errs = []
        w.on('error', (mode, data, err) => {
            errs.push([mode, err])
        })

        assert.strictEqual(await w.createStorage(), 'created')
        assert.deepStrictEqual(await w.insert({ id: 'a1', name: 'A', value: 1.5 }), { n: 1, nInserted: 1, ok: 1 })
        assert.deepStrictEqual(await w.select({ id: 'a1' }), [{ id: 'a1', name: 'A', value: 1.5 }])
        assert.deepStrictEqual(await w.selectByPk('a1'), { id: 'a1', name: 'A', value: 1.5 })
        assert.deepStrictEqual(await w.del({ id: 'a1' }), [{ n: 1, nDeleted: 1, ok: 1 }])
        assert.deepStrictEqual(await w.select(), [])
        assert.deepStrictEqual(errs, [])
    })

    it('字串良構(R13): 經dist使用時, 孤立代理之主鍵與資料整批reject、selectByPk回null、建構時opt含孤立代理throw, 良構字串(含emoji)照常', async function() {
        //wsemi之chkOrmStr、chkOrmData隨dist打包(純JS), 須在打包與轉譯後仍判定正確
        let w = wo({ url: 'sqlite://:', db: 'worm', cl: 'users', fdModels, storage: `${fd}/wf.sqlite` })
        let errs = []
        w.on('error', (mode, data, err) => {
            errs.push([mode, err])
        })
        assert.strictEqual(await w.createStorage(), 'created')

        let msgOf = (err) => String(err && err.message !== undefined ? err.message : err)
        let r1 = await w.insert([{ id: 'ok1', name: 'A' }, { id: 'a\uD800', name: 'B' }]).then((v) => ({ v }), (err) => ({ err }))
        assert.strictEqual(msgOf(r1.err), 'invalid id: string contains lone surrogate at [data[1].id]')
        let r2 = await w.insertBulk([{ id: 'ok2', name: 'x\uDC00' }]).then((v) => ({ v }), (err) => ({ err }))
        assert.strictEqual(msgOf(r2.err), 'invalid data: string contains lone surrogate at [data[0].name]')
        let r3 = await w.insert([{ id: 'ok3', name: 'A', meta: { tags: ['a', 'b\uD800'] } }]).then((v) => ({ v }), (err) => ({ err }))
        assert.strictEqual(msgOf(r3.err), 'invalid data: string contains lone surrogate at [data[0].meta.tags[1]]')
        assert.deepStrictEqual(errs.map((v) => v[0]), ['insert', 'insertBulk', 'insert'])
        assert.deepStrictEqual(await w.select(), [], '整批reject不寫入任何一筆')

        let rs = await w.save([{ id: 'a\u0000b', name: 'x' }, { id: 'e😀', name: 'emoji' }])
        assert.deepStrictEqual(rs.map((v) => v.ok), [0, 1])
        assert.strictEqual(rs[0].err, 'invalid id: string contains NUL at [data[0].id]')
        assert.strictEqual(await w.selectByPk('e\uD83D'), null)
        assert.deepStrictEqual(await w.selectByPk('e😀'), { id: 'e😀', name: 'emoji', value: null })

        assert.throws(() => wo({ url: 'sqlite://:', db: 'worm', cl: 'users\uD800', fdModels }), (err) => msgOf(err) === 'invalid opt.cl: string contains lone surrogate')
    })

    it('json型model(對照): createStorage、insert、select皆成功且不發error事件', async function() {
        //rulebook R10: 兩種modelType經main皆須可用; json型不經requireModel, 修正前即可用
        let w = wo({ url: 'sqlite://:', db: 'worm', cl: 'users', fdModels, modelType: 'json', storage: `${fd}/json.sqlite` })
        let errs = []
        w.on('error', (mode, data, err) => {
            errs.push([mode, err])
        })

        assert.strictEqual(await w.createStorage(), 'created')
        assert.deepStrictEqual(await w.insert({ id: 'b1', name: 'B', value: 2 }), { n: 1, nInserted: 1, ok: 1 })
        assert.deepStrictEqual(await w.select({ id: 'b1' }), [{ id: 'b1', name: 'B', value: 2 }])
        assert.deepStrictEqual(errs, [])
    })

})

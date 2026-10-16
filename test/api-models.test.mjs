import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawn } from 'child_process'
import wo from '../src/WOrmReladb.mjs'


//rulebook R9: 各操作不得改寫呼叫端之model檔(規格T9讀取函數不得有副作用); 需補主鍵設定者只補該處、保留行尾並以原子寫入完成
//僅以sqlite驗證, 因model檔之處理與資料庫種類無關


let fd = './test/_tmp/api-models'


//genModel, 含縮排、空行與CRLF之model, 修正前之modifyModel會逐行trim、刪空行並改為LF而改寫
let genModel = (withPk) => {
    return [
        '/* jshint indent: 1 */',
        'module.exports = function(sequelize, DataTypes) {',
        '    return sequelize.define(\'users\', {',
        '        \'id\': {',
        '            type: DataTypes.STRING,',
        '            allowNull: false,',
        withPk ? '            primaryKey: true,' : '            autoIncrement: false,',
        '        },',
        '',
        '        \'name\': {',
        '            type: DataTypes.TEXT,',
        '            allowNull: true',
        '        },',
        '        \'value\': {',
        '            type: DataTypes.FLOAT,',
        '            allowNull: true',
        '        }',
        '    }, {',
        '        tableName: \'users\'',
        '    })',
        '}',
        '',
    ].join('\r\n')
}


let runWorker = (fdModels, storage, n) => {
    return new Promise((resolve) => {
        let p = spawn(process.execPath, ['test/tools/modelsWorker.mjs', fdModels, storage, String(n)], { stdio: ['ignore', 'pipe', 'pipe'] })
        let s = ''
        p.stdout.on('data', (d) => {
            s += d
        })
        p.stderr.on('data', () => {})
        p.on('close', () => {
            let line = s.trim().split('\n').filter((v) => v.startsWith('{')).pop()
            resolve(line ? JSON.parse(line) : { nOk: 0, nErr: -1, raw: s })
        })
    })
}


describe('models file', function() {

    before(function() {
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('已具主鍵設定之model經各函數與createStorage後位元組與mtime不變', async function() {
        let fdm = path.join(fd, 'm1')
        fs.mkdirSync(fdm, { recursive: true })
        let fn = path.join(fdm, 'users.js')
        fs.writeFileSync(fn, genModel(true), 'utf8')
        let b0 = fs.readFileSync(fn)
        let t0 = fs.statSync(fn).mtimeMs
        await new Promise((resolve) => setTimeout(resolve, 30))

        let w = wo({ url: 'sqlite://:', storage: path.join(fd, 'm1.sqlite'), db: 'worm', cl: 'users', fdModels: fdm })
        await w.createStorage()
        await w.select()
        await w.selectByPk('k1')
        await w.insert({ id: 'k1', name: 'a' })
        await w.insertBulk({ id: 'k2', name: 'b' })
        await w.save({ id: 'k1', name: 'c' })
        await w.del({ id: 'k2' })
        await w.delAll({ id: 'k1' })

        assert.ok(fs.readFileSync(fn).equals(b0), 'model檔內容被改寫')
        assert.strictEqual(fs.statSync(fn).mtimeMs, t0, 'model檔被重寫(mtime改變)')
    })

    it('缺主鍵設定之model亦不寫檔, id於記憶體內視為主鍵', async function() {
        //rulebook R9: 主鍵設定於記憶體內補上, 讀取與寫入函數皆不改寫model檔(含第一次讀取)
        let fdm = path.join(fd, 'm2')
        fs.mkdirSync(fdm, { recursive: true })
        let fn = path.join(fdm, 'users.js')
        fs.writeFileSync(fn, genModel(false), 'utf8')
        let b0 = fs.readFileSync(fn)
        let t0 = fs.statSync(fn).mtimeMs
        await new Promise((resolve) => setTimeout(resolve, 30))

        let w = wo({ url: 'sqlite://:', storage: path.join(fd, 'm2.sqlite'), db: 'worm', cl: 'users', fdModels: fdm })
        await w.select().catch(() => {}) //尚未建表之第一次讀取
        await w.createStorage()
        await w.insert({ id: 'k1', name: 'a' })
        let msg = await w.insert({ id: 'k1', name: 'b' })
        assert.deepStrictEqual(msg, { n: 1, nInserted: 0, ok: 1 }, 'id未被視為主鍵')
        assert.deepStrictEqual(await w.selectByPk('k1'), { id: 'k1', name: 'a', value: null })

        assert.ok(fs.readFileSync(fn).equals(b0), 'model檔內容被改寫')
        assert.strictEqual(fs.statSync(fn).mtimeMs, t0, 'model檔被重寫(mtime改變)')
        assert.deepStrictEqual(fs.readdirSync(fdm), ['users.js'])
    })

    it('model之defaultScope帶limit時delAll拒絕且不刪除', async function() {
        //rulebook R1: select依scope之order取前幾筆而sequelize之限量刪除不採order, 兩者對象分歧, 故delAll拒絕
        let fdm = path.join(fd, 'm4')
        fs.mkdirSync(fdm, { recursive: true })
        let fn = path.join(fdm, 'users.js')
        fs.writeFileSync(fn, genModel(true).replace('tableName: \'users\'', 'tableName: \'users\', defaultScope: { order: [[\'id\', \'DESC\']], limit: 1 }'), 'utf8')
        let w = wo({ url: 'sqlite://:', storage: path.join(fd, 'm4.sqlite'), db: 'worm', cl: 'users', fdModels: fdm })
        await w.createStorage()
        await w.insert([{ id: 'a' }, { id: 'b' }])
        let r = await w.delAll({}).then(() => null).catch((err) => String(err.message || err))
        assert.ok(r !== null && r.indexOf('defaultScope') >= 0, `未reject: ${r}`)
        let wAll = wo({ url: 'sqlite://:', storage: path.join(fd, 'm4.sqlite'), db: 'worm', cl: 'users', fdModels: path.join(fd, 'm1') })
        assert.deepStrictEqual((await wAll.select()).map((v) => v.id).sort(), ['a', 'b'])
    })

    it('BIGINT主鍵: 超出安全整數之數值為型別不符, 精確值以標準整數寫法之字串給予', async function() {
        //rulebook R8: 整數類主鍵之數值須為安全整數, 否則已失精度而會命中相鄰主鍵; 超出安全整數之標準整數寫法字串保留為字串(表外細化)
        let fdm = path.join(fd, 'm5')
        fs.mkdirSync(fdm, { recursive: true })
        let fn = path.join(fdm, 'tbig.js')
        fs.writeFileSync(fn, [
            'module.exports = function(sequelize, DataTypes) {',
            '    return sequelize.define(\'tbig\', {',
            '        \'id\': { type: DataTypes.BIGINT, allowNull: false, primaryKey: true },',
            '        \'name\': { type: DataTypes.TEXT, allowNull: true },',
            '    }, { tableName: \'tbig\' })',
            '}',
        ].join('\n'), 'utf8')
        let w = wo({ url: 'sqlite://:', storage: path.join(fd, 'm5.sqlite'), db: 'worm', cl: 'tbig', fdModels: fdm, autoGenPk: false })
        await w.createStorage()
        await w.insert([{ id: '9007199254740992', name: 'even' }, { id: '9007199254740993', name: 'odd' }])
        assert.strictEqual(await w.selectByPk(Number('9007199254740993')), null)
        assert.strictEqual((await w.selectByPk('9007199254740993')).name, 'odd')
        let md = await w.del({ id: Number('9007199254740993') })
        assert.strictEqual(md[0].ok, 0)
        let rd = await w.delAll({ id: Number('9007199254740993') }).then(() => null).catch((err) => String(err.message || err))
        assert.ok(rd !== null && rd.indexOf('does not match column type [int]') >= 0, `delAll未reject: ${rd}`)
        assert.deepStrictEqual((await w.select({ id: { $in: ['9007199254740992', '9007199254740993'] } })).map((v) => v.name).sort(), ['even', 'odd'])
    })

    it('model已有其他主鍵時不得把id補成主鍵(不得成為複合主鍵)', async function() {
        //rulebook R9: 僅於model完全沒有主鍵設定時才補id; 否則(sid, id)成為複合主鍵而使主鍵去重失效
        let fdm = path.join(fd, 'm6')
        fs.mkdirSync(fdm, { recursive: true })
        fs.writeFileSync(path.join(fdm, 'tsid.js'), [
            'module.exports = function(sequelize, DataTypes) {',
            '    return sequelize.define(\'tsid\', {',
            '        \'sid\': { type: DataTypes.STRING, allowNull: false, primaryKey: true },',
            '        \'id\': { type: DataTypes.STRING, allowNull: true },',
            '    }, { tableName: \'tsid\' })',
            '}',
        ].join('\n'), 'utf8')
        let w = wo({ url: 'sqlite://:', storage: path.join(fd, 'm6.sqlite'), db: 'worm', cl: 'tsid', fdModels: fdm, pk: 'sid' })
        await w.createStorage()
        let msg = await w.insert([{ sid: 'a', id: 'x' }, { sid: 'a', id: 'y' }])
        assert.deepStrictEqual(msg, { n: 2, nInserted: 1, ok: 1 }, '主鍵去重失效')
        assert.deepStrictEqual(await w.del({ sid: 'a' }), [{ n: 1, nDeleted: 1, ok: 1 }])
    })

    it('INTEGER主鍵: 收安全整數與標準整數寫法之字串, 其他字串為型別不符', async function() {
        //rulebook R8: 整數類主鍵收安全整數或標準整數寫法之字串(String(Number(s))===s, 轉為數值)
        let fdm = path.join(fd, 'm7')
        fs.mkdirSync(fdm, { recursive: true })
        fs.writeFileSync(path.join(fdm, 'tint.js'), [
            'module.exports = function(sequelize, DataTypes) {',
            '    return sequelize.define(\'tint\', {',
            '        \'id\': { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },',
            '        \'name\': { type: DataTypes.TEXT, allowNull: true },',
            '    }, { tableName: \'tint\' })',
            '}',
        ].join('\n'), 'utf8')
        let w = wo({ url: 'sqlite://:', storage: path.join(fd, 'm7.sqlite'), db: 'worm', cl: 'tint', fdModels: fdm, autoGenPk: false })
        await w.createStorage()
        await w.insert([{ id: 1, name: 'a' }, { id: '2', name: 'b' }])
        assert.strictEqual((await w.selectByPk(1)).name, 'a')
        assert.strictEqual((await w.selectByPk('2')).name, 'b')
        assert.strictEqual(await w.selectByPk('0x1'), null)
        assert.strictEqual(await w.selectByPk(' 1'), null)
        assert.strictEqual((await w.del({ id: 'abc' }))[0].ok, 0)
        let r = await w.save({ id: '0x2', name: 'z' }).then(() => null).catch((err) => String(err.message || err))
        assert.ok(r !== null && r.indexOf('type does not match pk column') >= 0, `save未reject: ${r}`)
        assert.deepStrictEqual((await w.select()).map((v) => v.name).sort(), ['a', 'b'])
    })

    it('4行程併發操作後model檔不變且全部成功', async function() {
        this.timeout(120000)
        let fdm = path.join(fd, 'm3')
        fs.mkdirSync(fdm, { recursive: true })
        let fn = path.join(fdm, 'users.js')
        fs.writeFileSync(fn, genModel(true), 'utf8')
        let b0 = fs.readFileSync(fn)
        let n = 50
        let rs = await Promise.all([0, 1, 2, 3].map((k) => runWorker(fdm, path.join(fd, `m3-${k}.sqlite`), n)))
        for (let r of rs) {
            assert.strictEqual(r.nErr, 0, `子行程失敗: ${JSON.stringify(r)}`)
            assert.strictEqual(r.nOk, n + 1)
        }
        assert.ok(fs.readFileSync(fn).equals(b0), `model檔被改寫, 現為${fs.statSync(fn).size}位元組`)
    })

})

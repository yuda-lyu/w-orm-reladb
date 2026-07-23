import fs from 'fs'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import { genRs, genRsm, sortByName } from './api-fixtures.mjs'


//sqlite使用獨立暫存storage檔測試, 不使用專案根目錄之worm.sqlite


let genOpt = (storage) => {
    return {
        url: 'sqlite://:',
        db: 'worm',
        cl: 'users',
        fdModels: './models',
        storage,
    }
}

let prepStorage = (storage) => {
    fs.mkdirSync('./tmp', { recursive: true })
    if (fs.existsSync(storage)) {
        fs.unlinkSync(storage)
    }
}

let cleanStorage = (storage) => {
    if (fs.existsSync(storage)) {
        fs.unlinkSync(storage)
    }
    try {
        fs.rmdirSync('./tmp') //僅在空資料夾時移除
    }
    catch (err) {}
}


describe('sqlite crud', function() {

    let storage = './tmp/api-sqlite-crud.sqlite'
    let w = wo(genOpt(storage))

    before(async function() {
        prepStorage(storage)
        await w.createStorage()
    })

    after(function() {
        cleanStorage(storage)
    })

    it('insert 3筆, 空id自動產生主鍵', async function() {
        let msg = await w.insert(genRs())
        assert.deepStrictEqual(msg, { n: 3, nInserted: 3, ok: 1 })
    })

    it('save({autoInsert:false}) 修改2筆且不插入空id項', async function() {
        let msg = await w.save(genRsm(), { autoInsert: false })
        assert.deepStrictEqual(msg, [
            { n: 1, nModified: 1, ok: 1 },
            { n: 1, nModified: 1, ok: 1 },
            { n: 0, nModified: 0, ok: 1 },
        ])
    })

    it('select() 查全部得3筆', async function() {
        let ss = sortByName(await w.select())
        assert.strictEqual(ss.length, 3)
        let [kettle, peter, rosemary] = ss
        assert.ok(typeof kettle.id === 'string' && kettle.id.length > 0)
        assert.strictEqual(kettle.name, 'kettle')
        assert.strictEqual(kettle.value, 456)
        assert.deepStrictEqual(peter, { id: 'id-peter', name: 'peter(modify)', value: 123 })
        assert.deepStrictEqual(rosemary, { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 })
    })

    it('select({id}) 依主鍵查詢', async function() {
        let so = await w.select({ id: 'id-rosemary' })
        assert.deepStrictEqual(so, [{ id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }])
    })

    it('select $and+$gt+$lt', async function() {
        let sp = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
        assert.deepStrictEqual(sp, [{ id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }])
    })

    it('select $or+$gte+$lte', async function() {
        let sp = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
        assert.strictEqual(sp.length, 1)
        assert.strictEqual(sp[0].name, 'kettle')
        assert.strictEqual(sp[0].value, 456)
    })

    it('select 巢狀$or+$and+$ne+$in+$nin', async function() {
        let sp = sortByName(await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] }))
        assert.strictEqual(sp.length, 2)
        assert.strictEqual(sp[0].name, 'kettle')
        assert.strictEqual(sp[0].value, 456)
        assert.deepStrictEqual(sp[1], { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 })
    })

    it('select $regex不分大小寫', async function() {
        let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
        assert.deepStrictEqual(sr, [{ id: 'id-peter', name: 'peter(modify)', value: 123 }])
    })

    it('del 刪除2筆並保留kettle', async function() {
        let ss = await w.select()
        let d = ss.filter((v) => v.name !== 'kettle')
        let msg = await w.del(d)
        assert.deepStrictEqual(msg, [
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
        let ss = await w.select()
        assert.deepStrictEqual(ss, [])
    })

})


describe('sqlite transaction commit', function() {

    let storage = './tmp/api-sqlite-commit.sqlite'
    let w = wo(genOpt(storage))
    let instance = null

    before(async function() {
        prepStorage(storage)
        await w.createStorage()
    })

    after(async function() {
        if (instance) {
            await instance.close().catch(() => {})
        }
        cleanStorage(storage)
    })

    it('交易內insert+save+del, commit後數據持久化', async function() {
        instance = await w.init()
        let transaction = await w.genTransaction()
        let connState = { instance, transaction }

        let mi = await w.insert(genRs(), connState)
        assert.deepStrictEqual(mi, { n: 3, nInserted: 3, ok: 1 })

        let msv = await w.save(genRsm(), { ...connState, autoInsert: false })
        assert.deepStrictEqual(msv, [
            { n: 1, nModified: 1, ok: 1 },
            { n: 1, nModified: 1, ok: 1 },
            { n: 0, nModified: 0, ok: 1 },
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


describe('sqlite transaction rollback', function() {

    let storage = './tmp/api-sqlite-rollback.sqlite'
    let w = wo(genOpt(storage))
    let instance = null

    before(async function() {
        prepStorage(storage)
        await w.createStorage()
    })

    after(async function() {
        if (instance) {
            await instance.close().catch(() => {})
        }
        cleanStorage(storage)
    })

    it('交易內insert+save+del, rollback後數據全數還原', async function() {
        instance = await w.init()
        let transaction = await w.genTransaction()
        let connState = { instance, transaction }

        let mi = await w.insert(genRs(), connState)
        assert.deepStrictEqual(mi, { n: 3, nInserted: 3, ok: 1 })

        let msv = await w.save(genRsm(), { ...connState, autoInsert: false })
        assert.deepStrictEqual(msv, [
            { n: 1, nModified: 1, ok: 1 },
            { n: 1, nModified: 1, ok: 1 },
            { n: 0, nModified: 0, ok: 1 },
        ])

        let md = await w.del({ id: 'id-rosemary' }, connState)
        assert.deepStrictEqual(md, [{ n: 1, nDeleted: 1, ok: 1 }])

        //交易內select可查到暫時有效的數據
        let ssIn = sortByName(await w.select(null, connState))
        assert.strictEqual(ssIn.length, 2)
        assert.strictEqual(ssIn[0].name, 'kettle')
        assert.strictEqual(ssIn[1].name, 'peter(modify)')

        await transaction.rollback()
        await instance.close()
        instance = null

        let ssFinal = await w.select()
        assert.deepStrictEqual(ssFinal, [])
    })

})

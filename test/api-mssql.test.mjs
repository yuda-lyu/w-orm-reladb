import assert from 'assert'
import net from 'net'
import { execFile } from 'child_process'
import { promisify } from 'util'
import wo from '../src/WOrmReladb.mjs'
import { genRs, genRsm, sortByName } from './api-fixtures.mjs'


//測試自行創建docker容器供MSSQL服務, 測試結束即銷毀, 故僅需環境已安裝docker


let execFileAsync = promisify(execFile)

let ctName = 'worm-test-mssql'
let ctImage = 'mcr.microsoft.com/mssql/server:2022-latest'
let saPassword = 'Worm#Mssql2026'
let ctPort = null //容器對外埠, 由getFreePort動態取得, 避免與既有MSSQL服務衝突


let delay = (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

//getFreePort, 由系統配發空閒埠
let getFreePort = () => {
    return new Promise((resolve, reject) => {
        let srv = net.createServer()
        srv.on('error', reject)
        srv.listen(0, () => {
            let port = srv.address().port
            srv.close(() => {
                resolve(port)
            })
        })
    })
}

//docker, 以陣列傳參不經shell, 避免路徑與引號轉譯問題
let docker = (args) => {
    return execFileAsync('docker', args)
}

//sqlcmd, 於容器內以sa執行語句, -b令錯誤時回傳非0離開碼
let sqlcmd = (args) => {
    return docker(['exec', ctName, '/opt/mssql-tools18/bin/sqlcmd', '-C', '-S', 'localhost', '-U', 'sa', '-P', saPassword, '-b', ...args])
}

//startContainer, 創建容器並等待服務就緒, 再建置測試用資料庫與帳號
let startContainer = async () => {

    //check docker
    await docker(['version', '--format', '{{.Server.Version}}'])
        .catch(() => {
            throw new Error('需先安裝並啟動docker才能執行mssql測試')
        })

    //清除前次殘留容器
    await docker(['rm', '-f', ctName]).catch(() => {})

    //run
    ctPort = await getFreePort()
    await docker(['run', '-d', '--rm', '--name', ctName, '-e', 'ACCEPT_EULA=Y', '-e', `MSSQL_SA_PASSWORD=${saPassword}`, '-p', `${ctPort}:1433`, ctImage])

    //等待服務就緒, 首次需拉取映像故給予較長時間
    let ready = false
    for (let i = 0; i < 90; i++) {
        let ok = await sqlcmd(['-Q', 'SELECT 1'])
            .then(() => true)
            .catch(() => false)
        if (ok) {
            ready = true
            break
        }
        await delay(2000)
    }
    if (!ready) {
        throw new Error('mssql容器啟動逾時')
    }

    //建置資料庫worm與帳號username/password(db_owner)
    await sqlcmd(['-Q', 'CREATE DATABASE worm;'])
    await sqlcmd(['-Q', `CREATE LOGIN username WITH PASSWORD='password', CHECK_POLICY=OFF, CHECK_EXPIRATION=OFF, DEFAULT_DATABASE=worm;`])
    await sqlcmd(['-d', 'worm', '-Q', 'CREATE USER username FOR LOGIN username; ALTER ROLE db_owner ADD MEMBER username;'])

}

//stopContainer, 銷毀容器
let stopContainer = async () => {
    await docker(['rm', '-f', ctName]).catch(() => {})
}


let genOpt = () => {
    return {
        url: `mssql://username:password@localhost:${ctPort}`,
        db: 'worm',
        cl: 'users',
        fdModels: './models',
    }
}


before(async function() {
    this.timeout(600000) //含拉取映像與服務啟動
    await startContainer()
})

after(async function() {
    this.timeout(120000)
    await stopContainer()
})


describe('mssql crud', function() {

    let w = null

    before(async function() {
        w = wo(genOpt())
        await w.createStorage()
        await w.delAll().catch(() => {})
    })

    it('insert 3筆, 空id自動產生主鍵', async function() {
        let msg = await w.insert(genRs())
        assert.deepStrictEqual(msg, { n: 3, nInserted: 3, ok: 1 })
    })

    it('save({autoInsert:true}) 修改2筆並插入1筆', async function() {
        let msg = await w.save(genRsm(), { autoInsert: true })
        assert.deepStrictEqual(msg, [
            { n: 1, nModified: 1, ok: 1 },
            { n: 1, nModified: 1, ok: 1 },
            { n: 1, nInserted: 1, ok: 1 },
        ])
    })

    it('select() 查全部得4筆', async function() {
        let ss = sortByName(await w.select())
        assert.strictEqual(ss.length, 4)
        let [kettle, kettleM, peter, rosemary] = ss
        assert.ok(typeof kettle.id === 'string' && kettle.id.length > 0)
        assert.strictEqual(kettle.name, 'kettle')
        assert.strictEqual(kettle.value, 456)
        assert.ok(typeof kettleM.id === 'string' && kettleM.id.length > 0)
        assert.strictEqual(kettleM.name, 'kettle(modify)')
        assert.strictEqual(kettleM.value, null)
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
        let ss = await w.select()
        assert.deepStrictEqual(ss, [])
    })

})


describe('mssql transaction commit', function() {

    let w = null
    let instance = null

    before(async function() {
        w = wo(genOpt())
        await w.createStorage()
        await w.delAll().catch(() => {})
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


describe('mssql transaction rollback', function() {

    let w = null
    let instance = null

    before(async function() {
        w = wo(genOpt())
        await w.createStorage()
        await w.delAll().catch(() => {})
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

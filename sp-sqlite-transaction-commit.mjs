import wo from './src/WOrmReladb.mjs'
import fs from 'fs'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`, //username:password
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useSqlcipher時得先刪除, 再通過createStorage重新產生
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function testCommit() {


    //w
    let w = wo(opt)


    //createStorage, create table for mssql
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(err) {
        console.log('error', err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //connState
    let instance = await w.init()
    let transaction = await w.genTransaction()
    let connState = {
        instance, //可由外部初始化共用instance, 可單獨使用不另外給transaction
        transaction, //若外部使用共用之transaction, 亦需使用共用instance
    }
    console.log('init')


    //insert
    await w.insert(rs, connState)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { ...connState, autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //del
    await w.del({ id: 'id-rosemary' }, connState)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //select all
    let ssBeforeCommit = await w.select(null, connState)
    console.log('select all (before commit)', ssBeforeCommit) //此時select可查到暫時有效的數據
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: 'random', name: 'kettle', value: 456 }
    // ]


    // function delay(s) {
    //     return new Promise((resolve, reject) => {
    //         setTimeout(() => {
    //             resolve()
    //         }, 1000 * s)
    //     })
    // }
    // await delay(10)


    //commit
    await transaction.commit()
    console.log('commit')


    //close
    await instance.close()
    console.log('close')


    //select all
    let ssFinal = await w.select()
    console.log('select all (final)', ssFinal)
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: 'random', name: 'kettle', value: 456 }
    // ]


    //check
    let rPeter = ssFinal.filter((v) => {
        return v.name === 'peter(modify)'
    })
    let bPeter = rPeter?.[0]?.value === 123

    let rRosemary = ssFinal.filter((v) => {
        return v.name === 'rosemary(modify)'
    })
    let bRosemary = rRosemary?.[0]?.value === 123.456

    let rKettle = ssFinal.filter((v) => {
        return v.name === 'kettle'
    })
    let bKettle = rKettle?.[0]?.value === 456

    if (bPeter && !bRosemary && bKettle) {
        console.log('commit success')
    }
    else {
        console.log('commit error')
    }


}
testCommit()
// createStorage
// change delAll
// delAll then { n: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before commit) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'random', name: 'kettle', value: 456 }
// ]
// commit
// close
// select all (final) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'random', name: 'kettle', value: 456 }
// ]
// commit success

//node --experimental-modules --es-module-specifier-resolution=node sp-sqlite-transaction-commit.mjs

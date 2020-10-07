import wo from './src/WOrmReladb.mjs'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    //autoGenPK: false,
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

async function testRollback() {


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
    let ssBeforeRollback = await w.select(null, connState)
    console.log('select all (before rollback)', ssBeforeRollback) //此時select可查到暫時有效的數據
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: 'random', name: 'kettle', value: 456 }
    // ]


    //rollback
    await transaction.rollback()
    console.log('rollback')


    //close
    await w.close()
    console.log('close')


    //select all
    let ssFinal = await w.select()
    console.log('select all (final)', ssFinal)
    // => []


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

    if (!bPeter && !bRosemary && !bKettle) {
        console.log('rollback success')
    }
    else {
        console.log('rollback error')
    }


}
testRollback()
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
// select all (before rollback) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'random', name: 'kettle', value: 456 }
// ]
// rollback
// close
// select all (final) []
// rollback success

//node --experimental-modules --es-module-specifier-resolution=node sp-mssql-transaction-rollback.mjs

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
    useSqlcipher: true,
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

async function test() {
    //測試加密sqlite
    //安裝@journeyapps/sqlcipher方式：
    //1.visual studio code得使用系統管理員權限開啟
    //2.開啟專案資料夾, 確定路徑內不能含有中文, 否則python2.7無法接受
    //3.先安裝windows-build-tools並指定安裝vs2015, 使用指令安裝至全域: npm i -g windows-build-tools --vs2015
    //4.若切換或重新安裝nodejs, 因全域環境不同, 記得得要重裝windows-build-tools
    //5.安裝@journeyapps/sqlcipher: npm i @journeyapps/sqlcipher


    //w
    let w = wo(opt)


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


    //createStorage, create table for mssql
    await w.createStorage()
    console.log('createStorage')


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


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)


    //select by $or, $and, $ne, $in, $nin
    let spc = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
    console.log('select by $or, $and, $ne, $in, $nin', spc)


    //select by regex
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)


    //del
    let d = []
    if (ss) {
        d = ss.filter(function(v) {
            return v.name !== 'kettle'
        })
    }
    await w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


}
test()
// createStorage
// change delAll
// delAll then { n: 0, ok: 1 }
// change insert
// insert then { n: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 }
// ]
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $and, $gt, $lt [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $or, $gte, $lte [
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select by $or, $and, $ne, $in, $nin [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   {
//     id: '{random id}',
//     name: 'kettle',
//     value: 456
//   }
// ]
// selectReg [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]

//node --experimental-modules --es-module-specifier-resolution=node sp-sqlite-sqlcipher.mjs

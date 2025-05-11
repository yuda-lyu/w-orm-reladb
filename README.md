# w-orm-reladb
An operator for relational database in nodejs.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-orm-reladb.svg?style=flat)](https://npmjs.org/package/w-orm-reladb) 
[![license](https://img.shields.io/npm/l/w-orm-reladb.svg?style=flat)](https://npmjs.org/package/w-orm-reladb) 
[![npm download](https://img.shields.io/npm/dt/w-orm-reladb.svg)](https://npmjs.org/package/w-orm-reladb) 
[![npm download](https://img.shields.io/npm/dm/w-orm-reladb.svg)](https://npmjs.org/package/w-orm-reladb) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-orm-reladb.svg)](https://www.jsdelivr.com/package/npm/w-orm-reladb)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-orm-reladb/WOrm.html).

## Before Installation
> If you need to use encrypted sqlite, you need to manually install `@journeyapps/sqlcipher`, as follows:
>1. Open visual studio code by system administrator.
>2. Open the project folder, and need to make sure the words of path are `ascii` for Python 2.7.
>3. Install `windows-build-tools` into npm global first, and specify with `vs2015`. Use command to install: `npm i -g windows-build-tools --vs2015`.
>4. Install `@journeyapps/sqlcipher` second, use command to install: `npm i @journeyapps/sqlcipher`.

## Installation
### Using npm(ES6 module):

> **Note:** `@journeyapps/sqlcipher` is not compiled into the *.umd file by default, and it is not tied to the dependents for general use in package.json.

```alias
npm i w-orm-reladb
```

#### Example for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-mssql.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
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
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
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
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// selectReg [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
```

#### Example of commit transaction for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-mssql-transaction-commit.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
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
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


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
    //     { id: '{random id}', name: 'kettle', value: 456 }
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
// delAll then { n: 2, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before commit) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit
// close
// select all (final) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit success
```

#### Example of rollback transaction for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-mssql-transaction-rollback.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
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
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //rollback
    await transaction.rollback()
    console.log('rollback')


    //close
    await instance.close()
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
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before rollback) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// rollback
// close
// select all (final) []
// rollback success
```

#### Example for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
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
    //測試sqlite


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


    //createStorage, create table for sqlite
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
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
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
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// selectReg [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
```

#### Example commit transaction for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite-transaction-commit.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
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


    //createStorage, create table for sqlite
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
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


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
    //     { id: '{random id}', name: 'kettle', value: 456 }
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
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before commit) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit
// close
// select all (final) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit success
```

#### Example rollback transaction for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite-transaction-rollback.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
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

async function testRollback() {


    //w
    let w = wo(opt)


    //createStorage, create table for sqlite
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
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //rollback
    await transaction.rollback()
    console.log('rollback')


    //close
    await instance.close()
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
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before rollback) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// rollback
// close
// select all (final) []
// rollback success
```

#### Example of sqlcipher for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite-encryption.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
    storage: './worm.sqlite',
    useEncryption: true,
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
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


    //createStorage, create table for sqlite
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
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 1, nModified: 1, ok: 1 },
//   { n: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, ok: 1 } //autoInsert=true
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
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// selectReg [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
```

#### Example for genModelsByTabs
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/sp-genModelsByTabs.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPK: false,
}

let fd = opt.fdModels
let tabs = {
    tb1: {
        id: {
            type: 'STRING', //主鍵不能使用TEXT
            pk: true,
        },
        title: 'TEXT',
        price: 'DOUBLE',
        isActive: 'INTEGER',
    },
    tb2: {
        sid: {
            type: 'STRING', //主鍵不能使用TEXT
            pk: true,
        },
        name: 'TEXT',
        size: 'DOUBLE',
        age: 'INTEGER',
    },
    tb3: {
        keyINTEGER: 'INTEGER',
        keyBIGINT: 'BIGINT',
        keyFLOAT: 'FLOAT', //精確度7位
        keyDOUBLE: 'DOUBLE', //精確度15~16位
        keyDECIMAL: 'DECIMAL', //精確度28~29位
        keyDATE: 'DATE',
        keyBOOLEAN: 'BOOLEAN',
        keySTRING: 'STRING',
        keyTEXT: 'TEXT',
    },
}

async function test() {
    //測試使用數據tabs並呼叫genModelsByTabs來產生models


    //w
    let w = wo(opt)


    //genModelsByTabs, 預設產生js格式的設定檔
    w.genModelsByTabs(fd, tabs)


    //genModelsByTabs, 產生json格式的設定檔
    w.genModelsByTabs(fd, tabs, { type: 'json' })


}
test()
// generate file:  ./models/tb1.js
// generate file:  ./models/tb2.js
// generate file:  ./models/tb3.js
// generate file:  ./models/tb1.json
// generate file:  ./models/tb2.json
// generate file:  ./models/tb3.json

// tb1.json
// {
//     table: 'tb1',
//     fields: {
//         id: {
//             type: 'DataTypes.STRING',
//             primaryKey: true,
//             allowNull: false,
//             autoIncrement: false,
//             comment: null,
//         },
//         title: {
//             type: 'DataTypes.TEXT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         price: {
//             type: 'DataTypes.DOUBLE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         isActive: {
//             type: 'DataTypes.INTEGER',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//     },
//     options: {
//         tableName: 'tb1',
//     },
// }

// tb1.js
// module.exports = function(sequelize, DataTypes) {
//     return sequelize.define('tb1', {
//     "id": {
//         "type": DataTypes.STRING,
//         "primaryKey": true,
//         "allowNull": false,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "title": {
//         "type": DataTypes.TEXT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "price": {
//         "type": DataTypes.DOUBLE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "isActive": {
//         "type": DataTypes.INTEGER,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     }
// }, {
//         tableName: 'tb1'
//     });
// };

// tb2.json
// {
//     table: 'tb2',
//     fields: {
//         sid: {
//             type: 'DataTypes.STRING',
//             primaryKey: true,
//             allowNull: false,
//             autoIncrement: false,
//             comment: null,
//         },
//         name: {
//             type: 'DataTypes.TEXT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         size: {
//             type: 'DataTypes.DOUBLE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         age: {
//             type: 'DataTypes.INTEGER',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//     },
//     options: {
//         tableName: 'tb2',
//     },
// }

// tb2.js
// module.exports = function(sequelize, DataTypes) {
//     return sequelize.define('tb2', {
//     "sid": {
//         "type": DataTypes.STRING,
//         "primaryKey": true,
//         "allowNull": false,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "name": {
//         "type": DataTypes.TEXT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "size": {
//         "type": DataTypes.DOUBLE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "age": {
//         "type": DataTypes.INTEGER,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     }
// }, {
//         tableName: 'tb2'
//     });
// };
    
// tb3.json
// {
//     table: 'tb3',
//     fields: {
//         keyINTEGER: {
//             type: 'DataTypes.INTEGER',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyBIGINT: {
//             type: 'DataTypes.BIGINT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyFLOAT: {
//             type: 'DataTypes.FLOAT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyDOUBLE: {
//             type: 'DataTypes.DOUBLE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyDECIMAL: {
//             type: 'DataTypes.DECIMAL',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyDATE: {
//             type: 'DataTypes.DATE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyBOOLEAN: {
//             type: 'DataTypes.BOOLEAN',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keySTRING: {
//             type: 'DataTypes.STRING',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyTEXT: {
//             type: 'DataTypes.TEXT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//     },
//     options: {
//         tableName: 'tb3',
//     },
// }

// tb3.js
// module.exports = function(sequelize, DataTypes) {
//     return sequelize.define('tb3', {
//     "keyINTEGER": {
//         "type": DataTypes.INTEGER,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyBIGINT": {
//         "type": DataTypes.BIGINT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyFLOAT": {
//         "type": DataTypes.FLOAT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyDOUBLE": {
//         "type": DataTypes.DOUBLE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyDECIMAL": {
//         "type": DataTypes.DECIMAL,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyDATE": {
//         "type": DataTypes.DATE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyBOOLEAN": {
//         "type": DataTypes.BOOLEAN,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keySTRING": {
//         "type": DataTypes.STRING,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyTEXT": {
//         "type": DataTypes.TEXT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     }
// }, {
//         tableName: 'tb3'
//     });
// };
```

# w-orm-reladb
An object of operator for relational database in nodejs, like a simple ORM.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-orm-reladb.svg?style=flat)](https://npmjs.org/package/w-orm-reladb) 
[![Build Status](https://travis-ci.org/yuda-lyu/w-orm-reladb.svg?branch=master)](https://travis-ci.org/yuda-lyu/w-orm-reladb) 
[![license](https://img.shields.io/npm/l/w-orm-reladb.svg?style=flat)](https://npmjs.org/package/w-orm-reladb) 
[![gzip file size](http://img.badgesize.io/yuda-lyu/w-orm-reladb/master/dist/w-orm-reladb.umd.js.svg?compression=gzip)](https://github.com/yuda-lyu/w-orm-reladb)
[![npm download](https://img.shields.io/npm/dt/w-orm-reladb.svg)](https://npmjs.org/package/w-orm-reladb) 
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
> **Note:** `w-orm-reladb` depends on `sequelize`, `mssql`, `sqlite3` and `w-auto-sequelize`.

> **Note:** `@journeyapps/sqlcipher` is not compiled into the *.umd file by default, and it is not tied to the dependents for general use in package.json.

```alias
npm i w-orm-reladb
```

#### Example for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/ga.mjs)]
```alias
import wo from 'w-orm-reladb'

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
    // => delAll then { n: {n}, ok: 1 }


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })
    // => insert then { n: 3, ok: 1 }


    //save
    await w.save(rsm, { autoInsert: false, atomic: true })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })
    // => save then [ { n: 1, nModified: 1, ok: 1 },
                      { n: 1, nModified: 1, ok: 1 }, 
                      { n: 0, nModified: 0, ok: 1 }, //autoInsert=false
                      { n: 1, nInserted: 1, ok: 1 }  //autoInsert=true
                    ]


    //select all
    let ss = await w.select()
    console.log('select all', ss)
    // => select all [ { id: 'id-peter', name: 'peter(modify)', value: 123 },
                       { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
                       { id: '{random id}', name: 'kettle', value: 456 }, 
                       { id: '{random id}', name: 'kettle(modify)', value: null } //autoInsert=true
                    ]


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)
    // => select [ { id: '{random id}', name: 'kettle', value: 456 } ]


    //select by $and, $ne, $in, $nin
    let spc = await w.select({ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] })
    console.log('select by $and, $ne, $in, $nin', spc)
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by regex, it's an Operator LIKE, not really a regex.
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)
    // => select [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]


    //del
    let d = []
    if (ss) {
        d = ss.filter(function(v) {
            return v.name === 'kettle'
        })
    }
    await w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })
    // => del then [ { n: 1, nDeleted: 1, ok: 1 } ]


}
test()
```

#### Example for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/gb.mjs)]
```alias
import wo from 'w-orm-reladb'

let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    //autoGenPK: false,
    storage: './worm.sqlite',
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


    //createStorage, create db file for sqlite
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     // dialect: 'mssql', //default
    //     // host: 'localhost', //default
    //     // port: 1433, //default
    //     dialect: 'sqlite',
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    //     storage: opt.storage,
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
    // => delAll then { n: {n}, ok: 1 }


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })
    // => insert then { n: 3, ok: 1 }


    //save
    await w.save(rsm, { autoInsert: false, atomic: true })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })
    // => save then [ { n: 1, nModified: 1, ok: 1 },
                      { n: 1, nModified: 1, ok: 1 }, 
                      { n: 0, nModified: 0, ok: 1 }, //autoInsert=false
                      { n: 1, nInserted: 1, ok: 1 }  //autoInsert=true
                    ]


    //select all
    let ss = await w.select()
    console.log('select all', ss)
    // => select all [ { id: 'id-peter', name: 'peter(modify)', value: 123 },
                       { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
                       { id: '{random id}', name: 'kettle', value: 456 }, 
                       { id: '{random id}', name: 'kettle(modify)', value: null } //autoInsert=true
                    ]


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)
    // => select [ { id: '{random id}', name: 'kettle', value: 456 } ]


    //select by $and, $ne, $in, $nin
    let spc = await w.select({ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] })
    console.log('select by $and, $ne, $in, $nin', spc)
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by regex, it's an Operator LIKE, not really a regex.
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)
    // => select [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]


    //del
    let d = []
    if (ss) {
        d = ss.filter(function(v) {
            return v.name === 'kettle'
        })
    }
    await w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })
    // => del then [ { n: 1, nDeleted: 1, ok: 1 } ]
    

}
test()
```

#### Example for genModelsByTabs
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/gb.mjs)]
```alias
import wo from 'w-orm-reladb'

let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    //autoGenPK: false,
}

let fd = 'models'
let tabs = {
    tb1: {
        id: {
            type: 'STRING',
            pk: true,
        },
        title: 'STRING',
        price: 'DOUBLE',
        isActive: 'INTEGER',
    },
    tb2: {
        sid: {
            type: 'STRING',
            pk: true,
        },
        name: 'STRING',
        size: 'DOUBLE',
        age: 'INTEGER',
    },
}

async function test() {


    //w
    let w = wo(opt)


    //genModelsByTabs
    w.genModelsByTabs(fd, tabs)


}
test()

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

// tb2.js
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
```

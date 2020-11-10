import wo from './src/WOrmReladb.mjs'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users2',
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

//node --experimental-modules --es-module-specifier-resolution=node sp-genModelsByTabs.mjs

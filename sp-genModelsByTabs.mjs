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
}

async function test() {
    //測試使用數據tabs並呼叫genModelsByTabs來產生models


    //w
    let w = wo(opt)


    //genModelsByTabs
    w.genModelsByTabs(fd, tabs)


}
test()
// generate file:  ./models//tb1.json
// generate file:  ./models//tb2.json

//node --experimental-modules --es-module-specifier-resolution=node sp-genModelsByTabs.mjs

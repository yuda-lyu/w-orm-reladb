import wo from './src/WOrmReladb.mjs'


//測試使用數據tabs並呼叫genModelsByTabs來產生models

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

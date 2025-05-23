import wo from './src/WOrmReladb.mjs'


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

async function test() {
    //測試mssql高併發狀況


    //w, 預先創建共用
    let w = wo(opt)


    //createStorage, create db file for sqlite
    await w.createStorage()
    console.log('createStorage')


    //delAll, mssql要先刪除否則會有其他測試資料
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    async function core(name, n) {


        // //w, 若每次使用都創建實例就沒問題
        // let w = wo(opt)


        //save, 奇數時save
        if (n % 2 === 1) {
            let r = [
                {
                    id: `id-${name}-${n}`,
                    name: `${name}(modify)`,
                    value: n,
                },
            ]
            console.log('call save', n)
            w.save(r)
                .then(function(msg) {
                    console.log('save then', n, 'msg=', msg)
                })
                .catch(function(msg) {
                    console.log('save catch', n, 'msg=', msg)
                })

        }


        //select, 偶數時select
        if (n % 2 === 0) {
            console.log('call select', n)
            w.select()
                .then(function(msg) {
                    console.log('select then', n, 'len=', msg.length)
                })
                .catch(function(msg) {
                    console.log('select catch', n, 'msg=', msg)
                })
        }


    }


    let n = 0
    for (let i = 1; i <= 4; i++) {
        n += 1
        core('peter', n).catch((err) => {
            console.log(err)
        })
        // core('mary', n).catch((err) => {
        //     console.log(err)
        // })
        // core('sarah', n).catch((err) => {
        //     console.log(err)
        // })
    }


}
test()
    .catch((err) => {
        console.log(err)
    })
// createStorage
// call save 1
// call select 2
// call save 3
// call select 4
// save then 1 msg= [ { n: 1, nInserted: 1, ok: 1 } ]
// select then 2 len= 1
// save then 3 msg= [ { n: 1, nInserted: 1, ok: 1 } ]
// select then 4 len= 2

//node g-mssql-concurrency.mjs

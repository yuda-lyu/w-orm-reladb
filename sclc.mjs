import wo from './src/WOrmReladb.mjs'


let username = 'username'
let password = 'password'

//sqlite
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    //autoGenPK: false,
    storage: './worm.sqlite',
}
// call save 1
// call select 2
// call save 3
// call select 4
// save then 1 msg= [ { n: 1, nInserted: 1, ok: 1 } ]
// select then 2 len= 1
// save then 3 msg= [ { n: 1, nInserted: 1, ok: 1 } ]
// select then 4 len= 2

// mssql
// let opt = {
//     url: `mssql://${username}:${password}@localhost:1433`,
//     db: 'worm',
//     cl: 'users',
//     fdModels: './models',
//     //autoGenPK: false,
// }
// call save 1
// call select 2
// call save 3
// call select 4
// select then 4 len= 30
// select then 2 len= 30
// save then 3 msg= [ { n: 1, nModified: 1, ok: 1 } ]
// save then 1 msg= [ { n: 1, nModified: 1, ok: 1 } ]

async function test() {


    //w, 預先創建共用, 使用sqlite時, 若沒有通過佇列控管同時只能一種操作, 就會報錯[Error: SQLITE_MISUSE: Database is closed], 此點於mssql不會
    let w = wo(opt)


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
            //w.save(r, { atomic: true })
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

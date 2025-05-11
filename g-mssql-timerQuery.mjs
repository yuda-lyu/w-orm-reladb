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


    //w
    let w = wo(opt)


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(err) {
        console.log('error', err)
    })


    let n = 0
    let t = setInterval(async() => {
        n += 1

        //select all
        console.log('select n', n)
        let ss = await w.select() //使用transaction時資料庫會上鎖，只能供調用的連線操作處理，此時select會暫停，直到transaction進行commit或rollback後才會執行
        console.log('select all', n, ss)

        if (n >= 10) {
            clearInterval(t)
        }
    }, 1000)


}
test()
    .catch((err) => {
        console.log(err)
    })

//node g-mssql-timerQuery.mjs

//api-models.test.mjs之併發子行程: 以同一models資料夾反覆操作, 結束時輸出一行JSON
//用法: node test/tools/modelsWorker.mjs <fdModels> <storage> <次數>
import wo from '../../src/WOrmReladb.mjs'


let fdModels = process.argv[2]
let storage = process.argv[3]
let n = Number(process.argv[4] || 50)


let main = async () => {
    let w = wo({ url: 'sqlite://:', storage, db: 'worm', cl: 'users', fdModels })
    let nOk = 0
    let errs = []
    await w.createStorage()
        .then(() => {
            nOk++
        })
        .catch((err) => {
            errs.push(String(err && err.message ? err.message : err))
        })
    for (let i = 0; i < n; i++) {
        await w.select()
            .then(() => {
                nOk++
            })
            .catch((err) => {
                errs.push(String(err && err.message ? err.message : err))
            })
    }
    console.log(JSON.stringify({ nOk, errs: errs.slice(0, 3), nErr: errs.length }))
}


main()

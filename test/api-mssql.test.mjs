import net from 'net'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { defineSuites } from './api-suite.mjs'


//測試自行創建docker容器供MSSQL服務, 測試結束即銷毀, 故僅需環境已安裝docker


let execFileAsync = promisify(execFile)

let ctName = 'worm-test-mssql'
let ctImage = 'mcr.microsoft.com/mssql/server:2022-latest'
let saPassword = 'Worm#Mssql2026'
let ctPort = null //容器對外埠, 由getFreePort動態取得, 避免與既有MSSQL服務衝突


let delay = (ms) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

//getFreePort, 由系統配發空閒埠
let getFreePort = () => {
    return new Promise((resolve, reject) => {
        let srv = net.createServer()
        srv.on('error', reject)
        srv.listen(0, () => {
            let port = srv.address().port
            srv.close(() => {
                resolve(port)
            })
        })
    })
}

//docker, 以陣列傳參不經shell, 避免路徑與引號轉譯問題
let docker = (args) => {
    return execFileAsync('docker', args)
}

//sqlcmd, 於容器內以sa執行語句, -b令錯誤時回傳非0離開碼
let sqlcmd = (args) => {
    return docker(['exec', ctName, '/opt/mssql-tools18/bin/sqlcmd', '-C', '-S', 'localhost', '-U', 'sa', '-P', saPassword, '-b', ...args])
}

//startContainer, 創建容器並等待服務就緒, 再建置測試用資料庫與帳號
let startContainer = async () => {

    //check docker
    await docker(['version', '--format', '{{.Server.Version}}'])
        .catch(() => {
            throw new Error('需先安裝並啟動docker才能執行mssql測試')
        })

    //清除前次殘留容器
    await docker(['rm', '-f', ctName]).catch(() => {})

    //run
    ctPort = await getFreePort()
    await docker(['run', '-d', '--rm', '--name', ctName, '-e', 'ACCEPT_EULA=Y', '-e', `MSSQL_SA_PASSWORD=${saPassword}`, '-p', `${ctPort}:1433`, ctImage])

    //等待服務就緒, 首次需拉取映像故給予較長時間
    let ready = false
    for (let i = 0; i < 90; i++) {
        let ok = await sqlcmd(['-Q', 'SELECT 1'])
            .then(() => true)
            .catch(() => false)
        if (ok) {
            ready = true
            break
        }
        await delay(2000)
    }
    if (!ready) {
        throw new Error('mssql容器啟動逾時')
    }

    //建置資料庫worm與帳號username/password(db_owner)
    await sqlcmd(['-Q', 'CREATE DATABASE worm;'])
    await sqlcmd(['-Q', `CREATE LOGIN username WITH PASSWORD='password', CHECK_POLICY=OFF, CHECK_EXPIRATION=OFF, DEFAULT_DATABASE=worm;`])
    await sqlcmd(['-d', 'worm', '-Q', 'CREATE USER username FOR LOGIN username; ALTER ROLE db_owner ADD MEMBER username;'])

}

//stopContainer, 銷毀容器
let stopContainer = async () => {
    await docker(['rm', '-f', ctName]).catch(() => {})
}


let getOpt = (ex = {}) => {
    return {
        url: `mssql://username:password@localhost:${ctPort}`,
        db: 'worm',
        cl: 'users',
        fdModels: './models',
        ...ex,
    }
}


before(async function() {
    this.timeout(600000) //含拉取映像與服務啟動
    await startContainer()
})

after(async function() {
    this.timeout(120000)
    await stopContainer()
})


defineSuites('mssql', getOpt)

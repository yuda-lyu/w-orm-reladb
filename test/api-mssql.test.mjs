import net from 'net'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { defineSuites } from './api-suite.mjs'
import { defineWhitelistSuites } from './api-find-whitelist.mjs'
import { defineDateWriteSuites } from './api-date-write.mjs'
import { defineWellformedSuites } from './api-wellformed.mjs'
import { defineLowerCaseSuites } from './api-lower-cases.mjs'
import { defineScopeSuites } from './api-scope.mjs'
import { defineFloatSuites } from './api-float.mjs'


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

    //清除前次殘留容器(-v連其匿名volume一併移除)
    await docker(['rm', '-f', '-v', ctName]).catch(() => {})

    //run, getFreePort取得埠到docker綁定之間可能被同機其他程序佔用(綁定失敗), 故換埠重試
    for (let i = 0; ; i++) {
        ctPort = await getFreePort()
        try {
            await docker(['run', '-d', '--rm', '--name', ctName, '-e', 'ACCEPT_EULA=Y', '-e', `MSSQL_SA_PASSWORD=${saPassword}`, '-p', `${ctPort}:1433`, ctImage])
            break
        }
        catch (err) {
            if (i >= 4 || String(err.message).indexOf('bind') < 0) {
                throw err
            }
            await docker(['rm', '-f', '-v', ctName]).catch(() => {})
        }
    }

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

//stopContainer, 銷毀容器: 強制移除須帶-v, 否則映像宣告之VOLUME會成為懸置之匿名volume(逐次累積而佔滿磁碟); 移除後回驗容器與其volume皆已不存在
let stopContainer = async () => {

    //vols, 先記下容器掛載之volume名稱(移除後即無從查詢)
    let vols = await docker(['inspect', '-f', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}', ctName])
        .then((r) => String(r.stdout).trim().split(/\s+/).filter((v) => v !== ''))
        .catch(() => [])

    await docker(['rm', '-f', '-v', ctName]).catch(() => {})

    //回驗: 容器已不存在
    let left = await docker(['ps', '-a', '-q', '--filter', `name=^${ctName}$`]).then((r) => String(r.stdout).trim())
    if (left !== '') {
        throw new Error(`mssql容器[${ctName}]移除後仍存在`)
    }

    //回驗: 其volume已隨容器移除
    for (let v of vols) {
        let still = await docker(['volume', 'inspect', v]).then(() => true, () => false)
        if (still) {
            throw new Error(`mssql容器[${ctName}]之volume[${v}]未隨容器移除`)
        }
    }

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
defineWhitelistSuites('mssql', getOpt)
defineDateWriteSuites('mssql', getOpt)
defineWellformedSuites('mssql', getOpt)
defineLowerCaseSuites('mssql', getOpt)
defineScopeSuites('mssql', getOpt)
defineFloatSuites('mssql', getOpt)

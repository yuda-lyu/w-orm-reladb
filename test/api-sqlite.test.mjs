import fs from 'fs'
import { defineSuites } from './api-suite.mjs'
import { defineWhitelistSuites } from './api-find-whitelist.mjs'
import { defineDateWriteSuites } from './api-date-write.mjs'
import { defineWellformedSuites } from './api-wellformed.mjs'
import { defineLowerCaseSuites } from './api-lower-cases.mjs'
import { defineScopeSuites } from './api-scope.mjs'
import { defineFloatSuites } from './api-float.mjs'


//sqlite使用獨立暫存storage檔測試, 不使用專案根目錄之worm.sqlite


let storage = './tmp/api-sqlite.sqlite'


let getOpt = (ex = {}) => {
    return {
        url: 'sqlite://:',
        db: 'worm',
        cl: 'users',
        fdModels: './models',
        storage,
        ...ex,
    }
}


before(function() {
    fs.mkdirSync('./tmp', { recursive: true })
    if (fs.existsSync(storage)) {
        fs.unlinkSync(storage)
    }
})


after(function() {
    if (fs.existsSync(storage)) {
        fs.unlinkSync(storage)
    }
    try {
        fs.rmdirSync('./tmp') //僅在空資料夾時移除
    }
    catch (err) {}
})


defineSuites('sqlite', getOpt)
defineWhitelistSuites('sqlite', getOpt)
defineDateWriteSuites('sqlite', getOpt)
defineWellformedSuites('sqlite', getOpt)
defineLowerCaseSuites('sqlite', getOpt)
defineScopeSuites('sqlite', getOpt)
defineFloatSuites('sqlite', getOpt)

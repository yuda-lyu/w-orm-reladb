import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
import Sequelize from 'sequelize'
import dropUnopenedConn from '../src/dropUnopenedConn.mjs'


//rulebook R19(第 210 項): sqlite 之 storage 無法開啟時, sequelize 把開啟失敗之 Database 留在 connectionManager.connections, 其 close() 永不回呼而使 sequelize.close() 永不 settle;
//本套件於 closeSequelize 對 sqlite 先以 dropUnopenedConn 移除「open 嚴格為 false」之 Database
//  R19-5 dropUnopenedConn: 只移除 open 嚴格為 false 者; open 為 true、缺該屬性、為 null 者不動; 讀 open 拋錯者不動; sequelize 無連線表時不處理、不拋錯; 回傳移除個數
//  R19-6 依賴盤點: sequelize 主版本為 6; sqlite3 之 Database 有 open 存取器(getter); sequelize 之 sqlite connection-manager 於開啟前即把 Database 存入 connections、其 close 對 connections 內每個 Database 呼叫 close(callback)
//  R19-7 真實 sequelize(不經 WOrmReladb): 開啟失敗後連線表內之 Database.open 為 false, dropUnopenedConn 移除後 close() settle; 正常連線 open 為 true 不被移除且 close() settle
//註: R19-6 為升級哨(升級 sequelize 或 sqlite3 時, 假設不再成立即紅, 須重新評估 dropUnopenedConn 之必要與判準); 行為之端到端驗證見 api-sqlite-open


let require = createRequire(import.meta.url)
let dirSeq = path.dirname(require.resolve('sequelize/package.json'))
let verSeq = JSON.parse(fs.readFileSync(path.join(dirSeq, 'package.json'), 'utf8')).version

let dir = './test/_tmp/unit-sqlite-open'

let BACKSTOP_MS = 20000 //防懸置上限(真實計時器; 只防懸置, 不表達規格)


//settles, 等 promise settle(resolve 或 reject 皆算); 逾防懸置上限則視為懸置
function settles(pm) {
    let timer
    let tm = new Promise((resolve) => {
        timer = setTimeout(() => resolve('pending'), BACKSTOP_MS)
    })
    let p = pm.then(() => 'settled', () => 'settled')
    return Promise.race([p, tm]).finally(() => clearTimeout(timer))
}


describe('sqlite-open(unit)', function() {

    before(function() {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.mkdirSync(`${dir}/adir`, { recursive: true })
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅在空資料夾時移除
        }
        catch (err) {}
    })


    describe('R19-5 dropUnopenedConn', function() {

        let mk = (cs) => ({ connectionManager: { connections: cs } })

        it('只移除 open 嚴格為 false 者並回傳個數; open 為 true 者保留', function() {
            let a = { open: false }
            let b = { open: true }
            let c = { open: false }
            let cs = { a, b, c }
            let n = dropUnopenedConn(mk(cs))
            assert.strictEqual(n, 2)
            assert.deepStrictEqual(Object.keys(cs), ['b'])
            assert.strictEqual(cs.b, b)
        })

        it('缺 open 屬性(undefined)、open 為 0、null、空字串、字串 false 者皆不動(嚴格為 false 才移除)', function() {
            let cs = { a: {}, b: { open: 0 }, c: { open: null }, d: { open: '' }, e: { open: 'false' }, f: { open: undefined } }
            let n = dropUnopenedConn(mk(cs))
            assert.strictEqual(n, 0)
            assert.deepStrictEqual(Object.keys(cs), ['a', 'b', 'c', 'd', 'e', 'f'])
        })

        it('連線表內之 null、undefined、原始值項目不動且不拋錯', function() {
            let cs = { a: null, b: undefined, c: 0, d: 'x', e: { open: false } }
            let n = dropUnopenedConn(mk(cs))
            assert.strictEqual(n, 1)
            assert.deepStrictEqual(Object.keys(cs), ['a', 'b', 'c', 'd'])
        })

        it('讀 open 拋錯者不動、不拋錯, 其餘照常處理', function() {
            let bad = {}
            Object.defineProperty(bad, 'open', {
                get() {
                    throw new Error('getter boom')
                },
            })
            let cs = { bad, x: { open: false } }
            let n = dropUnopenedConn(mk(cs))
            assert.strictEqual(n, 1)
            assert.deepStrictEqual(Object.keys(cs), ['bad'])
        })

        it('空連線表回傳 0', function() {
            assert.strictEqual(dropUnopenedConn(mk({})), 0)
        })

        it('sequelize 無連線表(無 connectionManager、connections 為 null、非物件、sequelize 為 null 或 undefined)回傳 0 且不拋錯', function() {
            for (let sq of [{}, { connectionManager: null }, { connectionManager: {} }, { connectionManager: { connections: null } }, { connectionManager: { connections: 'x' } }, { connectionManager: { connections: 1 } }, null, undefined]) {
                assert.strictEqual(dropUnopenedConn(sq), 0, JSON.stringify(sq))
            }
        })

    })


    describe('R19-6 依賴盤點(升級哨)', function() {

        it('sequelize 主版本為 6(本修正之適用範圍; 升級至其他主版本須重新評估並跑 api-sqlite-open)', function() {
            assert.ok(/^6\./.test(verSeq), `sequelize ${verSeq}`)
        })

        it('sqlite3 之 Database.prototype 有 open 存取器(getter)', function() {
            let sqlite3 = require('sqlite3')
            let d = Object.getOwnPropertyDescriptor(sqlite3.Database.prototype, 'open')
            assert.ok(d && typeof d.get === 'function', 'sqlite3 之 Database 無 open 存取器: dropUnopenedConn 之判準失效')
        })

        it('sequelize 之 sqlite connection-manager 於開啟前即把 Database 存入 connections, 且 close 對 connections 內每個 Database 呼叫 close(callback)', function() {
            let src = fs.readFileSync(path.join(dirSeq, 'lib', 'dialects', 'sqlite', 'connection-manager.js'), 'utf8')
            assert.ok(/this\.connections\[[^\]]*\]\s*=\s*new this\.lib\.Database\(/.test(src), '開啟前存入 connections 之寫法已變')
            assert.ok(/Object\.getOwnPropertyNames\(this\.connections\)\.map\([\s\S]{0,120}\.close\(callback\)/.test(src), 'close 對 connections 逐一 close(callback)之寫法已變')
        })

    })


    describe('R19-7 真實 sequelize', function() {

        it('storage 為資料夾: 查詢 reject(SQLITE_CANTOPEN)後連線表內 Database.open 為 false; dropUnopenedConn 移除後 close() settle', async function() {
            let sq = new Sequelize('worm', '', '', { dialect: 'sqlite', storage: path.resolve(`${dir}/adir`), logging: false })
            let err = null
            try {
                await sq.query('select 1')
            }
            catch (e) {
                err = e
            }
            assert.ok(err, '查詢應 reject')
            assert.ok(String(err.message).indexOf('SQLITE_CANTOPEN') >= 0, String(err.message))
            let cs = sq.connectionManager.connections
            let ks = Object.keys(cs)
            assert.strictEqual(ks.length, 1, `連線表內應有開啟失敗之 Database: ${ks}`)
            assert.strictEqual(cs[ks[0]].open, false)
            assert.strictEqual(dropUnopenedConn(sq), 1)
            assert.deepStrictEqual(Object.keys(cs), [])
            assert.strictEqual(await settles(sq.close()), 'settled', 'close() 懸置')
        })

        it('正常 storage: 連線 open 為 true 不被移除, close() settle 並關閉之', async function() {
            let sq = new Sequelize('worm', '', '', { dialect: 'sqlite', storage: path.resolve(`${dir}/ok.sqlite`), logging: false })
            await sq.query('select 1')
            let cs = sq.connectionManager.connections
            let ks = Object.keys(cs)
            assert.strictEqual(ks.length, 1)
            let db = cs[ks[0]]
            assert.strictEqual(db.open, true)
            assert.strictEqual(dropUnopenedConn(sq), 0)
            assert.strictEqual(cs[ks[0]], db, '正常連線不得被移除')
            assert.strictEqual(await settles(sq.close()), 'settled', 'close() 懸置')
            assert.strictEqual(db.open, false, 'close() 後連線應已關閉')
        })

    })

})

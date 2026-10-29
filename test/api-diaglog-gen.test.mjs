import fs from 'fs'
import path from 'path'
import assert from 'assert'
import Sequelize from 'sequelize'
import WAutoSequelize from 'w-auto-sequelize/src/WAutoSequelize.mjs'
import wo from '../src/WOrmReladb.mjs'
import captureConsole from './tools/captureConsole.mjs'


//rulebook R17-7: genModelsByDB(w-auto-sequelize >= 1.0.52)之診斷輸出經本套件單一出口(wsemi之getDiag), 僅以sqlite驗證(不動docker容器); 本檔為接線測試
//  errType為sequelize之name(如SequelizeConnectionError, 宣告於本套件與w-auto-sequelize之types)
//  R17-7a 預設承接建構時之opt.logging、opt.logDetail、opt.funLog; 單次呼叫之option(型別正確者)覆寫
//  R17-7b 預設無輸出; logging:true只輸出 genModelsByDB sql { stmt }(不含SQL全文、表名)
//  R17-7c funLog收到(label, safe, detail), label加前綴genModelsByDB; 憑證(含opt.url)以***遮罩
//  R17-7d 兩個錯誤標籤(foreign keys catch、tables catch)維持stderr(舊版為console.error), sql走stdout
//  R17-7e logDetail輸出(label, 遮罩後細節)(舊版之裸輸出bare已移除), 憑證仍遮罩
//  R-DIAG genModelsByDB以diag.with併入單次呼叫之帳密與sqlite檔案路徑; w-auto-sequelize之reject原樣交出(其固定詞彙不被本套件之遮罩切碎)
//  R17-7f 回傳契約不變(resolve值與models檔), 建表/外鍵失敗仍只記錄不reject


let dir = './test/_tmp/api-diaglog-gen'
let storage = `${dir}/gen.sqlite`
let dirModels = `${dir}/models`
let dirDirect = `${dir}/models-direct`

//建構時之憑證(在opt.url內), 單次呼叫另給不同之憑證
let PW = 'S3cretPw'
let USER = 'tuser'
let URL_ = `sqlite://${USER}:${PW}@:`
let CALL_PW = 'CallPw9'
let CALL_USER = 'calluser'
let ERRTXT = 'driver boom'


let getOpt = (ex = {}) => {
    return {
        url: URL_,
        db: 'worm',
        cl: 'users',
        fdModels: dirModels,
        storage,
        ...ex,
    }
}


let getCall = (ex = {}) => {
    return {
        dialect: 'sqlite',
        storage,
        username: CALL_USER,
        password: CALL_PW,
        ...ex,
    }
}


//genByDB, 以指定之建構設定與單次呼叫設定執行genModelsByDB並擷取console
let genByDB = (ctor = {}, call = {}) => captureConsole(() => wo(getOpt(ctor)).genModelsByDB(getCall(call)))


let noCred = (text, msg = '') => {
    for (let s of [PW, USER, `${USER}:${PW}`, URL_, CALL_PW, CALL_USER, `${CALL_USER}:${CALL_PW}`]) {
        assert.ok(text.indexOf(s) < 0, `${msg}輸出含連線憑證[${s}]: ${text.slice(0, 400)}`)
    }
}


//withFkFail, 令外鍵查詢失敗, 錯誤文字夾帶憑證; 建表清單與其餘查詢照常
//  外鍵查詢(auto-sequelize mapForeignKeys)為 PRAGMA foreign_key_list(users); (無反引號, 結尾分號);
//  describeTable內亦有 PRAGMA foreign_key_list(`users`) (帶反引號、無分號), 不可一併打壞, 否則tables會變空而非只觸發外鍵標籤
async function withFkFail(fn, msg = `${ERRTXT} ${PW} ${CALL_PW} ${URL_}`) {
    let old = Sequelize.prototype.query
    Sequelize.prototype.query = function(sql, ...rest) {
        if (typeof sql === 'string' && /^PRAGMA foreign_key_list\(\w+\);$/i.test(sql.trim())) {
            let e = new Error(msg)
            e.code = 'SQLITE_ERROR'
            return Promise.reject(e)
        }
        return old.call(this, sql, ...rest)
    }
    try {
        return await fn()
    }
    finally {
        Sequelize.prototype.query = old
    }
}


let reSql = /^genModelsByDB sql \{ stmt: '[A-Z]+' \}$/


describe('diaglog genModelsByDB', function() {

    before(async function() {
        fs.mkdirSync(dirModels, { recursive: true })
        fs.mkdirSync(dirDirect, { recursive: true })
        if (fs.existsSync(storage)) {
            fs.unlinkSync(storage)
        }
        await wo({ ...getOpt(), fdModels: './models' }).createStorage()
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅在空資料夾時移除
        }
        catch (err) {}
    })


    describe('預設與logging(R17-7a、R17-7b)', function() {

        it('R17-7b 預設(建構與單次皆未給診斷選項): 成功路徑無任何輸出, resolve出tables與foreignKeys', async function() {
            let { res, all } = await genByDB()
            assert.deepStrictEqual(all, [])
            assert.deepStrictEqual(Object.keys(res.tables), ['users'])
            assert.deepStrictEqual(res.foreignKeys, {})
        })

        it('R17-7b 成功路徑未開logging: 只開logDetail或只給funLog亦無任何輸出(logDetail、funLog不單獨開啟sql紀錄), funLog不被呼叫', async function() {
            let got = []
            for (let ctor of [{ logDetail: true }, { funLog: (...a) => got.push(a) }, { logging: false, logDetail: true }]) {
                let { res, all } = await genByDB(ctor)
                assert.deepStrictEqual(all, [], JSON.stringify(Object.keys(ctor)))
                assert.deepStrictEqual(Object.keys(res.tables), ['users'])
            }
            assert.deepStrictEqual(got, [])
            let b = await genByDB({}, { logDetail: true })
            assert.deepStrictEqual(b.all, [])
        })

        it('R17-7a R17-7b 建構時logging:true被承接: 只輸出 genModelsByDB sql { stmt }(stdout), 不含SQL全文、表名、憑證', async function() {
            let { out, err } = await genByDB({ logging: true })
            assert.ok(out.length >= 1, '建構時之logging未被承接, 無任何sql紀錄')
            assert.deepStrictEqual(err, [])
            for (let line of out) {
                assert.ok(reSql.test(line), `輸出格式不符: ${line}`)
                assert.ok(line.indexOf('users') < 0, `輸出含表名: ${line}`)
                assert.ok(line.indexOf('Executing') < 0, `輸出含sql全文: ${line}`)
            }
            noCred(out.join('\n'))
        })

        it('R17-7a 單次呼叫logging:true覆寫建構時未開(預設)', async function() {
            let { out } = await genByDB({}, { logging: true })
            assert.ok(out.length >= 1)
            for (let line of out) {
                assert.ok(reSql.test(line), `輸出格式不符: ${line}`)
            }
        })

        it('R17-7a 單次呼叫logging:false覆寫建構時之logging:true', async function() {
            let { all } = await genByDB({ logging: true }, { logging: false })
            assert.deepStrictEqual(all, [])
        })

        it('R17-7a 單次呼叫logging型別錯誤(非布林)者沿用建構時之設定, 不放寬也不關閉', async function() {
            for (let v of ['true', 1, {}, null, 'false', 0]) {
                let a = await genByDB({ logging: true }, { logging: v })
                assert.ok(a.out.length >= 1, `型別錯誤[${String(v)}]不應關閉建構時之logging`)
                let b = await genByDB({}, { logging: v })
                assert.deepStrictEqual(b.all, [], `型別錯誤[${String(v)}]不應開啟logging`)
            }
        })

        it('R17-7b logging:true與logDetail:true並用: 輸出(genModelsByDB sql, sql全文), 憑證遮罩', async function() {
            let { out, err } = await genByDB({ logging: true, logDetail: true })
            assert.deepStrictEqual(err, [])
            assert.ok(out.length >= 1)
            assert.ok(out.some((l) => /^genModelsByDB sql Executing \(default\): /.test(l)), `未輸出sql全文: ${out.join('|')}`)
            assert.ok(out.every((l) => l.indexOf('genModelsByDB sql ') === 0), '每行皆帶固定標籤')
            noCred(out.join('\n'))
        })

    })


    describe('funLog(R17-7a、R17-7c)', function() {

        it('R17-7c 建構時funLog被承接: 收到 genModelsByDB sql、{ stmt }與SQL全文字串, console無輸出', async function() {
            let got = []
            let { all } = await genByDB({ logging: true, funLog: (...a) => got.push(a) })
            assert.deepStrictEqual(all, [])
            assert.ok(got.length >= 1, '建構時之funLog未被承接')
            for (let [label, safe, detail] of got) {
                assert.strictEqual(label, 'genModelsByDB sql')
                assert.ok(/^[A-Z]+$/.test(safe.stmt) && Object.keys(safe).join() === 'stmt', JSON.stringify(safe))
                assert.strictEqual(typeof detail, 'string')
            }
            assert.ok(got.some((x) => /^Executing \(default\): SELECT/.test(x[2])), '應收到SELECT之sql全文')
            noCred(JSON.stringify(got))
        })

        it('R17-7a 單次呼叫funLog優先於建構時之funLog', async function() {
            let ctorGot = []
            let callGot = []
            await genByDB({ logging: true, funLog: (...a) => ctorGot.push(a) }, { funLog: (...a) => callGot.push(a) })
            assert.deepStrictEqual(ctorGot, [])
            assert.ok(callGot.length >= 1)
            assert.ok(callGot.every((x) => x[0] === 'genModelsByDB sql'))
        })

        it('R17-7a 單次呼叫funLog非函數者沿用建構時之funLog; 建構時與單次皆未給則寫console', async function() {
            let got = []
            let a = await genByDB({ logging: true, funLog: (...x) => got.push(x) }, { funLog: 'x' })
            assert.deepStrictEqual(a.all, [])
            assert.ok(got.length >= 1)
            let b = await genByDB({ logging: true }, { funLog: {} })
            assert.ok(b.out.length >= 1)
        })

        it('R17-7c 失敗路徑: funLog收到 genModelsByDB tables catch、{ errType, errCode }, detail為遮罩副本(非原物件), console無輸出', async function() {
            let got = []
            let { res, all } = await genByDB({ funLog: (...a) => got.push(a) }, { storage: dir })
            assert.deepStrictEqual(all, [])
            assert.deepStrictEqual(res, { tables: {}, foreignKeys: {} })
            assert.strictEqual(got.length, 1)
            let [label, safe, detail] = got[0]
            assert.strictEqual(label, 'genModelsByDB tables catch')
            assert.deepStrictEqual(safe, { errType: 'SequelizeConnectionError', errCode: 'SQLITE_CANTOPEN' })
            assert.ok(detail instanceof Error)
            assert.ok(String(detail.message).indexOf('SQLITE_CANTOPEN') >= 0)
        })

        it('R17-7c 外鍵失敗: funLog收到 genModelsByDB foreign keys catch, detail內憑證(含opt.url)皆為***; tables仍照常產生', async function() {
            let got = []
            let { res } = await withFkFail(() => genByDB({ funLog: (...a) => got.push(a) }))
            assert.deepStrictEqual(Object.keys(res.tables), ['users'])
            let g = got.filter((x) => x[0] === 'genModelsByDB foreign keys catch')
            assert.strictEqual(g.length, 1)
            assert.deepStrictEqual(g[0][1], { errType: 'Error', errCode: 'SQLITE_ERROR' })
            let text = String(g[0][2].message)
            assert.ok(text.indexOf(ERRTXT) >= 0, `detail應保留錯誤原文以供除錯: ${text}`)
            assert.ok(text.indexOf('***') >= 0)
            noCred(text)
            noCred(JSON.stringify(got.map((x) => [x[0], x[1]])))
        })

        it('R17-7c funLog拋錯、回傳reject之promise皆不影響genModelsByDB之resolve, 亦不產生unhandledRejection', async function() {
            let unh = []
            let h = (e) => unh.push(e)
            process.on('unhandledRejection', h)
            try {
                let n = 0
                let funThrow = () => {
                    n++
                    throw new Error('x')
                }
                let a = await genByDB({ logging: true, funLog: funThrow })
                assert.ok(n >= 1)
                assert.deepStrictEqual(Object.keys(a.res.tables), ['users'])
                let b = await genByDB({ logging: true, funLog: () => Promise.reject(new Error('y')) })
                assert.deepStrictEqual(Object.keys(b.res.tables), ['users'])
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            finally {
                process.off('unhandledRejection', h)
            }
            assert.deepStrictEqual(unh, [])
        })

    })


    describe('錯誤標籤維持stderr(R17-7d)', function() {

        it('R17-7d tables catch: 預設摘要走console.error(stderr), 且僅一行 genModelsByDB tables catch { errType, errCode }', async function() {
            let { res, out, err } = await genByDB({}, { storage: dir })
            assert.deepStrictEqual(res, { tables: {}, foreignKeys: {} })
            assert.deepStrictEqual(out, [])
            assert.deepStrictEqual(err, ['genModelsByDB tables catch { errType: \'SequelizeConnectionError\', errCode: \'SQLITE_CANTOPEN\' }'])
            noCred(err.join('\n'))
            assert.ok(err.join('\n').indexOf(process.cwd()) < 0, '預設輸出不含路徑')
        })

        it('R17-7d foreign keys catch: 預設摘要走console.error(stderr), 不含錯誤原文與憑證; tables仍產生', async function() {
            let { res, out, err } = await withFkFail(() => genByDB())
            assert.deepStrictEqual(Object.keys(res.tables), ['users'])
            assert.deepStrictEqual(out, [])
            assert.deepStrictEqual(err, ['genModelsByDB foreign keys catch { errType: \'Error\', errCode: \'SQLITE_ERROR\' }'])
        })

        it('R17-7d sql走console.log(stdout), 不走stderr', async function() {
            let { out, err } = await genByDB({ logging: true })
            assert.ok(out.length >= 1)
            assert.deepStrictEqual(err, [])
        })

        it('R17-7d 建構時logging:true與外鍵失敗並用: sql在stdout, 錯誤摘要在stderr, 各自標籤正確', async function() {
            let { out, err } = await withFkFail(() => genByDB({ logging: true }))
            assert.ok(out.length >= 1 && out.every((l) => reSql.test(l)), out.join('|'))
            assert.deepStrictEqual(err, ['genModelsByDB foreign keys catch { errType: \'Error\', errCode: \'SQLITE_ERROR\' }'])
        })

    })


    describe('logDetail(R17-7a、R17-7e)', function() {

        it('R17-7e 建構時logDetail:true被承接: tables catch輸出(label, 錯誤副本)(stderr), 憑證遮罩', async function() {
            let { out, err } = await genByDB({ logDetail: true }, { storage: dir })
            assert.deepStrictEqual(out, [])
            assert.strictEqual(err.length, 1)
            assert.ok(/SQLITE_CANTOPEN: unable to open database file/.test(err[0]), `應輸出錯誤物件: ${err[0].slice(0, 200)}`)
            assert.ok(err[0].indexOf('genModelsByDB tables catch ') === 0, '須帶固定標籤')
            noCred(err[0])
        })

        it('R17-7e 外鍵失敗之細節: 錯誤原文保留, 建構憑證、opt.url與單次憑證皆為***', async function() {
            let { err } = await withFkFail(() => genByDB({ logDetail: true }))
            let text = err.join('\n')
            assert.ok(text.indexOf(ERRTXT) >= 0, text.slice(0, 300))
            assert.ok(text.indexOf('***') >= 0)
            noCred(text)
        })

        it('R17-7a 單次呼叫logDetail:true覆寫建構時未開', async function() {
            let { err } = await genByDB({}, { storage: dir, logDetail: true })
            assert.strictEqual(err.length, 1)
            assert.ok(/SQLITE_CANTOPEN: unable to open database file/.test(err[0]), err[0].slice(0, 200))
            assert.ok(err[0].indexOf('genModelsByDB tables catch ') === 0, '須帶固定標籤')
        })

        it('R17-7a 單次呼叫logDetail:false覆寫建構時之logDetail:true, 回到摘要', async function() {
            let { err } = await genByDB({ logDetail: true }, { storage: dir, logDetail: false })
            assert.deepStrictEqual(err, ['genModelsByDB tables catch { errType: \'SequelizeConnectionError\', errCode: \'SQLITE_CANTOPEN\' }'])
        })

        it('R17-7a 單次呼叫logDetail型別錯誤(非布林)者沿用建構時之設定', async function() {
            let a = await genByDB({ logDetail: true }, { storage: dir, logDetail: 'false' })
            assert.ok(/SQLITE_CANTOPEN: unable to open database file/.test(a.err[0]) && a.err[0].indexOf('genModelsByDB tables catch ') === 0, a.err[0].slice(0, 100))
            let b = await genByDB({}, { storage: dir, logDetail: 'true' })
            assert.deepStrictEqual(b.err, ['genModelsByDB tables catch { errType: \'SequelizeConnectionError\', errCode: \'SQLITE_CANTOPEN\' }'])
        })

    })


    describe('回傳契約不變(R17-7f)', function() {

        it('R17-7f resolve值與models檔等於直接呼叫WAutoSequelize(同設定, 不經本套件診斷轉接)', async function() {
            let viaWo = (await genByDB({ logging: true, logDetail: true })).res
            let call = getCall({ database: 'worm', directory: dirDirect, host: 'localhost', port: 1433, storage: path.resolve(storage), logging: false })
            let direct = await WAutoSequelize(call)
            assert.deepStrictEqual(viaWo, direct)
            let a = fs.readFileSync(`${dirModels}/users.js`, 'utf8')
            let b = fs.readFileSync(`${dirDirect}/users.js`, 'utf8')
            assert.ok(a.length > 50)
            assert.strictEqual(a, b)
        })

        it('R17-7f 缺必填(單次username為空字串)仍reject原訊息, 不因診斷轉接而改變', async function() {
            let msg
            await captureConsole(async () => {
                try {
                    await wo(getOpt()).genModelsByDB(getCall({ username: '' }))
                }
                catch (e) {
                    msg = e
                }
            })
            assert.strictEqual(msg, 'need username')
        })

        it('R17-7f 建表清單失敗仍只記錄不reject: resolve { tables: {}, foreignKeys: {} }(各診斷設定皆同)', async function() {
            for (let ctor of [{}, { logging: true }, { logDetail: true }, { funLog: () => {} }]) {
                let { res } = await genByDB(ctor, { storage: dir })
                assert.deepStrictEqual(res, { tables: {}, foreignKeys: {} }, JSON.stringify(Object.keys(ctor)))
            }
        })

    })


    describe('R-DIAG 接線(diag.with與reject)', function() {

        it('diag.with併入單次呼叫之sqlite檔案路徑(呼叫端所給之相對形式; w-auto-sequelize只宣告絕對形式, 建構時之storage另指他檔): 細節中遮罩, 錯誤原文保留', async function() {
            let rel = storage //'./test/_tmp/api-diaglog-gen/gen.sqlite'
            let relN = rel.replace(/^\.\//, '') //'test/_tmp/api-diaglog-gen/gen.sqlite'
            assert.ok(relN.indexOf('./') < 0 && path.resolve(rel) !== rel)
            let got = []
            let { res } = await withFkFail(() => captureConsole(() => wo(getOpt({ storage: `${dir}/ctor-other.sqlite`, funLog: (...a) => got.push(a) })).genModelsByDB(getCall({ storage: rel }))), `${ERRTXT} open ${rel} and ${relN}`)
            assert.deepStrictEqual(Object.keys(res.tables), ['users'])
            let g = got.filter((x) => x[0] === 'genModelsByDB foreign keys catch')
            assert.strictEqual(g.length, 1)
            let text = String(g[0][2].message)
            assert.ok(text.indexOf(ERRTXT) >= 0, text)
            assert.ok(text.indexOf(relN) < 0 && text.indexOf('gen.sqlite') < 0, `單次呼叫之sqlite檔案路徑未遮罩: ${text}`)
        })

        it('w-auto-sequelize之固定詞彙reject原樣交出: 建構時之密碼恰為其子字串(username)亦不被本套件之遮罩切碎', async function() {
            let msg
            await captureConsole(async () => {
                try {
                    await wo(getOpt({ url: `sqlite://${USER}:username@:` })).genModelsByDB(getCall({ username: '' }))
                }
                catch (e) {
                    msg = e
                }
            })
            assert.strictEqual(msg, 'need username')
        })

    })

})

import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import { scenario, settle } from './tools/diagScenario.mjs'
import captureConsole from './tools/captureConsole.mjs'


//rulebook R17: 診斷輸出(console)與SQL紀錄(opt.logging)之預設安全與可控, 僅以sqlite驗證(診斷輸出之邏輯與資料庫種類無關)
//本檔為接線測試(出口為wsemi之getDiag; 遮罩形態由wsemi之共用語料測, 本套件之語料接線見api-diaglog-wire)
//  R17-1 預設只輸出標籤與不含個資之摘要(不含資料值、id、錯誤原文、連線憑證、路徑)
//  R17-2 opt.logDetail為true輸出(label, 遮罩後細節), 連線字串與帳密一律以***遮罩
//  R17-3 opt.funLog(label, safe, detail)取代console收完整細節(憑證仍遮罩); 型別錯誤之選項忽略並用預設(同本套件其他選項)
//  R17-4 診斷輸出不得影響各操作之resolve/reject內容與時機
//  R17-5 SQL紀錄(opt.logging)預設關閉; 開啟時預設亦只輸出敘述種類, 完整SQL(select/del之where值為內嵌)需logDetail或funLog


let dir = './test/_tmp/api-diaglog'
let storage = `${dir}/diag.sqlite`
let dirBad = `${dir}/models-bad`
let dirGen = `${dir}/gen`

let PW = 'S3cretPw'
let USER = 'tuser'
let ID = 'u-secret-001@example.com'
let NAME = 'AliceSecret'
let ERRTXT = 'model load failed'
let NOTICE = '@journeyapps/sqlcipher can not support transaction.'


let getOpt = (ex = {}) => {
    return {
        url: `sqlite://${USER}:${PW}@:`,
        db: 'worm',
        cl: 'users',
        fdModels: './models',
        storage,
        ...ex,
    }
}


//capture, 擷取console各方法之輸出(以util.format格式化, 與實際輸出一致)
async function capture(fn) {
    let { res, all } = await captureConsole(fn)
    return { res, lines: all }
}


let noCred = (text, msg = '') => {
    for (let s of [PW, USER, `${USER}:${PW}`, `sqlite://${USER}`]) {
        assert.ok(text.indexOf(s) < 0, `${msg}輸出含連線憑證[${s}]: ${text.slice(0, 400)}`)
    }
}


let noData = (text, msg = '') => {
    noCred(text, msg)
    for (let s of [ID, NAME, 'u-secret', ERRTXT, 'listener', process.cwd(), path.resolve('.').replace(/\\/g, '/'), 'Cannot find', 'tbad.js']) {
        assert.ok(text.indexOf(s) < 0, `${msg}輸出含不該出現之內容[${s}]: ${text.slice(0, 400)}`)
    }
}


//clean, 以乾淨(無訂閱函數、無診斷輸出)之實例刪除測試列, 使各測試之清理不再觸發該測試所掛之訂閱函數而於擷取區外輸出
let clean = () => wo(getOpt()).del({ id: ID })


//golden, 回傳契約之固定預期值: 以修改前之程式(git HEAD)執行tools/diagScenario.mjs之情境所得(不含R17新功能), 與本檔無關之程式不得改動它
let golden = JSON.parse(fs.readFileSync('./test/tools/diagGolden.json', 'utf8'))


describe('diaglog', function() {

    before(async function() {
        fs.mkdirSync(dirBad, { recursive: true })
        fs.writeFileSync(`${dirBad}/tbad.js`, `module.exports = function(sequelize, DataTypes) {\n    throw new Error('${ERRTXT} ${PW} ${ID}')\n}\n`, 'utf8')
        if (fs.existsSync(storage)) {
            fs.unlinkSync(storage)
        }
        await wo(getOpt()).createStorage()
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅在空資料夾時移除
        }
        catch (err) {}
    })


    describe('單一出口', function() {

        it('R17-1 src內不得直接呼叫console或寫process.stdout/stderr(所有診斷輸出經wsemi之getDiag單一出口)', function() {
            let bads = []
            let n = 0
            let main = null //WOrmReladb.mjs 去註解後之文字, 供下方之「掃描未盲」檢查
            for (let f of fs.readdirSync('./src')) {
                if (!/\.(mjs|js)$/.test(f)) {
                    continue
                }
                n++
                //註解以空白取代(保留行號): 區塊註解只認行首之/*(JSDoc), 與 unit-diaglog.test.mjs 之 src 同一寫法;
                //不可用不限位置之 /\/\*[\s\S]*?\*\//g: 行註解內之 `<scheme>://***`(WOrmReladb.mjs 約第 161 行)含 `/*`, 會被當成區塊註解起點,
                //把其後至下一個 `*/` 之程式碼(約第 161–268 行, 68 行程式碼)整段吃掉, 該段內之 console 呼叫不被掃描(reladb2 實測: 植入 console.log(1) 時本案仍綠)
                let s = fs.readFileSync(`./src/${f}`, 'utf8').replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ' '))
                if (f === 'WOrmReladb.mjs') {
                    main = s
                }
                s.split(/\r?\n/).forEach((line, k) => {
                    let code = line.replace(/\/\/.*$/, '')
                    if (/\bconsole\s*[.[]/.test(code) || /process\s*\.\s*(stdout|stderr)/.test(code)) {
                        bads.push(`${f}:${k + 1} ${line.trim().slice(0, 80)}`)
                    }
                })
            }
            assert.ok(n >= 4, `掃描檔數過少: ${n}`)
            //掃描未盲(canary): 行註解內 `://***` 之前後(建構段之 throwUrlErr 定義與 diag 定義, 皆在舊正則之隱形區段內)之程式碼須仍在去註解後之文字內;
            //若此二處被重構改名, 請更新此二標記為同區段內其他程式碼(目的: 掃描須涵蓋整個建構段, 不因註解去除失誤而漏看)
            assert.ok(main !== null && main.indexOf('let throwUrlErr = (msg) =>') >= 0 && main.indexOf('let diag = getDiag(optLog, cfg)') >= 0, '掃描已失明: WOrmReladb.mjs 去註解後缺建構段之程式碼(註解去除之正則誤吃程式碼)')
            assert.deepStrictEqual(bads, [], `下列站點未經單一出口:\n${bads.join('\n')}`)
        })

    })


    describe('預設(R17-1)', function() {

        it('change訂閱函數拋錯: 輸出有標籤, 不含資料值、id、錯誤原文、憑證; insert之resolve不變', async function() {
            let w = wo(getOpt())
            w.on('change', () => {
                throw new Error(`listener ${ID} ${PW} ${NAME}`)
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME, value: 1 })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.ok(lines.length >= 1, '訂閱函數拋錯應有診斷輸出(標籤)')
            assert.ok(lines.some((v) => v.indexOf('change') >= 0 && v.indexOf('insert') >= 0), lines.join('|'))
            noData(lines.join('\n'))
            await clean()
        })

        it('error訂閱函數拋錯: 輸出不含訂閱函數之錯誤原文與find內容; select之reject不變', async function() {
            let w = wo(getOpt())
            w.on('error', () => {
                throw new Error(`listener ${ID} ${PW}`)
            })
            let { res, lines } = await capture(() => settle(w.select({ $foo: ID })))
            assert.ok(res.err !== undefined && res.err.indexOf('invalid find: unsupported operator [$foo]') === 0, JSON.stringify(res))
            assert.ok(lines.length >= 1)
            assert.ok(lines.some((v) => v.indexOf('error') >= 0 && v.indexOf('select') >= 0), lines.join('|'))
            noData(lines.join('\n'))
        })

        it('model載入失敗(model檔拋錯): 輸出不含錯誤原文、路徑、憑證; reject訊息不變', async function() {
            let w = wo(getOpt({ cl: 'tbad', fdModels: dirBad }))
            let { res, lines } = await capture(() => settle(w.select({})))
            assert.strictEqual(res.err, 'can not import model: tbad, need to use genModelsByDB, genModelsByTabs or create tbad.js')
            assert.ok(lines.length >= 1)
            assert.ok(lines.join('\n').indexOf('tbad') >= 0, '摘要應含表名')
            noData(lines.join('\n'))
        })

        it('model檔缺失: 輸出不含檔案路徑與系統錯誤原文; reject訊息不變', async function() {
            let w = wo(getOpt({ cl: 'nomodel' }))
            let { res, lines } = await capture(() => settle(w.select({})))
            assert.strictEqual(res.err, 'can not import model: nomodel, need to use genModelsByDB, genModelsByTabs or create nomodel.js')
            assert.ok(lines.length >= 1)
            noData(lines.join('\n'))
            assert.ok(!/node_modules|\.mjs|\.js:\d+/.test(lines.join('\n')), '輸出含堆疊或路徑')
        })

        it('sqlcipher不支援交易之提示(七函數各一處, 固定文字不含資料): 預設仍輸出該行, 且僅一行', async function() {
            let ops = {
                select: (w, o) => w.select({}, o),
                selectByPk: (w, o) => w.selectByPk('k1', o),
                insert: (w, o) => w.insert({ id: 'k1', name: 'n' }, o),
                insertBulk: (w, o) => w.insertBulk([{ id: 'k1', name: 'n' }], o),
                save: (w, o) => w.save({ id: 'k1', name: 'n' }, o),
                del: (w, o) => w.del({ id: 'k1' }, o),
                delAll: (w, o) => w.delAll({}, o),
            }
            for (let [name, fn] of Object.entries(ops)) {
                let w = wo(getOpt({ useEncryption: true }))
                let { lines } = await capture(() => settle(fn(w, { transaction: {} })))
                let n = lines.filter((v) => v === NOTICE).length
                assert.strictEqual(n, 1, `${name} 提示行數 ${n}: ${lines.join('|').slice(0, 300)}`)
                noData(lines.join('\n'), `${name} `)
            }
        })

        it('未開logging: 成功之各操作無任何console輸出', async function() {
            let w = wo(getOpt())
            let { lines } = await capture(() => scenario(w, false))
            assert.deepStrictEqual(lines, [])
        })

        it('R17-5 opt.logging為true: 只輸出敘述種類, 不含where內嵌之id與欄位值(select、selectByPk、del)、不含憑證', async function() {
            let w = wo(getOpt({ logging: true }))
            let { lines } = await capture(async () => {
                await w.insert({ id: ID, name: NAME, value: 1 })
                await w.save({ id: ID, name: `${NAME}2` })
                await w.select({ name: `${NAME}2` })
                await w.selectByPk(ID)
                await w.del({ id: ID })
            })
            let text = lines.join('\n')
            assert.ok(lines.length >= 5, `SQL紀錄行數 ${lines.length}`)
            for (let kw of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
                assert.ok(lines.some((v) => v.indexOf(kw) >= 0), `缺${kw}摘要: ${text.slice(0, 300)}`)
            }
            noData(text)
            assert.ok(text.indexOf('Executing') < 0 && text.indexOf('FROM') < 0 && text.indexOf('WHERE') < 0, `預設不得輸出SQL全文: ${text.slice(0, 300)}`)
        })

        it('選項型別錯誤者忽略並用預設(不拋錯、不洩漏): logDetail為字串或1、funLog為字串或物件', async function() {
            for (let ex of [{ logDetail: 'true' }, { logDetail: 1 }, { logDetail: {} }, { funLog: 'x' }, { funLog: {} }, { logDetail: 'yes', funLog: 123 }]) {
                let w = wo(getOpt(ex))
                w.on('change', () => {
                    throw new Error(`listener ${ID} ${PW}`)
                })
                let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
                assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } }, JSON.stringify(ex))
                assert.ok(lines.length >= 1, JSON.stringify(ex))
                noData(lines.join('\n'), `${JSON.stringify(ex)} `)
                await clean()
            }
        })

    })


    describe('funLog(R17-3)', function() {

        it('change訂閱函數拋錯: funLog收(label, safe, detail), detail為完整錯誤(含id)但憑證遮罩; 不寫console', async function() {
            let got = []
            let w = wo(getOpt({ funLog: (...a) => got.push(a) }))
            w.on('change', () => {
                throw new Error(`listener ${ID} ${PW}`)
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
            let [label, safe, detail] = got[0]
            assert.ok(typeof label === 'string' && label.length > 0)
            assert.strictEqual(safe.mode, 'insert')
            assert.strictEqual(safe.errType, 'Error')
            assert.ok(detail instanceof Error)
            assert.ok(detail.message.indexOf(ID) >= 0 && detail.message.indexOf('listener') >= 0, '完整細節應含原文')
            noCred(JSON.stringify({ safe, m: detail.message, s: detail.stack }), 'funLog ')
            assert.ok(detail.message.indexOf('***') >= 0)
            await clean()
        })

        it('model載入失敗: funLog之detail含錯誤原文(憑證遮罩), safe不含; reject訊息不變', async function() {
            let got = []
            let w = wo(getOpt({ cl: 'tbad', fdModels: dirBad, funLog: (...a) => got.push(a) }))
            let { res, lines } = await capture(() => settle(w.select({})))
            assert.strictEqual(res.err, 'can not import model: tbad, need to use genModelsByDB, genModelsByTabs or create tbad.js')
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
            let [, safe, detail] = got[0]
            assert.strictEqual(JSON.stringify(safe).indexOf(ERRTXT), -1)
            assert.strictEqual(safe.cl, 'tbad')
            let text = util.inspect(detail, { depth: 6 })
            assert.ok(text.indexOf(ERRTXT) >= 0 && text.indexOf(ID) >= 0, text.slice(0, 300))
            noCred(text, 'funLog ')
        })

        it('R17-5 opt.logging為true: funLog收("sql", {stmt}, 完整SQL), 完整SQL含where之id; 不寫console', async function() {
            let got = []
            let w = wo(getOpt({ logging: true, funLog: (...a) => got.push(a) }))
            let { lines } = await capture(async () => {
                await w.insert({ id: ID, name: NAME })
                await w.selectByPk(ID)
                await w.del({ id: ID })
            })
            assert.deepStrictEqual(lines, [])
            let sel = got.filter((v) => v[1] && v[1].stmt === 'SELECT')
            assert.ok(sel.length >= 1 && sel.every((v) => v[0] === 'sql'), JSON.stringify(got.map((v) => v[1])))
            assert.ok(sel.some((v) => typeof v[2] === 'string' && v[2].indexOf(ID) >= 0 && v[2].indexOf('Executing') === 0), '完整SQL應含id')
            for (let v of got) {
                assert.deepStrictEqual(Object.keys(v[1]), ['stmt'])
            }
        })

        it('sqlcipher提示: funLog收到固定標籤, 不寫console', async function() {
            let got = []
            let w = wo(getOpt({ useEncryption: true, funLog: (...a) => got.push(a) }))
            let { lines } = await capture(() => settle(w.select({}, { transaction: {} })))
            assert.deepStrictEqual(lines, [])
            assert.ok(got.some((v) => v[0] === NOTICE), JSON.stringify(got.map((v) => v[0])))
        })

        it('error訂閱函數拋錯: funLog收(label, safe, detail), detail為完整錯誤(帳號與密碼遮罩), 不寫console; select之reject不變', async function() {
            let got = []
            let w = wo(getOpt({ funLog: (...a) => got.push(a) }))
            w.on('error', () => {
                throw new Error(`listener ${ID} ${PW} ${USER}`)
            })
            let { res, lines } = await capture(() => settle(w.select({ $foo: ID })))
            assert.ok(res.err !== undefined && res.err.indexOf('invalid find: unsupported operator [$foo]') === 0)
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
            let [label, safe, detail] = got[0]
            assert.ok(typeof label === 'string' && label.length > 0)
            assert.deepStrictEqual(safe, { mode: 'select', errType: 'Error' })
            assert.ok(detail instanceof Error && detail.message.indexOf(ID) >= 0 && detail.message.indexOf('listener') >= 0, String(detail && detail.message))
            noCred(detail.message + detail.stack, 'funLog ')
            assert.ok(detail.message.indexOf('***') >= 0)
        })

        it('R17-2 錯誤物件上其他欄位(parameters、sql、original、cause、屬性鍵)含憑證: funLog收到之細節皆已遮罩, 非憑證之值保留', async function() {
            let got = []
            let w = wo(getOpt({ funLog: (...a) => got.push(a) }))
            w.on('change', () => {
                let e = new Error('x', { cause: new Error(`cause ${PW}`) })
                e.parameters = [PW, { k: `a${PW}`, id: ID }]
                e.sql = `SELECT '${PW}' FROM t WHERE id = '${ID}'`
                e.original = { message: `pw ${PW}`, code: 'ELOGIN' }
                e[PW] = 1
                throw e
            })
            let { lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
            let d = got[0][2]
            let text = util.inspect(d, { depth: 8, showHidden: true }) + Reflect.ownKeys(d).map(String).join('|')
            noCred(text, 'funLog ')
            assert.ok(text.indexOf(ID) >= 0 && text.indexOf('ELOGIN') >= 0, '非憑證之細節被誤遮')
            assert.strictEqual(got[0][1].errType, 'Error')
            await clean()
        })

        it('R17-4 funLog拋錯或回傳reject之promise: 各操作結果不變, 不產生unhandledRejection', async function() {
            let bad = []
            let fnU = (e) => bad.push(e)
            process.on('unhandledRejection', fnU)
            try {
                let n = 0
                for (let funLog of [() => {
                    n++
                    throw new Error('funLog boom')
                }, () => {
                    n++
                    return Promise.reject(new Error('funLog rejected'))
                }]) {
                    let n0 = n
                    let w = wo(getOpt({ funLog, logging: true }))
                    w.on('change', () => {
                        throw new Error('listener')
                    })
                    let r = await settle(w.insert({ id: ID, name: NAME }))
                    assert.deepStrictEqual(r, { ok: { n: 1, nInserted: 1, ok: 1 } })
                    await clean()
                    assert.ok(n - n0 >= 2, `funLog未被呼叫(SQL紀錄與訂閱函數拋錯皆應交給它): ${n - n0}`)
                }
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            finally {
                process.off('unhandledRejection', fnU)
            }
            assert.deepStrictEqual(bad.map((v) => String(v && v.message)), [])
        })

    })


    describe('logDetail(R17-2)', function() {

        it('change訂閱函數拋錯: 還原細節輸出(含id與錯誤原文), 憑證遮罩', async function() {
            let w = wo(getOpt({ logDetail: true }))
            w.on('change', () => {
                throw new Error(`listener ${ID} ${PW}`)
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            let text = lines.join('\n')
            assert.ok(text.indexOf(ID) >= 0 && text.indexOf('listener') >= 0, `細節未還原: ${text.slice(0, 300)}`)
            noCred(text, 'logDetail ')
            assert.ok(text.indexOf('***') >= 0)
            await clean()
        })

        it('model載入失敗: 還原錯誤原文輸出(憑證遮罩), reject訊息不變', async function() {
            let w = wo(getOpt({ cl: 'tbad', fdModels: dirBad, logDetail: true }))
            let { res, lines } = await capture(() => settle(w.select({})))
            assert.strictEqual(res.err, 'can not import model: tbad, need to use genModelsByDB, genModelsByTabs or create tbad.js')
            let text = lines.join('\n')
            assert.ok(text.indexOf(ERRTXT) >= 0 && text.indexOf(ID) >= 0, `細節未還原: ${text.slice(0, 300)}`)
            noCred(text, 'logDetail ')
        })

        it('R17-5 logging+logDetail: 還原完整SQL(含where內嵌之id), 值為密碼者遮罩; insert/update之SQL為$n佔位不含值(未開logQueryParameters)', async function() {
            let w = wo(getOpt({ logging: true, logDetail: true }))
            let { lines } = await capture(async () => {
                await w.insert({ id: ID, name: NAME, value: 1 })
                await w.save({ id: ID, name: `${NAME}2` })
                await w.selectByPk(ID)
                await w.select({ name: PW })
                await w.del({ id: ID })
            })
            let text = lines.join('\n')
            noCred(text, 'logDetail ')
            assert.ok(lines.some((v) => v.indexOf('sql Executing (default): SELECT') === 0 && v.indexOf(ID) >= 0), `完整SQL未還原(格式為label加細節): ${text.slice(0, 300)}`)
            assert.ok(lines.some((v) => v.indexOf('= \'***\'') >= 0), `密碼值未遮罩: ${text.slice(0, 300)}`)
            let ins = lines.filter((v) => v.indexOf('INSERT INTO `users`') >= 0)
            assert.ok(ins.length >= 1 && ins.every((v) => v.indexOf('$1') >= 0 && v.indexOf(NAME) < 0 && v.indexOf(ID) < 0), `INSERT應為佔位: ${ins.join('|')}`)
            let upd = lines.filter((v) => v.indexOf('UPDATE `users`') >= 0)
            assert.ok(upd.length >= 1 && upd.every((v) => v.indexOf('$1') >= 0 && v.indexOf(`${NAME}2`) < 0), `UPDATE應為佔位: ${upd.join('|')}`)
        })

        it('R17-2 logDetail之輸出格式為(label, 細節)(wsemi之getDiag, 舊版之裸輸出bare已移除): 訂閱函數之錯誤與model載入失敗皆加標籤, 帳號單獨出現亦遮罩', async function() {
            let w = wo(getOpt({ logDetail: true }))
            w.on('change', () => {
                throw new Error(`plain listener ${USER} only`)
            })
            let a = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.ok(a.lines.length === 1 && a.lines[0].split('\n')[0] === 'change handler threw Error: plain listener *** only', a.lines.join('|'))
            noCred(a.lines.join('\n'), 'logDetail ')
            await clean()
            let wb = wo(getOpt({ cl: 'tbad', fdModels: dirBad, logDetail: true }))
            let b = await capture(() => settle(wb.select({})))
            assert.ok(b.lines.length === 1 && b.lines[0].startsWith('can not import model {\n  state: \'error\','), b.lines.join('|').slice(0, 200))
            let we = wo(getOpt({ logDetail: true }))
            we.on('error', () => {
                throw new Error(`plain error listener ${ID}`)
            })
            let c = await capture(() => settle(we.select({ $foo: 1 })))
            assert.ok(c.lines.length === 1 && c.lines[0].split('\n')[0] === `error handler threw Error: plain error listener ${ID}`, c.lines.join('|'))
        })

        it('R17-2 PRAGMA key敘述(sqlite加密時由本套件以帳號:密碼設定)經SQL紀錄時: 預設只列PRAGMA, logDetail與funLog之全文帳密皆遮罩', async function() {
            //註: 加密套件@journeyapps/sqlcipher未安裝, 以一般sqlite執行同形敘述(未加密之sqlite忽略PRAGMA key), 驗logging函數對該敘述之處理
            let stmt = `PRAGMA key = '${USER}:${PW}'`
            let run = async (ex) => {
                let w = wo(getOpt({ logging: true, ...ex }))
                let si = await w.init()
                try {
                    return await capture(() => si.mds.users.sequelize.query(stmt))
                }
                finally {
                    await si.close()
                }
            }
            let a = await run({})
            let ta = a.lines.join('\n')
            assert.ok(a.lines.some((v) => v.indexOf('PRAGMA') >= 0), ta)
            assert.ok(ta.indexOf('key') < 0 && ta.indexOf('Executing') < 0, `預設不得輸出敘述全文: ${ta}`)
            noCred(ta, '預設 ')
            let b = await run({ logDetail: true })
            let tb = b.lines.join('\n')
            assert.ok(tb.indexOf('PRAGMA key') >= 0 && tb.indexOf('\'***\'') >= 0, tb)
            noCred(tb, 'logDetail ')
            let got = []
            let c = await run({ funLog: (...x) => got.push(x) })
            assert.deepStrictEqual(c.lines, [])
            assert.ok(got.length >= 1 && got.every((v) => v[0] === 'sql'))
            let full = got.map((v) => String(v[2])).join('\n')
            assert.ok(full.indexOf('PRAGMA key') >= 0 && full.indexOf('\'***\'') >= 0, full)
            noCred(full + JSON.stringify(got.map((v) => v[1])), 'funLog ')
        })

        it('genModelsByTabs: 檔案路徑預設不輸出, logDetail還原, funLog收完整路徑', async function() {
            //註: genModelsByTabs.mjs之TEXT主鍵提示站(getField內o.type === 'TEXT')於現況不可達(o.type恆為'DataTypes.xxx'前綴字串), 無從以輸入觸發, 該站改走diag由靜態掃描(單一出口)涵蓋
            let tabs = { tgen1: { id: { type: 'TEXT', pk: true }, name: 'TEXT' } }
            let a = await capture(() => wo(getOpt()).genModelsByTabs(dirGen, tabs, { type: 'js' }))
            let ta = a.lines.join('\n')
            assert.ok(a.lines.some((v) => v.indexOf('generate file') >= 0), ta)
            assert.ok(ta.indexOf('api-diaglog') < 0 && ta.indexOf('tgen1.js') < 0, `預設不得輸出檔案路徑: ${ta}`)
            let b = await capture(() => wo(getOpt({ logDetail: true })).genModelsByTabs(dirGen, tabs, { type: 'js' }))
            assert.ok(b.lines.some((v) => v.indexOf('generate file') >= 0 && v.indexOf('tgen1.js') >= 0), b.lines.join('\n'))
            let got = []
            let c = await capture(() => wo(getOpt({ funLog: (...x) => got.push(x) })).genModelsByTabs(dirGen, tabs, { type: 'js' }))
            assert.deepStrictEqual(c.lines, [])
            assert.ok(got.some((v) => v[0].indexOf('generate file') >= 0 && String(v[2]).indexOf('tgen1.js') >= 0), JSON.stringify(got))
            assert.ok(fs.existsSync(`${dirGen}/tgen1.js`))
        })

        it('genModelsByTabs寫檔失敗: 預設只列錯誤類別與代碼(不含路徑), logDetail輸出錯誤副本(錯誤自帶之path於細節遮罩, wsemi之R-DIAG-01); 不拋錯', async function() {
            let fd = `${dirGen}/clash`
            fs.mkdirSync(`${fd}/tclash.js`, { recursive: true }) //以同名資料夾使writeFileSync失敗(EISDIR)
            let tabs = { tclash: { id: { type: 'STRING', pk: true } } }
            let a = await capture(() => wo(getOpt()).genModelsByTabs(fd, tabs))
            let ta = a.lines.join('\n')
            assert.ok(a.lines.some((v) => v.indexOf('save file') >= 0 && v.indexOf('EISDIR') >= 0), ta)
            assert.ok(ta.indexOf('tclash.js') < 0 && ta.indexOf('api-diaglog') < 0, `預設不得輸出路徑: ${ta}`)
            let b = await capture(() => wo(getOpt({ logDetail: true })).genModelsByTabs(fd, tabs))
            let tb = b.lines.join('\n')
            assert.ok(b.lines.length === 1 && tb.indexOf('save file catch Error: EISDIR: illegal operation on a directory, open \'***\'') === 0, tb.slice(0, 300))
            assert.ok(tb.indexOf('tclash.js') < 0 && tb.indexOf('code: \'EISDIR\'') >= 0, tb.slice(0, 300))
        })

    })


    describe('回傳契約不變(R17-4)', function() {

        it('預設、logDetail、funLog、logging、logging+logDetail、訂閱函數拋錯: 各操作之resolve/reject內容與事件payload與修改前(git HEAD)之固定預期值完全相同', async function() {
            let configs = [
                ['default', {}, false],
                ['logDetail', { logDetail: true }, false],
                ['funLog', { funLog: () => {} }, false],
                ['logging', { logging: true }, false],
                ['logging+logDetail', { logging: true, logDetail: true }, false],
                ['badListener+default', {}, true],
                ['badListener+logDetail', { logDetail: true }, true],
                ['badListener+funLog', { funLog: () => {} }, true],
            ]
            for (let k of ['plain', 'bad']) {
                let g = golden[k]
                assert.ok(g.out.length === 10 && g.evs.length >= 9 && g.out.some((v) => v.err !== undefined) && g.out.some((v) => v.ok !== undefined), `golden(${k})形狀不符`)
            }
            for (let [name, ex, bad] of configs) {
                let w = wo(getOpt(ex))
                let { res } = await capture(() => scenario(w, bad))
                let snap = JSON.parse(JSON.stringify(res))
                assert.deepStrictEqual(snap, golden[bad ? 'bad' : 'plain'], `${name} 與修改前之固定預期值不同`)
            }
        })

        it('createStorage與init之結果不變: createStorage回created, init回{mds, err: null, close}, 關閉後各操作reject', async function() {
            for (let ex of [{}, { logDetail: true }, { funLog: () => {} }, { logging: true }]) {
                let w = wo(getOpt(ex))
                let { res } = await capture(async () => {
                    let cs = await settle(w.createStorage())
                    let si = await w.init()
                    let keys = Object.keys(si).sort()
                    let mdKeys = Object.keys(si.mds)
                    await si.close()
                    let closed = await settle(w.select({}, { instance: si }))
                    return { cs, keys, err: si.err, mdKeys, closed }
                })
                assert.deepStrictEqual(res.cs, { ok: 'created' }, JSON.stringify(ex))
                assert.deepStrictEqual(res.keys, ['close', 'err', 'mds'])
                assert.strictEqual(res.err, null)
                assert.deepStrictEqual(res.mdKeys, ['users'])
                assert.ok(res.closed.err !== undefined, '關閉後之實例應reject')
            }
        })

    })

})

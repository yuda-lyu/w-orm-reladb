import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import { spawn, execFileSync } from 'child_process'
import wo from '../src/WOrmReladb.mjs'


//rulebook R19(第 210 項): sqlite 之 storage 無法開啟時, 本套件各函數須 settle 且以既有失敗通道回報, 不得永不 settle
//  R19-1 storage 為資料夾、檔名超長(兩平台皆開啟失敗)、無權限、父路徑為檔案時, 各函數 reject(或逐筆 ok 為 0), 不得懸置
//  R19-2 一次懸置不得擋住同行程之其他實例(模組層級 pmq 佇列為全域共用: 缺陷版之懸置會使其後所有 useStable 操作皆懸置)
//  R19-2b 同一實例開啟失敗後再呼叫(select、insert、init 之 close), 仍 settle
//  R19-3 對照組: 正常 sqlite 檔、父資料夾不存在而可建立者, 各函數照常 resolve
//  R19-4 reject 之訊息不帶連線憑證(url 之帳密)
//  R20(第 213 項, 與本檔共用子行程情境) opt.storage 含 NUL 或恰為 ':memory:' 者於建構時即拒收(unit-storage 驗訊息與邊界):
//  R20-9 各函數之呼叫皆 reject 為建構之固定詞彙(不 settle 為 resolve、不懸置、兩平台一致), 且不建立任何檔案或資料夾(sqlite3 於 NUL 截斷檔名而開出名為截斷後之檔; ':memory:' 於 POSIX 開出名為 :memory: 之檔)
//  R20-10 回歸守則: opt.storage 仍於建構時以 path.resolve 定為絕對路徑(R20 之判斷須用原值, 故 path.resolve 移到判斷之後, 位置改變不得使其消失)
//
//方法: 每個(形態 × 函數)各自以子行程執行(test/tools/sqliteOpenScenario.mjs): 缺陷版之懸置會使該子行程之事件迴圈排空而觸發 beforeExit,
//子行程據此回報 pending(事件判定, 不用牆鐘看門狗); 父行程之外層逾時只防「迴圈被他物撐住」之懸置, 不表達規格
//註: 本套件之 storage 經 path.resolve, 故 ':memory:' 不是記憶體資料庫(win32 為非法路徑, POSIX 為 cwd 下名為 ':memory:' 之檔案), 第 213 項起建構時拒收, 不再屬「開啟失敗」形態


let dir = './test/_tmp/api-sqlite-open'
let root = path.resolve(dir)
let scenario = path.resolve('./test/tools/sqliteOpenScenario.mjs')
let fdModels = path.resolve('./models')

let PW = 'S3cretPw'
let USER = 'tuser'
let URL_CRED = `sqlite://${USER}:${PW}@:`

let BACKSTOP_MS = 90000 //外層逾時(只防懸置)

let OPS = ['createStorage', 'select', 'selectByPk', 'insert', 'insertBulk', 'save', 'del', 'delAll', 'initClose', 'txClose']


let isWin = process.platform === 'win32'
let isRoot = typeof process.getuid === 'function' && process.getuid() === 0


//runScenario, 以子行程跑情境, 回傳{ rs: 各步驟結果(依序), others: 非結果之輸出行, code, backstop }
function runScenario(steps, cwd) {
    return new Promise((resolve) => {
        let ch = spawn(process.execPath, [scenario, JSON.stringify({ fdModels, steps })], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let buf = ''
        let errBuf = ''
        let backstop = false
        let timer = setTimeout(() => {
            backstop = true
            ch.kill()
        }, BACKSTOP_MS)
        ch.stdout.on('data', (d) => {
            buf += d.toString('utf8')
        })
        ch.stderr.on('data', (d) => {
            errBuf += d.toString('utf8')
        })
        ch.on('close', (code) => {
            clearTimeout(timer)
            let rs = []
            let others = []
            for (let line of buf.split(/\r?\n/)) {
                if (line === '') {
                    continue
                }
                let o = null
                if (line.startsWith('{"')) {
                    try {
                        o = JSON.parse(line)
                    }
                    catch (err) {}
                }
                if (o !== null && (o.state !== undefined || o.done || o.fatal)) {
                    rs.push(o)
                }
                else {
                    others.push(line)
                }
            }
            resolve({ rs, others, errBuf, code, backstop })
        })
    })
}


//limit, 同時至多n個之非同步工作
async function runLimit(tasks, n) {
    let i = 0
    let ws = []
    for (let k = 0; k < n; k++) {
        ws.push((async () => {
            while (i < tasks.length) {
                let t = tasks[i++]
                await t()
            }
        })())
    }
    await Promise.all(ws)
}


//形態表: kind 'fail'為開啟失敗(batch: 各函數reject; item: save、del之逐筆ok為0), 'ok'為對照組
let shapes = []
let restores = [] //after 時還原(權限)


function addShapes() {
    fs.mkdirSync(root, { recursive: true })

    //資料夾當 storage: sqlite3 開啟失敗(SQLITE_CANTOPEN)
    let adir = path.join(root, 'adir')
    fs.mkdirSync(adir, { recursive: true })
    shapes.push({ name: 'dir', storage: adir, kind: 'fail', url: URL_CRED })

    //檔名超長(單一元件逾 255 字元; 兩平台之開啟皆失敗)
    shapes.push({ name: 'longName', storage: path.join(root, 'n'.repeat(300) + '.sqlite'), kind: 'fail' })

    //無權限: POSIX 非 root 以 chmod 000; win32 以 icacls 拒絕目前使用者之讀寫(after 還原)
    if (!isRoot) {
        let locked = path.join(root, 'locked.sqlite')
        fs.writeFileSync(locked, '')
        if (isWin) {
            let who = `${process.env.USERDOMAIN}\\${os.userInfo().username}`
            execFileSync('icacls', [locked, '/deny', `${who}:(R,W)`], { stdio: 'ignore' })
            restores.push(() => execFileSync('icacls', [locked, '/remove:d', who], { stdio: 'ignore' }))
        }
        else {
            fs.chmodSync(locked, 0o000)
            restores.push(() => fs.chmodSync(locked, 0o600))
        }
        shapes.push({ name: 'noPermission', storage: locked, kind: 'fail' })
    }

    //父路徑為檔案: mkdir 於建立 Database 之前即失敗(缺陷版亦不懸置; 對照其與開啟失敗者之差別)
    let afile = path.join(root, 'afile')
    fs.writeFileSync(afile, 'x')
    shapes.push({ name: 'parentIsFile', storage: path.join(afile, 'x.sqlite'), kind: 'fail', item: true })

    //:memory:(R20): 建構時拒收; 子行程 cwd 為 root/memcwd-<op>(修前 POSIX 下會於該夾內開出名為':memory:'之檔案, 各函數各用一夾以免共用), 拒收後該夾須仍為空
    shapes.push({
        name: 'memory',
        storage: ':memory:',
        cwdOf: (op) => {
            let d = path.join(root, `memcwd-${op}`)
            fs.mkdirSync(d, { recursive: true })
            return d
        },
        kind: 'ctor',
        why: 'invalid opt.storage: must be a file path, an in-memory database is not supported',
        sideDirOf: (op) => path.join(root, `memcwd-${op}`),
    })

    //含 NUL(R20): 建構時拒收; 修前 sqlite3 於 NUL 截斷而開出名為 a 之檔(其上層資料夾亦被建立), 拒收後上層資料夾 root/nul-<op> 須不存在
    shapes.push({
        name: 'nul',
        storageOf: (op) => path.join(root, `nul-${op}`, 'a\u0000b.sqlite'),
        kind: 'ctor',
        why: 'invalid opt.storage: string contains NUL',
        sideDirOf: (op) => path.join(root, `nul-${op}`),
        sideDirCreated: false,
    })

    //對照組(各函數各用獨立之 storage, 因各子行程並行執行)
    shapes.push({ name: 'normalFile', storageOf: (op) => path.join(root, `ok-${op}.sqlite`), kind: 'ok' })
    shapes.push({ name: 'parentCreatable', storageOf: (op) => path.join(root, `p1-${op}`, 'p2', 'x.sqlite'), kind: 'ok' })
}


let results = {} //`${shape}/${op}` -> 子行程結果
let blast = {} //R19-2
let again = {} //R19-2b


//expect, 單一(形態, 函數)之預期
function check(shape, op, R) {
    let msg = `${shape.name}/${op}: ${JSON.stringify(R.rs)} stderr[${R.errBuf.slice(0, 200)}]`
    assert.strictEqual(R.backstop, false, `外層逾時: 子行程被終止(懸置且迴圈被撐住) ${msg}`)
    assert.ok(R.rs.length >= 1, `無結果 ${msg}`)

    //對照組: 前置之createStorage與所測函數皆resolve
    let last = R.rs.filter((o) => o.op === op).pop()
    assert.ok(last, `缺本步驟結果 ${msg}`)
    assert.notStrictEqual(last.state, 'pending', `pending(懸置: 永不settle) ${msg}`)

    //建構時拒收(R20-9): 本步驟(含 initClose、txClose, 其實例建構即失敗)reject 為固定詞彙, 不得 resolve
    if (shape.kind === 'ctor') {
        assert.strictEqual(last.state, 'reject', `建構時拒收之 storage 不得 resolve ${msg}`)
        assert.strictEqual(last.message, shape.why, `應為建構之固定詞彙 ${msg}`)
        return
    }

    if (shape.kind === 'ok') {
        for (let o of R.rs) {
            if (o.done) continue
            assert.strictEqual(o.state, 'resolve', `對照組應resolve ${msg}`)
        }
        if (op === 'initClose') {
            assert.strictEqual(last.value.closed, true)
        }
        return
    }

    //開啟失敗: 失敗以既有通道回報(batch reject; 逐筆函數於非連線層錯誤時逐筆ok為0)
    if (op === 'initClose') {
        assert.strictEqual(last.state, 'resolve', `init之close須settle(resolve) ${msg}`)
        assert.strictEqual(last.value.closed, true)
        assert.strictEqual(last.value.select, 'reject', `以init之實例select應reject ${msg}`)
    }
    else if (op === 'txClose') {
        assert.strictEqual(last.state, 'resolve', `init之close須settle(resolve) ${msg}`)
        assert.strictEqual(last.value.closed, true)
        assert.strictEqual(last.value.tx, 'reject', `genTransaction應reject ${msg}`)
    }
    else if (shape.item && (op === 'save' || op === 'del')) {
        assert.strictEqual(last.state, 'resolve', msg)
        assert.ok(Array.isArray(last.value) && last.value.length === 1 && last.value[0].ok === 0 && typeof last.value[0].err === 'string' && last.value[0].err !== '', `逐筆ok應為0附err ${msg}`)
    }
    else {
        assert.strictEqual(last.state, 'reject', `應reject ${msg}`)
        assert.ok(typeof last.message === 'string' && last.message !== '', `reject之訊息應為非空字串 ${msg}`)
    }
}


describe('sqlite-open', function() {

    before(async function() {
        this.timeout(175000)
        fs.rmSync(root, { recursive: true, force: true })
        addShapes()

        let tasks = []
        for (let shape of shapes) {
            for (let op of OPS) {
                tasks.push(async () => {
                    let storage = shape.storageOf ? shape.storageOf(op) : shape.storage
                    //對照組先建表(createStorage 本身除外)
                    let steps = [{ id: op, op, storage, url: shape.url }]
                    if (shape.kind === 'ok' && op !== 'createStorage') {
                        steps.unshift({ id: 'pre', op: 'createStorage', storage })
                    }
                    results[`${shape.name}/${op}`] = await runScenario(steps, shape.cwdOf ? shape.cwdOf(op) : process.cwd())
                })
            }
        }

        //R19-2: 同一行程先啟動開啟失敗者(bg, 不等待), 其後之正常實例須照常運作
        //(缺陷版: select 懸置而占住模組層級之 pmq 佇列, 其後之 insert、select 排在其後而永不執行)
        let badDir = path.join(root, 'adir')
        let okFile = path.join(root, 'blast.sqlite')
        tasks.push(async () => {
            blast = await runScenario([
                { id: 'bad', op: 'select', storage: badDir, bg: true },
                { id: 'ok1', op: 'createStorage', storage: okFile },
                { id: 'ok2', op: 'insert', storage: okFile },
                { id: 'ok3', op: 'select', storage: okFile },
            ], process.cwd())
        })

        //R19-2b: 同一實例開啟失敗後再呼叫(實例於失敗後已關閉並重置, 重新初始化後仍須 settle)
        tasks.push(async () => {
            again = await runScenario([
                { id: 'r1', op: 'select', storage: badDir },
                { id: 'r2', op: 'select', storage: badDir, reuse: true },
                { id: 'r3', op: 'insert', storage: badDir, reuse: true },
                { id: 'r4', op: 'initClose', storage: badDir, reuse: true },
            ], process.cwd())
        })

        await runLimit(tasks, 4)
    })

    after(function() {
        for (let f of restores) {
            try {
                f()
            }
            catch (err) {}
        }
        fs.rmSync(root, { recursive: true, force: true })
        try {
            fs.rmdirSync('./test/_tmp') //僅在空資料夾時移除
        }
        catch (err) {}
    })


    describe('R19-1/R19-3/R20-9 各形態 × 各函數(失敗者不得懸置; 建構時拒收者 reject 為固定詞彙; 對照組照常)', function() {

        //noPermission: root(POSIX)不受檔案權限拘束, 無法造成開啟失敗, 略過
        let names = ['dir', 'longName', !isRoot ? 'noPermission' : null, 'parentIsFile', 'memory', 'nul', 'normalFile', 'parentCreatable'].filter((v) => v !== null)

        for (let nm of names) {
            for (let op of OPS) {
                it(`${nm} ${op}`, function() {
                    let shape = shapes.find((s) => s.name === nm)
                    assert.ok(shape, `未建立形態 ${nm}`)
                    check(shape, op, results[`${nm}/${op}`])
                })
            }
        }

    })


    describe('R20-9 建構時拒收者不建立任何檔案或資料夾', function() {

        for (let nm of ['memory', 'nul']) {
            for (let op of OPS) {
                it(`${nm} ${op}`, function() {
                    let shape = shapes.find((s) => s.name === nm)
                    assert.ok(results[`${nm}/${op}`].rs.length >= 1, '子行程須有結果')
                    let d = shape.sideDirOf(op)
                    if (shape.sideDirCreated === false) {
                        assert.strictEqual(fs.existsSync(d), false, `不得建立上層資料夾 ${d}`)
                    }
                    else {
                        assert.deepStrictEqual(fs.readdirSync(d), [], `子行程 cwd 須仍為空(不得開出名為 :memory: 之檔) ${d}`)
                    }
                })
            }
        }

    })


    describe('R20-10 opt.storage 於建構時即定為絕對路徑(path.resolve 之位置不因 R20 之判斷而改變)', function() {

        it('相對路徑之 storage 於建構時依當時之 cwd 定位: 建構後再改變 cwd, createStorage 之檔案仍落在建構時之 cwd', async function() {
            let a = path.join(root, 'pin-a')
            let b = path.join(root, 'pin-b')
            fs.mkdirSync(a, { recursive: true })
            fs.mkdirSync(b, { recursive: true })
            let cwd0 = process.cwd()
            try {
                process.chdir(a)
                let w = wo({ url: 'sqlite://:', db: 'worm', cl: 'users', fdModels, storage: './pin.sqlite' })
                process.chdir(b)
                assert.strictEqual(await w.createStorage(), 'created')
            }
            finally {
                process.chdir(cwd0)
            }
            assert.deepStrictEqual(fs.readdirSync(a), ['pin.sqlite'], '檔案落在建構時之 cwd')
            assert.deepStrictEqual(fs.readdirSync(b), [], '其後之 cwd 不得出現檔案')
        })

    })


    describe('R19-2 一次開啟失敗不擋住同行程之其他實例', function() {

        it('先對資料夾 storage select(reject), 其後正常檔 createStorage、insert、select 皆 resolve 且讀得到寫入', function() {
            let R = blast
            let msg = JSON.stringify(R.rs)
            assert.strictEqual(R.backstop, false, `外層逾時 ${msg}`)
            let by = (id) => R.rs.find((o) => o.id === id)
            assert.ok(by('bad'), `缺 bad ${msg}`)
            assert.strictEqual(by('bad').state, 'reject', `bad應reject(非pending) ${msg}`)
            for (let id of ['ok1', 'ok2', 'ok3']) {
                assert.ok(by(id), `缺 ${id} ${msg}`)
                assert.strictEqual(by(id).state, 'resolve', `${id}應resolve(pending者為被前一個懸置擋在全域佇列之後) ${msg}`)
            }
            assert.strictEqual(by('ok3').value.length, 1, msg)
            assert.ok(R.rs.some((o) => o.done), `行程未走完 ${msg}`)
        })

    })


    describe('R19-2b 同一實例開啟失敗後再呼叫', function() {

        it('同一實例連續 select、select、insert、initClose 於資料夾 storage 皆 settle: 前三者 reject, initClose resolve 且其內 select 為 reject', function() {
            let R = again
            let msg = JSON.stringify(R.rs)
            assert.strictEqual(R.backstop, false, `外層逾時 ${msg}`)
            let by = (id) => R.rs.find((o) => o.id === id)
            for (let id of ['r1', 'r2', 'r3']) {
                assert.ok(by(id), `缺 ${id} ${msg}`)
                assert.strictEqual(by(id).state, 'reject', `${id}應reject(pending為懸置) ${msg}`)
            }
            assert.ok(by('r4'), `缺 r4 ${msg}`)
            assert.strictEqual(by('r4').state, 'resolve', msg)
            assert.deepStrictEqual(by('r4').value, { select: 'reject', closed: true }, msg)
            assert.ok(R.rs.some((o) => o.done), `行程未走完 ${msg}`)
        })

    })


    describe('R19-4 reject 之訊息與輸出不帶連線憑證', function() {

        it('dir(url 含帳密)之各函數之結果與子行程輸出皆不含密碼與帳號:密碼', function() {
            let n = 0
            for (let op of OPS) {
                let R = results[`dir/${op}`]
                let text = JSON.stringify(R.rs) + R.others.join('\n') + R.errBuf
                assert.ok(text.indexOf(PW) < 0, `${op} 輸出含密碼: ${text.slice(0, 300)}`)
                assert.ok(text.indexOf(`${USER}:${PW}`) < 0, `${op} 輸出含帳號:密碼`)
                n += R.rs.length
            }
            assert.ok(n >= OPS.length, `結果數過少: ${n}`)
        })

    })

})

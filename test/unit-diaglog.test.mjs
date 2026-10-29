import fs from 'fs'
import assert from 'assert'
import getSqlStmt from '../src/getSqlStmt.mjs'
import mergeOptLog from '../src/mergeOptLog.mjs'
import { ownErr, markOwnErr, isOwnErr } from '../src/ownErr.mjs'


//rulebook R17(診斷輸出依dspec〈診斷輸出與遮罩〉與wsemi之R-DIAG-01): 本檔為不連線之單元測試
//  遮罩、拷貝、摘要、出口之形態由wsemi之共用語料(_diagCases.mjs)於wsemi內測; 本套件之接線見api-diaglog-wire、api-diaglog、api-diaglog-gen
//  本檔: ①原始碼盤點(站點全集與處置不得漂移: 自寫遮罩已刪、label為固定詞彙、整批reject與逐筆err之處置、固定詞彙錯誤之登記) ②本套件留存之小函數getSqlStmt、mergeOptLog、ownErr


let ID = 'u-secret-001@example.com'


//src, 讀src之檔案(註解以空白取代, 保留行號): 區塊註解只認行首之/*(JSDoc), 行內//註解中出現之/*(如://***)不視為區塊註解起點
let src = (f) => {
    let s = fs.readFileSync(`./src/${f}`, 'utf8')
    s = s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ' '))
    return s.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, ''))
}


//srcFiles, src下之程式檔
let srcFiles = () => fs.readdirSync('./src').filter((f) => /\.(mjs|js)$/.test(f))


//LABELS, diag之固定標籤全集(R-DIAG-01: label只用固定識別字, 不以呼叫端或後端之值組成)
let LABELS = [
    'sql',
    'change handler threw',
    'error handler threw',
    'can not import model',
    '@journeyapps/sqlcipher can not support transaction.',
    'generate file:',
    'save file catch',
    'Can not use TEXT type for primary key. It will change type to STRING automatically.',
]


describe('原始碼盤點(R17、R-DIAG-01)', function() {

    it('自寫之遮罩與診斷函數已刪除, 改用wsemi(≥1.9.31)之getDiag、getDiagSecrets、maskDiagUrl', function() {
        assert.ok(!fs.existsSync('./src/getDiag.mjs'), 'src/getDiag.mjs應已刪除')
        let bads = []
        for (let f of srcFiles()) {
            src(f).forEach((line, k) => {
                if (/\b(function|let|const)\s+(getOptLog|getSecrets|maskText|maskUrl|cpMask|getBriefErr|swallow|maskSafe|getNums)\b|RE_URL_CRED|RE_PRAGMA_KEY|STACK_GETTER/.test(line)) {
                    bads.push(`${f}:${k + 1} ${line.trim()}`)
                }
            })
        }
        assert.deepStrictEqual(bads, [], `src內仍有自寫之遮罩實作:\n${bads.join('\n')}`)
        let s = fs.readFileSync('./src/WOrmReladb.mjs', 'utf8')
        for (let m of ['getDiag', 'getDiagSecrets', 'maskDiagUrl']) {
            assert.ok(s.indexOf(`import ${m} from 'wsemi/src/${m}.mjs'`) >= 0, `WOrmReladb.mjs未自wsemi引入${m}`)
        }
        assert.ok(fs.readFileSync('./src/genModelsByTabs.mjs', 'utf8').indexOf('import getDiag from \'wsemi/src/getDiag.mjs\'') >= 0)
        let v = JSON.parse(fs.readFileSync('./node_modules/wsemi/package.json', 'utf8')).version.split('.').map(Number)
        assert.ok(v[0] > 1 || (v[0] === 1 && (v[1] > 9 || (v[1] === 9 && v[2] >= 31))), `wsemi版本須≥1.9.31: ${v.join('.')}`)
        assert.ok(/"wsemi": "\^1\.9\.(3[1-9]|[4-9]\d)/.test(fs.readFileSync('./package.json', 'utf8')), 'package.json之wsemi依賴下限須≥1.9.31')
    })

    it('diag之label皆為固定詞彙(字串字面值, 屬LABELS); 不帶舊參數bare/method(至多3個引數); genModelsByDB之label經固定對照表', function() {
        let bads = []
        let used = new Set()
        for (let f of srcFiles()) {
            src(f).forEach((line, k) => {
                if (!/\bdiag\(/.test(line)) {
                    return
                }
                let m = line.match(/\bdiag\(\s*(['`])((?:(?!\1).)*)\1\s*(,|\))/)
                if (m === null || m[2].indexOf('${') >= 0 || LABELS.indexOf(m[2]) < 0) {
                    bads.push(`${f}:${k + 1} ${line.trim()}`)
                    return
                }
                used.add(m[2])
                //引數個數: 第4個引數(舊bare/method)不得出現; 以頂層逗號數判定(本套件之diag呼叫皆單行)
                let rest = line.slice(line.indexOf(m[0]) + 'diag('.length)
                let depth = 0
                let commas = 0
                for (let ch of rest) {
                    if ('([{'.indexOf(ch) >= 0) {
                        depth++
                    }
                    else if (')]}'.indexOf(ch) >= 0) {
                        if (depth === 0) {
                            break
                        }
                        depth--
                    }
                    else if (ch === ',' && depth === 0) {
                        commas++
                    }
                }
                if (commas > 2) {
                    bads.push(`${f}:${k + 1} (第4引數) ${line.trim()}`)
                }
            })
        }
        assert.deepStrictEqual(bads, [], `下列diag呼叫之label非固定詞彙或帶第4引數:\n${bads.join('\n')}`)
        assert.deepStrictEqual([...used].sort(), [...LABELS].sort(), '固定標籤全集與src不符')
        let s = fs.readFileSync('./src/WOrmReladb.mjs', 'utf8')
        assert.ok(/'sql': 'genModelsByDB sql',\s*'foreign keys catch': 'genModelsByDB foreign keys catch',\s*'tables catch': 'genModelsByDB tables catch',/.test(s), 'genModelsByDB之固定標籤對照表')
        assert.ok(s.indexOf(': \'genModelsByDB diag\'') >= 0)
        assert.ok(s.indexOf('diagCall(lb, safe,') >= 0 && s.split('diagCall(').length - 1 === 1, 'diagCall只以對照後之lb呼叫')
    })

    it('整批reject之7個catch站點皆經outErr; error事件與reject同值(emitError之err即res)', function() {
        let s = fs.readFileSync('./src/WOrmReladb.mjs', 'utf8').replace(/\r\n/g, '\n')
        let n = (re) => (s.match(re) || []).length
        assert.strictEqual(n(/catch \(err\) \{\n\s*isErr = true\n\s*res = outErr\(err, si\)/g), 7)
        assert.strictEqual(n(/isErr = true\n\s*res = err\b/g), 0, '整批catch站點不得原樣交出外來值')
        for (let mode of ['select', 'selectByPk', 'insert', 'insertBulk', 'save', 'del', 'delAll']) {
            let re = new RegExp(`if \\(isErr\\) \\{\\n\\s*emitError\\('${mode}', [a-z]+, res\\)\\n\\s*return Promise\\.reject\\(res\\)`)
            assert.ok(re.test(s), `${mode}之error事件與reject須同為res`)
        }
    })

    it('逐筆err之外來值於建立時經diag.mask(save之saveOne、del), 本套件之固定詞彙(bads[k]、invalid data…、can not save…)原樣', function() {
        let s = fs.readFileSync('./src/WOrmReladb.mjs', 'utf8')
        assert.strictEqual(s.split('err: diag.mask(getErrMsg(err)),').length - 1, 2)
        assert.strictEqual(s.split('err: getErrMsg(').length - 1, 0, '逐筆err不得原樣取外來值之訊息')
        let errs = s.match(/^\s*err: .*$/gm).map((v) => v.trim())
        /* eslint-disable no-template-curly-in-string */ //比對src之原始碼文字(含樣板字串之${})
        assert.deepStrictEqual(errs.sort(), [
            'err: `can not save data[${k}].${opt.pk} in ${nTry} tries`,',
            'err: `invalid data[${k}].${opt.pk}, type does not match pk column`,',
            'err: `invalid data[${k}].${opt.pk}`,',
            'err: bads[k],',
            'err: bads[k],',
            'err: diag.mask(getErrMsg(err)),',
            'err: diag.mask(getErrMsg(err)),',
        ].sort())
        /* eslint-enable no-template-curly-in-string */
    })

    it('reject與throw之站點全集: 外來值經diag.err(5處), 固定詞彙不包; 可經catch站點交出之本套件錯誤皆以ownErr/markOwnErr登記', function() {
        let lines = src('WOrmReladb.mjs')
        let rej = []
        let err = []
        let thr = []
        lines.forEach((line) => {
            for (let m of line.matchAll(/(?:Promise|pm)\.reject\(([^)]*\)?)\)/g)) {
                rej.push(m[0])
            }
            if (line.indexOf('diag.err(') >= 0) {
                err.push(line.trim())
            }
            let t = line.match(/\bthrow\s+(.*)$/)
            if (t !== null) {
                thr.push(t[1].replace(/\(.*$/, '(').trim())
            }
        })
        assert.deepStrictEqual(rej.sort(), [
            'Promise.reject(\'invalid sequelize\')', //固定詞彙
            'Promise.reject(diag.err(err))', //snap: 呼叫端數據之getter拋錯
            'Promise.reject(err)', //selectByPk: procClosed之固定詞彙
            ...Array(7).fill('Promise.reject(res)'), //整批: res已經outErr
            'pm.reject(si.err)', //createStorage: model載入失敗之固定詞彙
        ].sort())
        assert.deepStrictEqual(err.sort(), [
            'return Promise.reject(diag.err(err))',
            'return own ? err : diag.err(err)',
            'throw diag.err(errSeq)',
            'throw diag.err(err)',
            'throw diag.err(err)',
        ].sort())
        //throw new Error只留建構期之同步檢查(opt之孤立代理碼元、throwUrlErr), 其餘本套件錯誤以ownErr登記; 其他throw為重拋(err、si.err)或diag.err
        assert.deepStrictEqual(thr.filter((v) => v === 'new Error(').length, 2)
        assert.ok(thr.every((v) => ['new Error(', 'ownErr(', 'diag.err(', 'err', 'si.err'].indexOf(v) >= 0), thr.join('|'))
        let cv = src('cvFind.mjs')
        assert.strictEqual(cv.filter((v) => /throw new Error\(/.test(v)).length, 0, 'cvFind之錯誤須以ownErr登記')
        assert.strictEqual(cv.filter((v) => /throw ownErr\(/.test(v)).length, 3)
        assert.strictEqual(cv.filter((v) => /throw markOwnErr\(e\)/.test(v)).length, 1)
    })

})


describe('getSqlStmt', function() {

    it('R17-1 只取敘述種類(白名單), 不含表名與值', function() {
        assert.strictEqual(getSqlStmt(`Executing (default): SELECT * FROM t WHERE id = '${ID}'`), 'SELECT')
        assert.strictEqual(getSqlStmt('Executing (3f2c-aa): insert into t values ($1)'), 'INSERT')
        assert.strictEqual(getSqlStmt('Executing (default): UPDATE t SET a=$1'), 'UPDATE')
        assert.strictEqual(getSqlStmt('Executing (default): DELETE FROM t'), 'DELETE')
        assert.strictEqual(getSqlStmt('Executing (default): PRAGMA key = \'u:p\''), 'PRAGMA')
        assert.strictEqual(getSqlStmt('BEGIN TRANSACTION;'), 'BEGIN')
        assert.strictEqual(getSqlStmt(`Executing (default): ${ID} oops`), 'OTHER')
        assert.strictEqual(getSqlStmt('Executing (default): '), 'OTHER')
        assert.strictEqual(getSqlStmt(null), 'OTHER')
        assert.strictEqual(getSqlStmt({ a: 1 }), 'OTHER')
    })

})


describe('mergeOptLog(R17-7a, 建構時之快照與單次呼叫覆寫)', function() {

    let base = () => ({ logging: false, logDetail: false, funLog: null })
    let fc = () => {}
    let fb = () => {}

    it('R17-7a 單次未給或opt非物件者: 回傳base之副本(不同參照, 不改動base)', function() {
        for (let o of [undefined, null, 1, 'x', true, {}]) {
            let b = { logging: true, logDetail: true, funLog: fb }
            let r = mergeOptLog(b, o)
            assert.deepStrictEqual(r, { logging: true, logDetail: true, funLog: fb }, String(o))
            assert.notStrictEqual(r, b)
        }
    })

    it('R17-7a logging、logDetail為布林者覆寫(true與false皆可), funLog為函數者覆寫', function() {
        assert.deepStrictEqual(mergeOptLog(base(), { logging: true, logDetail: true, funLog: fc }), { logging: true, logDetail: true, funLog: fc })
        let b = { logging: true, logDetail: true, funLog: fb }
        assert.deepStrictEqual(mergeOptLog(b, { logging: false, logDetail: false, funLog: fc }), { logging: false, logDetail: false, funLog: fc })
    })

    it('R17-7a 型別錯誤者沿用base(不放寬也不關閉): logging、logDetail非布林, funLog非函數', function() {
        let b = { logging: true, logDetail: true, funLog: fb }
        for (let v of ['true', 'false', 1, 0, null, {}, [], fc]) {
            assert.deepStrictEqual(mergeOptLog(b, { logging: v, logDetail: v }), b, String(v))
        }
        for (let v of ['x', 1, true, null, {}, []]) {
            assert.deepStrictEqual(mergeOptLog(b, { funLog: v }), b, String(v))
        }
        let c = base()
        for (let v of ['true', 1, {}]) {
            assert.deepStrictEqual(mergeOptLog(c, { logging: v, logDetail: v }), c, String(v))
        }
    })

    it('R17-7a 各選項分別讀取: 單一選項getter拋錯只丟該選項, 不連累其餘有效選項', function() {
        let o = {
            get logging() {
                throw new Error('x')
            },
            logDetail: true,
            funLog: fc
        }
        assert.deepStrictEqual(mergeOptLog({ logging: true, logDetail: false, funLog: null }, o), { logging: true, logDetail: true, funLog: fc })
        let o2 = {
            logging: true,
            get logDetail() {
                throw new Error('x')
            },
            get funLog() {
                throw new Error('y')
            }
        }
        assert.deepStrictEqual(mergeOptLog({ logging: false, logDetail: true, funLog: fb }, o2), { logging: true, logDetail: true, funLog: fb })
    })

})


describe('ownErr(本套件固定詞彙錯誤之登記)', function() {

    it('ownErr產生Error並登記; 未登記之Error、字串與其他值皆非本套件之錯誤', function() {
        let e = ownErr('invalid find: x')
        assert.ok(e instanceof Error && Object.getPrototypeOf(e) === Error.prototype)
        assert.strictEqual(e.message, 'invalid find: x')
        assert.strictEqual(isOwnErr(e), true)
        for (let v of [new Error('invalid find: x'), 'invalid find: x', null, undefined, 1, {}]) {
            assert.strictEqual(isOwnErr(v), false, String(v))
        }
    })

    it('markOwnErr登記既有物件並回傳同一物件; 原始值原樣回傳且不登記', function() {
        let e = new Error('invalid find: y')
        assert.strictEqual(markOwnErr(e), e)
        assert.strictEqual(isOwnErr(e), true)
        assert.strictEqual(markOwnErr('s'), 's')
        assert.strictEqual(markOwnErr(null), null)
        assert.strictEqual(isOwnErr('s'), false)
    })

})

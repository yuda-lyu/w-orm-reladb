/* eslint-disable no-new-wrappers */ //包裝物件(new String、new Number、new Boolean)為被測之輸入, 非筆誤
import fs from 'fs'
import assert from 'assert'
import wo from '../src/WOrmReladb.mjs'
import genModelsByTabs from '../src/genModelsByTabs.mjs'
import { chkWf } from '../src/cvFind.mjs'
import { HOSTILE, GIVEN_BAD, NOT_GIVEN, ABSENT, mkRevoked, mkTagThrow, mkKeysThrow, mkGetTrapAll, mkGetTrapStr, msgOf } from './tools/hostile.mjs'


//第557項(rulebook R22、R23)之不連線測試: 建構(opt容器與成員)、genModelsByTabs、chkWf之strictPk、站點盤點(原始碼掃描)
//規格句(共同規則一、二、四): 主鍵[給了而非字串或有限數字]一律拒絕, [未帶]只有undefined、null、空字串; 讀取即拋錯之輸入依原失敗通道(建構與genModelsByTabs為同步throw)拒絕,
//訊息固定詞彙invalid <名稱>: must be a readable value, 不含原例外文字; 判斷函數(isestr、isbol、iseobj、isearr)回false之後才以chkReadable分辨[不可讀]與[型別不符];
//可讀而型別不符者照既有處理(用預設等)、存取器拋錯維持原錯誤文字


let dir = './test/_tmp/readable-unit'
let gm = `${dir}/gm`

let MSG = (k) => `invalid id: not a string or finite number at [data[${k}].id]`
let FIX = (name) => `invalid ${name}: must be a readable value`

//建構之最小有效設定(不連線、不建立任何檔案)
let baseOpt = () => ({ url: 'sqlite://:', db: 'worm', cl: 'users', fdModels: './models', storage: `${dir}/x.sqlite` })

let STR_MEMBERS = ['url', 'db', 'cl', 'fdModels', 'modelType', 'pk', 'storage']
let BOL_MEMBERS = ['autoGenPk', 'useStable', 'useEncryption']


describe('建構: opt容器與成員之可讀性(R23)', function() {

    before(function() {
        fs.mkdirSync(dir, { recursive: true })
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.rmSync('./models/zz557.js', { force: true }) //修前版本對不可讀之fd會寫入預設資料夾, 此處保險清除
    })

    for (let m of [...STR_MEMBERS, ...BOL_MEMBERS]) {
        for (let [vn, f] of [['revoked', mkRevoked], ['tagThrow', mkTagThrow]]) {
            it(`opt.${m}為${vn}: 同步throw固定詞彙(不被當成未給而用預設), 不含原例外文字`, function() {
                //R23.1/R23.2: isestr、isbol判為無效後以chkReadable分辨, 不可讀者拒絕
                let o = { ...baseOpt(), [m]: f() }
                assert.throws(() => wo(o), (err) => {
                    assert.strictEqual(msgOf(err), FIX(`opt.${m}`))
                    assert.ok(msgOf(err).indexOf('SECRET') < 0)
                    return true
                })
            })
        }

        it(`opt.${m}為可讀而型別不符之值(ownKeys拋錯、5、new String、null、空字串、${BOL_MEMBERS.includes(m) ? '字串x、new Boolean' : 'true'}): 照既有行為用預設, 不拒絕`, function() {
            //R23.2: 可讀而型別不符者行為不變
            let vs = [mkKeysThrow(), 5, new String('a'), null, '']
            vs.push(...(BOL_MEMBERS.includes(m) ? ['x', new Boolean(true)] : [true]))
            for (let v of vs) {
                let o = { ...baseOpt(), [m]: v }
                let w = wo(o)
                assert.strictEqual(typeof w.select, 'function')
            }
        })

        it(`opt.${m}為存取器且拋錯: 於讀取處捕捉並轉固定詞彙(不含原例外文字)`, function() {
            //R23.3(共同規則四.2, 主控05:5x更正): 存取器拋出之文字由呼叫端之物件決定(V20), 轉固定詞彙, 照原通道(同步throw)拒絕
            let o = baseOpt()
            Object.defineProperty(o, m, {
                get() {
                    throw new Error('GETTER-SECRET-557-' + m)
                },
                enumerable: true,
            })
            assert.throws(() => wo(o), (err) => msgOf(err) === FIX(`opt.${m}`) && msgOf(err).indexOf('SECRET') < 0)
        })
    }

    it('opt.logging為存取器且拋錯: 同樣轉固定詞彙invalid opt.logging', function() {
        //R23.3: 非判斷函數站點之讀取(=== true), 存取器拋錯亦於讀取處轉固定詞彙
        let o = Object.defineProperty(baseOpt(), 'logging', {
            get() {
                throw new Error('GETTER-SECRET-557')
            },
            enumerable: true,
        })
        assert.throws(() => wo(o), (err) => msgOf(err) === FIX('opt.logging'))
    })

    it('opt本身為已撤銷之Proxy或get陷阱全拋錯者: 同步throw invalid opt固定詞彙', function() {
        //R23.2(共同規則四.1): 容器不可讀, 名稱用容器名opt
        for (let f of [mkRevoked, mkGetTrapAll]) {
            assert.throws(() => wo(f()), (err) => msgOf(err) === FIX('opt') && msgOf(err).indexOf('SECRET') < 0)
        }
    })

    it('opt容器可讀而成員存取拋錯(get陷阱只對字串鍵拋錯, 同存取器拋錯)轉固定詞彙invalid opt.<成員>, 不含原例外文字', function() {
        //R23.3(共同規則四.2)
        assert.throws(() => wo(mkGetTrapStr()), (err) => msgOf(err) === FIX('opt.url') && msgOf(err).indexOf('SECRET') < 0)
    })

    it('opt為可讀之值(標籤拋錯、ownKeys拋錯物件)行為不變(成員讀取不受影響, 建構成功); null與5維持原TypeError', function() {
        //R23.2: 可讀而不合格者照既有處理; 原始值之拋錯文字不變(未納入本規則)
        assert.strictEqual(typeof wo(Object.assign(mkTagThrow(), baseOpt())).select, 'function')
        assert.throws(() => wo(null), (err) => err instanceof TypeError && msgOf(err).indexOf('Cannot read properties of null') >= 0)
        assert.throws(() => wo(5), (err) => err instanceof TypeError)
    })

    it('有效輸入不多讀: 建構各成員之讀取次數不超過修前(url 4、db 2、cl 2、fdModels 1、modelType 1、pk 1、storage 5、autoGenPk 1、useStable 2、useEncryption 2)', function() {
        //R23.1: 探針只置於判斷函數回false之後; 修前之次數以HEAD實測(各成員以計數存取器建構, tmp/oro557g/reads.mjs)
        let max = { url: 4, db: 2, cl: 2, fdModels: 1, modelType: 1, pk: 1, storage: 5, autoGenPk: 1, useStable: 2, useEncryption: 2 }
        let vals = { url: 'sqlite://:', db: 'worm', cl: 'users', fdModels: './models', modelType: 'js', pk: 'id', storage: `${dir}/x.sqlite`, autoGenPk: true, useStable: true, useEncryption: false }
        for (let [m, lim] of Object.entries(max)) {
            let n = 0
            let v = vals[m]
            let o = baseOpt()
            Object.defineProperty(o, m, {
                get() {
                    n++
                    return v
                },
                set(x) {
                    v = x
                },
                enumerable: true,
                configurable: true,
            })
            wo(o)
            assert.ok(n >= 1 && n <= lim, `opt.${m}讀取${n}次(上限${lim})`)
        }
    })

    it('不可讀之建構失敗不留任何副作用(不建立storage之檔案與資料夾)', function() {
        //R23.2: 建構同步拋錯、先於任何開檔
        let o = { ...baseOpt(), storage: `${dir}/never/x.sqlite`, cl: mkRevoked() }
        assert.throws(() => wo(o))
        assert.strictEqual(fs.existsSync(`${dir}/never`), false)
    })

})


describe('genModelsByTabs: fd、tabs、opt與欄位型別之可讀性(R23)', function() {

    let name = 'zz557'

    before(function() {
        fs.mkdirSync(dir, { recursive: true })
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.rmSync(`./models/${name}.js`, { force: true }) //修前版本對不可讀之fd會寫入預設資料夾./models, 此處保險清除
    })

    it('有效輸入不變: 產生models檔', function() {
        genModelsByTabs(gm, { [name]: { f1: 'STRING', f2: { type: 'INTEGER', pk: true } } })
        let c = fs.readFileSync(`${gm}/${name}.js`, 'utf8')
        assert.ok(c.indexOf('DataTypes.STRING') >= 0 && c.indexOf('DataTypes.INTEGER') >= 0)
    })

    for (let [vn, f] of [['revoked', mkRevoked], ['tagThrow', mkTagThrow]]) {
        it(`fd為${vn}: 同步throw invalid fd, 不寫入預設資料夾./models`, function() {
            //R23.1: isestr判為無效後分辨不可讀, 不被當成未給而寫入預設./models
            assert.throws(() => genModelsByTabs(f(), { [name]: { f1: 'STRING' } }), (err) => msgOf(err) === FIX('fd'))
            assert.strictEqual(fs.existsSync(`./models/${name}.js`), false, '不得寫入預設資料夾')
        })
    }

    it('fd為可讀而型別不符之值(5、null、undefined、空字串、ownKeys拋錯): 照既有行為用預設資料夾(以空tabs驗證, 不寫檔)', function() {
        for (let v of [5, null, undefined, '', mkKeysThrow()]) {
            assert.doesNotThrow(() => genModelsByTabs(v, {}))
        }
    })

    for (let [vn, f] of Object.entries(HOSTILE)) {
        it(`tabs為${vn}: 同步throw invalid tabs, 不產生任何檔案`, function() {
            //R23.1: iseobj判為無效(含空物件)後分辨不可讀(for...in讀取拋錯者iseobj回false)
            assert.throws(() => genModelsByTabs(`${dir}/gm-tabs-${vn}`, f()), (err) => msgOf(err) === FIX('tabs'))
        })

        it(`tabs之欄位型別為${vn}: 同步throw invalid tabs, 不把不可讀之值當型別字串寫入models檔`, function() {
            //R23.1: getFields之iseobj(t)判為無效後分辨不可讀
            assert.throws(() => genModelsByTabs(`${dir}/gm-field-${vn}`, { [name]: { f1: f() } }), (err) => msgOf(err) === FIX('tabs'))
            assert.strictEqual(fs.existsSync(`${dir}/gm-field-${vn}/${name}.js`), false, '失敗不產生該表之檔案')
        })
    }

    it('tabs為可讀而型別不符之值(5、null、undefined、空物件、空陣列): 照既有行為不throw、不產生檔案', function() {
        for (let v of [5, null, undefined, {}, []]) {
            assert.doesNotThrow(() => genModelsByTabs(`${dir}/gm-empty`, v))
        }
        assert.deepStrictEqual(fs.readdirSync(`${dir}/gm-empty`), [])
    })

    it('opt為已撤銷之Proxy: 同步throw invalid opt; 為可讀之值(標籤拋錯、ownKeys拋錯、null、5)照既有行為用預設型別', function() {
        //R23.2(共同規則四.1)
        assert.throws(() => genModelsByTabs(`${dir}/gm-opt`, {}, mkRevoked()), (err) => msgOf(err) === FIX('opt'))
        for (let v of [mkTagThrow(), mkKeysThrow(), null, 5]) {
            assert.doesNotThrow(() => genModelsByTabs(`${dir}/gm-opt`, {}, v))
        }
    })

    it('opt.type為存取器且拋錯: 轉固定詞彙invalid opt.type(不含原例外文字)', function() {
        //R23.3(共同規則四.2)
        let o = Object.defineProperty({}, 'type', {
            get() {
                throw new Error('GETTER-SECRET-557-type')
            },
        })
        assert.throws(() => genModelsByTabs(`${dir}/gm-opt`, {}, o), (err) => msgOf(err) === FIX('opt.type'))
    })

    it('tabs之成員為存取器且拋錯、欄位型別描述物件之成員為存取器且拋錯: 轉固定詞彙invalid tabs, 不產生任何檔案', function() {
        //R23.3(共同規則四.2)
        let t1 = Object.defineProperty({}, name, {
            get() {
                throw new Error('GETTER-SECRET-557-tab')
            },
            enumerable: true,
        })
        assert.throws(() => genModelsByTabs(`${dir}/gm-acc1`, t1), (err) => msgOf(err) === FIX('tabs'))
        let t2 = {
            [name]: {
                f1: Object.defineProperty({}, 'type', {
                    get() {
                        throw new Error('GETTER-SECRET-557-type')
                    },
                    enumerable: true,
                })
            }
        }
        assert.throws(() => genModelsByTabs(`${dir}/gm-acc2`, t2), (err) => msgOf(err) === FIX('tabs'))
        let t3 = {
            [name]: Object.defineProperty({}, 'f1', {
                get() {
                    throw new Error('GETTER-SECRET-557-field')
                },
                enumerable: true,
            })
        }
        assert.throws(() => genModelsByTabs(`${dir}/gm-acc3`, t3), (err) => msgOf(err) === FIX('tabs'))
        for (let d of ['gm-acc1', 'gm-acc2', 'gm-acc3']) {
            assert.strictEqual(fs.existsSync(`${dir}/${d}`), false, `${d}: 失敗不建立資料夾`)
        }
    })

    it('多表: 後一表之欄位型別不可讀時整體失敗, 前一表亦不寫出(不留下部分產出), 不建立資料夾', function() {
        //R23(無殘留): 全部資料表先讀取與正規化, 才建立資料夾與寫檔
        let d = `${dir}/gm-multi`
        assert.throws(() => genModelsByTabs(d, { good557: { a: 'STRING' }, [name]: { f: mkRevoked() } }), (err) => msgOf(err) === FIX('tabs'))
        assert.strictEqual(fs.existsSync(d), false)
        genModelsByTabs(d, { good557: { a: 'STRING' }, [name]: { f: 'INTEGER' } })
        assert.deepStrictEqual(fs.readdirSync(d).sort(), [`${name}.js`, 'good557.js'].sort())
    })

})


describe('chkWf之strictPk(R22)', function() {

    let one = (id, strict, withData = false) => chkWf([id === ABSENT ? { name: 'n' } : { id, name: 'n' }], 'id', withData, strict)

    for (let [vn, f] of Object.entries(GIVEN_BAD)) {
        it(`id為${vn}: strictPk為true拒絕(固定詞彙、不回顯值); 預設(false)與第557項以前相同(不拒絕)`, function() {
            assert.deepStrictEqual(one(f(), true), [MSG(0)])
            assert.deepStrictEqual(one(f(), false), [null], '預設行為不變(del使用)')
            assert.deepStrictEqual(one(f(), undefined), [null])
        })
    }

    for (let [vn, f] of Object.entries(NOT_GIVEN)) {
        it(`id為${vn}(未帶): 不論strictPk皆不拒絕(交procPk處置)`, function() {
            assert.deepStrictEqual(one(f(), true), [null])
            assert.deepStrictEqual(one(f(), false), [null])
        })
    }

    it('有效主鍵不拒絕且不被改寫: 字串、有限數字(含0、負數、小數); 包裝物件不拆包裝(見GIVEN_BAD之strObj、numObj)', function() {
        for (let v of ['a', 0, -3, 1.5]) {
            let d = [{ id: v }]
            assert.deepStrictEqual(chkWf(d, 'id', true, true), [null])
            assert.strictEqual(d[0].id, v, '原始值原樣')
        }
        for (let v of [new String('s'), new Number(7)]) {
            let d = [{ id: v }]
            assert.deepStrictEqual(chkWf(d, 'id', false, true), [MSG(0)], '包裝物件為物件, 拒絕')
            assert.strictEqual(d[0].id, v, '不拆包裝、不寫回')
        }
    })

    it('不讀取物件主鍵之任何成員: revoked、tagThrow、ownKeys拋錯者於strictPk皆拒絕(同詞彙), 非strictPk回null而不拋錯(只收原始值, 不拆包裝故不讀標籤)', function() {
        //共同規則一第6點: 物件一律為[給了而非字串或有限數字]; 不拆包裝即不讀取標籤與valueOf
        for (let f of [mkRevoked, mkTagThrow, mkKeysThrow]) {
            assert.deepStrictEqual(one(f(), true), [MSG(0)])
            assert.deepStrictEqual(one(f(), false), [null])
        }
    })

    it('包裝物件之valueOf拋錯: 不呼叫valueOf(strictPk拒絕、非strictPk回null); 主鍵經存取器取得而拋錯: strictPk轉固定詞彙(不含原例外文字); 非strictPk維持原錯誤', function() {
        //R23.3(共同規則四.2): 使用端方法/存取器拋出之文字由呼叫端決定, 不外帶
        let n = 0
        let p = Object.assign(new String('a'), {
            valueOf() {
                n++
                throw new Error('VALUEOF-SECRET-557')
            },
        })
        assert.deepStrictEqual(one(p, true), [MSG(0)])
        assert.deepStrictEqual(one(p, false), [null])
        assert.strictEqual(n, 0, '不拆包裝, 不呼叫valueOf')
        let o = Object.create({
            get id() {
                throw new Error('GETTER-SECRET-557')
            },
        })
        assert.deepStrictEqual(chkWf([o], 'id', false, true), [MSG(0)])
        assert.throws(() => chkWf([o], 'id', false), (err) => msgOf(err) === 'GETTER-SECRET-557')
    })

    it('既有檢核之優先順序不變: 孤立代理碼元與NUL之原因先於型別; 主鍵先於資料', function() {
        assert.deepStrictEqual(one('a\ud800', true), ['invalid id: string contains lone surrogate at [data[0].id]'])
        assert.deepStrictEqual(one('a\0', true), ['invalid id: string contains NUL at [data[0].id]'])
        assert.deepStrictEqual(chkWf([{ id: true, name: 'a\ud800' }], 'id', true, true), [MSG(0)], '主鍵先於資料')
        assert.deepStrictEqual(chkWf([{ id: 'ok', name: 'a\ud800' }], 'id', true, true), ['invalid data: string contains lone surrogate at [data[0].name]'])
    })

    it('逐筆索引與自訂主鍵欄名', function() {
        assert.deepStrictEqual(chkWf([{ id: 'a' }, { id: true }, { id: 'c' }, { id: {} }], 'id', false, true), [null, MSG(1), null, MSG(3)])
        assert.deepStrictEqual(chkWf([{ k: 'a' }, { k: NaN }], 'k', false, true), [null, 'invalid id: not a string or finite number at [data[1].k]'])
    })

})


describe('站點盤點(原始碼掃描, R22、R23)', function() {

    let read = (fp) => fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n')
    let src = read('./src/WOrmReladb.mjs')
    let cv = read('./src/cvFind.mjs')
    let gmt = read('./src/genModelsByTabs.mjs')
    let count = (s, re) => (s.match(re) || []).length

    it('建構: 10個以判斷函數判定呼叫端值之站點(7個isestr、3個isbol)皆經readOpt讀取, 且於判為無效之分支內探針(chkOptReadable)', function() {
        let re = /if \(!(isestr|isbol)\(readOpt\(opt, '(\w+)'\)\)\) \{\n\s+chkOptReadable\(opt, '(\w+)'\)/g
        let hits = [...src.matchAll(re)].map((m) => [m[1], m[2], m[3]])
        assert.deepStrictEqual(hits.map((v) => v[1]), hits.map((v) => v[2]), '探針之成員名須與判斷之成員名一致')
        assert.deepStrictEqual(hits.map((v) => v[1]).sort(), [...STR_MEMBERS, ...BOL_MEMBERS].sort())
        assert.strictEqual(hits.filter((v) => v[0] === 'isestr').length, 7)
        assert.strictEqual(hits.filter((v) => v[0] === 'isbol').length, 3)
        assert.strictEqual(count(src, /\bis(?:estr|bol)\(opt\./g), 0, '建構段不得再以opt.<成員>直接餵判斷函數(須經readOpt)')
        assert.strictEqual(count(src, /readOpt\(opt, 'logging'\)/g), 1, 'opt.logging之讀取亦經readOpt')
    })

    it('寫入入口: 4個iseobj/isearr判為無效之分支內先探針(isUnreadableData), insert另含returnList之讀取', function() {
        assert.strictEqual(count(src, /if \(!iseobj\(data\) && !isearr\(data\)\) \{\n\s+if \(isUnreadableData\(data\)\) \{\n\s+return procUnreadableData\('(insert|insertBulk|save|del)'\)/g), 4)
        for (let mode of ['insert', 'insertBulk', 'save', 'del']) {
            assert.ok(src.indexOf(`return procUnreadableData('${mode}')`) >= 0, mode)
            assert.ok(src.indexOf(`snap('${mode}'`) >= 0, `snap須帶${mode}`)
        }
        assert.strictEqual(count(src, /snap\('(insert|insertBulk|save|del)'/g), 8, 'useStable與非useStable各4處')
        assert.strictEqual(count(src, /return procUnreadableData\(mode\)/g), 1, 'snap之複製拋錯後探針')
    })

    it('option: 各入口之option成員皆經getOpt(單一出口), 原寫法get(option, ...)只留於getOpt內', function() {
        assert.strictEqual(count(src, /\bget\(option, /g), 1, 'get(option,只留getOpt內一處')
        assert.strictEqual(count(src, /\bgetOpt\(option, '(instance|transaction|returnList|autoInsert)'/g), 16)
        for (let mode of ['select', 'selectByPk', 'insert', 'insertBulk', 'save', 'del', 'delAll']) {
            assert.ok(src.indexOf(`return rejectIn('${mode}', err)`) >= 0, `${mode}之入口階段拒絕經rejectIn`)
        }
    })

    it('chkReadable呼叫之全集(探針唯一出處為wsemi, 不自寫探針)', function() {
        assert.strictEqual(count(src, /\bchkReadable\(/g), 6, 'WOrmReladb.mjs: readOpt、chkOptReadable、getOpt、isUnreadableData(2)、selectByPk')
        assert.strictEqual(count(cv, /\bchkReadable\(/g), 0, 'cvFind.mjs: normPk不讀取物件、chkWf之strictPk於讀取處捕捉存取器拋錯, 不需探針')
        assert.strictEqual(count(gmt, /\bchkReadable\(/g), 1, 'genModelsByTabs.mjs: assertReadable')
        for (let s of [src, gmt]) {
            assert.ok(s.indexOf('import chkReadable from \'wsemi/src/chkReadable.mjs\'') >= 0)
        }
        assert.strictEqual(count(src + cv + gmt, /probeReadable|isReadable/g), 0, '不自寫探針')
    })

    it('探針置於判斷函數回false之後: genModelsByTabs之3個iseobj/isestr站點', function() {
        assert.ok(/if \(!isestr\(fd\)\) \{\n\s+assertReadable\(fd, 'fd'\)/.test(gmt))
        assert.ok(/if \(!iseobj\(tabs\)\) \{\n\s+assertReadable\(tabs, 'tabs', \{ ownKeys: true \}\)/.test(gmt))
        assert.ok(/else \{\n\s+assertReadable\(t, 'tabs', \{ ownKeys: true \}\)/.test(gmt))
    })

    it('chkWf之strictPk: insert、insertBulk、save傳true, del不傳(第557項以前之行為不變)', function() {
        assert.strictEqual(count(src, /chkWf\(isarr\(data\) \? data : \[data\], opt\.pk, true, true\)/g), 3)
        assert.strictEqual(count(src, /chkWf\(isarr\(data\) \? data : \[data\], opt\.pk, false\)/g), 1)
    })

    it('selectByPk: normPk判無效之後才以chkReadable分辨不可讀(物件或函數), 轉固定詞彙並經rejectIn; genModelsByDB: 展開option拋錯轉固定詞彙', function() {
        assert.ok(/let r0 = normPk\(pk, 'any'\)\n\s+if \(r0\.kind !== 'ok'\) \{\n\s+if \(pk !== null && \(typeof pk === 'object' \|\| typeof pk === 'function'\) && chkReadable\(pk\) !== ''\) \{\n\s+return rejectIn\('selectByPk', ownErr\(getUnreadableMsg\('pk'\)\)\)\n\s+\}\n\s+return null/.test(src))
        assert.ok(/\.\.\.option,\n\s+\}\n\s+\}\n\s+catch \(err\) \{\n\s+throw ownErr\(getUnreadableMsg\('option'\)\)/.test(src))
    })

    it('getOpt: 容器不可讀 → option, 存取器拋錯 → option.<成員>(皆固定詞彙之ownErr)', function() {
        assert.ok(/if \(chkReadable\(option\) !== ''\) \{\n\s+throw ownErr\(getUnreadableMsg\('option'\)\)\n\s+\}\n\s+throw ownErr\(getUnreadableMsg\(`option\.\$\{key\}`\)\)/.test(src))
    })

})

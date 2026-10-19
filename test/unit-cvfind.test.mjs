import assert from 'assert'
import Sequelize from 'sequelize'
import cvFind, { getColKind, normPk, chkFindShape } from '../src/cvFind.mjs'
import cvOrmFind from 'wsemi/src/cvOrmFind.mjs'
import cvCases from 'wsemi/src/_cvOrmFindCases.mjs'


//cvFind為select與delAll共用之條件轉譯純函數, 本檔不連線資料庫
//斷言分兩類: 拒收(reject之訊息)與方言專屬之SQL片段(ESCAPE、N前綴、LOWER內之實際欄名);
//命中集合之語意由test/api-suite.mjs之find段於sqlite與mssql實際執行斷言, 本檔不以SQL之括號結構作斷言
//第33項批1(R11): 形狀層由wsemi之cvOrmFind單一擁有, 本檔之舊案中屬形狀層者改以其訊息斷言reject, 被移除之功能($not $nor $regex $exists、RegExp、Symbol Op、陣列值等)改為reject案;
//對應CLAUDE_rulebook.md之R1–R6與R8(normPk);「審計02」組為R3欄位引用不變式(斷言SQL含欄名及引用次數, 非括號結構)、R4欄名解析、R4 ctx.dateNoTz


let Op = Sequelize.Op

let defs = {
    'id': { type: Sequelize.STRING, primaryKey: true },
    's': Sequelize.STRING,
    't': Sequelize.TEXT,
    'i': Sequelize.INTEGER,
    'f': Sequelize.FLOAT,
    'p': Sequelize.DOUBLE,
    'dec': Sequelize.DECIMAL(10, 2),
    'b': Sequelize.BOOLEAN,
    'd': Sequelize.DATE,
    'do': Sequelize.DATEONLY,
    'big': Sequelize.BIGINT,
    'length': Sequelize.INTEGER,
    'title': { type: Sequelize.TEXT, field: 'physical_title' },
    'p$x': Sequelize.STRING,
}

//離線之sequelize實例, 建構時不連線
let mk = (dialect, dfs = defs) => {
    let sq = dialect === 'sqlite'
        ? new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
        : new Sequelize('worm', 'u', 'p', { dialect: 'mssql', host: 'localhost', port: 1, logging: false })
    let md = sq.define('tcond', dfs, { tableName: 'tcond', timestamps: false })
    let qg = sq.getQueryInterface().queryGenerator
    let ctx = { escape: (v) => sq.escape(v), attrs: md.rawAttributes, dialect }
    let where = (find, ex = {}) => {
        let sql = qg.selectQuery('tcond', { where: cvFind(find, { ...ctx, ...ex }) }, md)
        let k = sql.indexOf(' WHERE ')
        return k >= 0 ? sql.slice(k + 7).replace(/;$/, '') : ''
    }
    //whereDb, 同where但先經sequelize之mapWhereFieldNames(findAll/destroy實際會做)把屬性名映射為資料庫欄名, 供斷言實際送出之欄名
    let whereDb = (find, ex = {}) => {
        let wh = Sequelize.Utils.mapWhereFieldNames(cvFind(find, { ...ctx, ...ex }), md)
        let sql = qg.selectQuery('tcond', { where: wh }, md)
        let k = sql.indexOf(' WHERE ')
        return k >= 0 ? sql.slice(k + 7).replace(/;$/, '') : ''
    }
    //where0, 同where但不給attrs(欄位型別any、鍵不解析而交資料庫, R4), 供斷言「未給attrs」路徑之SQL(如欄位引用不變式R3)
    let where0 = (find, ex = {}) => {
        let sql = qg.selectQuery('tcond', { where: cvFind(find, { escape: ctx.escape, dialect, ...ex }) }, md)
        let k = sql.indexOf(' WHERE ')
        return k >= 0 ? sql.slice(k + 7).replace(/;$/, '') : ''
    }
    //q, 依方言引用識別字(sqlite為反引號, mssql為方括號), 供斷言SQL文字含某欄名
    let q = (name) => (dialect === 'sqlite' ? `\`${name}\`` : `[${name}]`)
    return { ctx, where, where0, whereDb, q, qg }
}
let LT = mk('sqlite')
let MS = mk('mssql')

let throwsMsg = (fn, msg) => {
    let e = null
    try {
        fn()
    }
    catch (err) {
        e = err
    }
    assert.ok(e !== null, `未拋錯, 應含[${msg}]`)
    assert.ok(String(e.message).indexOf(msg) >= 0, `訊息不含[${msg}]: ${e.message}`)
}

//withTz, 暫時切換主機時區(執行期設定process.env.TZ, Node會重設時區快取), 結束必還原
//還原須以賦值而非delete: Windows上delete process.env.TZ不會還原主機時區(實測仍停在最後設定之時區), 故載入時先記下主機時區名稱
let hostTz = Intl.DateTimeFormat().resolvedOptions().timeZone
let withTz = (tz, fn) => {
    let old = process.env.TZ
    process.env.TZ = tz
    try {
        return fn()
    }
    finally {
        if (old !== undefined) {
            process.env.TZ = old
        }
        else if (process.platform === 'win32') {
            process.env.TZ = hostTz
        }
        else {
            delete process.env.TZ
        }
    }
}


describe('cvFind', function() {

    it('R1 頂層: 未給、undefined、{}、null原型空物件為全部; 非條件物件(null、陣列、純量、非一般物件等)一律reject', function() {
        for (let v of [undefined, {}, Object.create(null)]) {
            assert.deepStrictEqual(cvFind(v, LT.ctx), {})
        }
        class Q {
            constructor() {
                this.s = 'a'
            }
        }
        for (let v of [null, [], [{ id: 'a' }], 'a', 1, true, Object.create({ s: 'a' }), new Q(), new Date(), new Map([['s', 'a']]), /a/]) {
            throwsMsg(() => cvFind(v, LT.ctx), 'invalid find: condition must be a plain object')
        }
        assert.ok(LT.where(Object.assign(Object.create(null), { s: 'a' })).indexOf('`s` = \'a\'') >= 0)
    })

    it('R2 欄名length不得使其他條件失效, 欄名含$不屬欄名文法而reject', function() {
        let w = LT.where({ s: 'x', length: 0 })
        assert.ok(w.indexOf('`s` = \'x\'') >= 0 && w.indexOf('`length` = 0') >= 0, w)
        throwsMsg(() => cvFind({ 'p$x': 'q' }, LT.ctx), 'unsupported column name [p$x]')
    })

    it('R2 Symbol鍵一律reject(sequelize之Op全集、非Op之Symbol、toStringTag皆然): 原Op支援已移除', function() {
        for (let f of [{ i: { [Op.gt]: { x: 1 } } }, { [Op.like]: 'x' }, { [Symbol('or')]: [{ s: 'a' }] }, { i: { [Symbol('gt')]: 1 } }, { i: { [Op.or]: [{ [Op.eq]: 1 }], [Op.gt]: 10 } }, { i: { [Op.or]: [] } }, { i: { [Op.and]: 0 } }, { [Op.and]: [{ s: 'a' }] }, { i: { [Op.in]: [1] } }]) {
            throwsMsg(() => cvFind(f, LT.ctx), 'symbol key is not allowed')
        }
        throwsMsg(() => cvFind({ s: 'a', [Symbol.toStringTag]: 'Q' }, LT.ctx), 'condition must be a plain object')
        //Op全集 × 欄位層與文件層
        let n = 0
        for (let name of Object.keys(Op)) {
            for (let f of [{ i: { [Op[name]]: 1 } }, { [Op[name]]: [{ i: 1 }] }, { i: { $gt: 1, [Op[name]]: 1 } }]) {
                throwsMsg(() => cvFind(f, LT.ctx), 'symbol key is not allowed')
                n++
            }
        }
        assert.ok(n >= 90, `被檢核之案數過少: ${n}`)
    })

    it('R2 同欄多運算子併入同一欄位物件; 不可列舉之鍵reject', function() {
        let w = LT.where({ i: { $gt: 5, $lt: 9 } })
        assert.ok(w.indexOf('`i` > 5') >= 0 && w.indexOf('`i` < 9') >= 0, w)
        let f = {}
        Object.defineProperty(f, 's', { value: 'a', enumerable: false })
        throwsMsg(() => cvFind(f, LT.ctx), 'non-enumerable property is not allowed')
    })

    it('R2 欄名__proto__與空字串拒收', function() {
        throwsMsg(() => cvFind(JSON.parse('{"__proto__":1}'), LT.ctx), 'unsupported column name [__proto__]')
        throwsMsg(() => cvFind({ '': 1 }, LT.ctx), 'unsupported column name []')
    })

    it('R3 不支援之運算子一律拒收', function() {
        let ops = ['$foo', '$like', '$startsWith', '$between', '$col', '$iLike', '$regexp', '$type', '$mod', '$size', '$all', '$elemMatch']
        for (let op of ops) {
            throwsMsg(() => cvFind({ i: { [op]: 1 } }, LT.ctx), `unsupported operator [${op}]`)
        }
        for (let op of ['$not', '$where', '$expr', '$foo', '$comment']) {
            throwsMsg(() => cvFind({ [op]: { i: 1 } }, LT.ctx), `unsupported operator [${op}]`)
        }
    })

    it('R3 邏輯運算子須為非空之物件陣列, 陣列不得有洞, 元素不得為空條件; $nor、$exists已移除', function() {
        for (let op of ['$and', '$or']) {
            throwsMsg(() => cvFind({ [op]: [] }, LT.ctx), `${op} with empty array`)
            throwsMsg(() => cvFind({ [op]: { s: 1 } }, LT.ctx), 'value must be an array')
            throwsMsg(() => cvFind({ [op]: ['x'] }, LT.ctx), 'condition must be a plain object')
            throwsMsg(() => cvFind({ [op]: new Array(2) }, LT.ctx), 'sparse array hole')
            throwsMsg(() => cvFind({ [op]: [{}] }, LT.ctx), 'empty condition')
        }
        throwsMsg(() => cvFind({ $nor: [{ s: 'a' }] }, LT.ctx), 'unsupported operator [$nor]')
        throwsMsg(() => cvFind({ $nor: [] }, LT.ctx), 'unsupported operator [$nor]')
        throwsMsg(() => cvFind({ i: { $in: [1, undefined] } }, LT.ctx), 'undefined is not allowed')
        throwsMsg(() => cvFind({ i: { $exists: true } }, LT.ctx), 'unsupported operator [$exists]')
    })

    it('R4 非純量值不得交sequelize之型別stringify', function() {
        let bads = [
            [{ d: { $lt: { x: 1 } } }, 'unsupported value type'],
            [{ f: { $gt: [1] } }, 'unsupported value type [array]'],
            [{ i: { $in: [{}] } }, 'unsupported value type'],
            [{ i: NaN }, 'number is not finite'],
            [{ i: Infinity }, 'number is not finite'],
            [{ d: new Date('x') }, 'invalid Date'],
            [{ i: 10n }, 'unsupported value type'],
            [{ s: () => 1 }, 'unsupported value type'],
            [{ s: Symbol('x') }, 'unsupported value type'],
            [{ s: new Map() }, 'unsupported value type'],
            [{ s: undefined }, 'undefined is not allowed'],
            [{ i: {} }, 'empty operator object'],
            [{ s: { a: 1 } }, 'unexpected key'],
            [{ i: { $gt: null } }, 'null is not allowed'],
            [{ i: { $in: 1 } }, 'value must be an array'],
            [{ i: { $not: [1] } }, 'unsupported operator [$not]'],
            [{ i: { $not: {} } }, 'unsupported operator [$not]'],
        ]
        for (let [f, msg] of bads) {
            throwsMsg(() => cvFind(f, LT.ctx), msg)
        }
    })

    it('R4 純量須符合欄位型別', function() {
        let bads = [
            [{ i: { $lt: 'abc' } }, '[int]'],
            [{ i: { $lt: '0x10' } }, '[int]'],
            [{ i: { $lt: '0b1' } }, '[int]'],
            [{ i: ' 5' }, '[int]'],
            [{ i: '2.5' }, '[int]'],
            [{ i: '1e3' }, '[int]'],
            [{ i: '5.' }, '[int]'],
            [{ dec: '1e3' }, '[num]'],
            [{ f: '5.' }, '[num]'],
            [{ dec: '1.254' }, '[num] with scale [2]'],
            [{ d: { $lt: 1e16 } }, '[date]'],
            [{ d: -8.64e15 - 1 }, '[date]'],
            [{ d: 8.64e15 }, '[date]'], //Date可表示但UTC年275760, 超出1–9999(審計02 外審 opus [2])
            [{ d: '0000-01-01T00:00:00Z' }, '[date]'], //年0000不在1–9999(年0001–0099之ISO字串見「R4 DATE」ISO字串之年0001–0099)
            [{ i: Number('9007199254740993') }, '[int]'],
            [{ big: Number('9007199254740993') }, '[int]'],
            [{ f: { $lt: 'abc' } }, '[num]'],
            [{ p: { $lt: 'abc' } }, '[num]'],
            [{ dec: { $lt: true } }, '[num]'],
            [{ d: { $lt: 'garbage' } }, '[date]'],
            [{ d: { $lt: '2020-01-01' } }, '[date]'],
            [{ d: { $lt: '2026-02-30T00:00:00Z' } }, '[date]'],
            [{ d: { $lt: true } }, '[date]'],
            [{ do: new Date('2020-01-01T00:00:00Z') }, '[dateonly]'],
            [{ do: '2026-02-30' }, '[dateonly]'],
            [{ s: 1 }, '[str]'],
            [{ b: 'abc' }, '[bool]'],
        ]
        for (let [f, msg] of bads) {
            throwsMsg(() => cvFind(f, LT.ctx), `does not match column type ${msg}`)
        }
        //Buffer不屬白名單純量(第33項批1: 原僅用於未分類型別之欄)
        throwsMsg(() => cvFind({ s: Buffer.from('a') }, LT.ctx), 'unsupported value type')
        //相符者放行
        for (let f of [{ i: '2' }, { i: '-25' }, { f: '-2.5' }, { dec: '.5' }, { dec: '1.25' }, { dec: 1.254 }, { d: 253402300799999 }, { big: '9007199254740993' }, { p: 2.5 }, { d: { $lt: '2020-01-01T00:00:00Z' } }, { d: { $lt: '2020-01-01 08:00:00+08:00' } }, { d: { $lt: 1577836800000 } }, { do: '2020-01-01' }, { b: 1 }]) {
            assert.doesNotThrow(() => cvFind(f, LT.ctx), JSON.stringify(f))
        }
    })

    it('R4 巢狀深度上限與循環參照', function() {
        let o = {}
        o.$and = [o]
        throwsMsg(() => cvFind(o, LT.ctx), 'too deep')
    })

    it('R6 $regex/$options/RegExp已移除(第33項批1): 一律reject, 不再有LIKE轉譯', function() {
        for (let M of [LT, MS]) {
            for (let f of [{ t: { $regex: 'a' } }, { t: { $regex: 'a', $options: 'i' } }, { t: { $regex: /a/ } }, { t: { $options: 'i' } }, { t: { $not: { $regex: 'a' } } }, { i: { $regex: '1' } }]) {
                throwsMsg(() => cvFind(f, M.ctx), 'unsupported operator')
            }
            throwsMsg(() => cvFind({ t: /a/i }, M.ctx), 'unsupported value type [RegExp]')
            throwsMsg(() => cvFind({ t: { $in: [/a/] } }, M.ctx), 'unsupported value type [RegExp]')
        }
    })

    it('getColKind 依sequelize型別類別分類', function() {
        let a = LT.ctx.attrs
        let ks = ['id', 's', 't', 'i', 'f', 'p', 'dec', 'b', 'd', 'do', 'big', 'length', 'title', 'nocol']
        assert.deepStrictEqual(ks.map((k) => getColKind(a, k)), ['str', 'str', 'str', 'int', 'num', 'num', 'num', 'bool', 'date', 'dateonly', 'int', 'int', 'str', 'any'])
        let sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
        let md = sq.define('tk', {
            'a': Sequelize.REAL,
            'b': Sequelize.SMALLINT,
            'c': Sequelize.CHAR(4),
            'd': Sequelize.UUID,
            'e': Sequelize.ENUM('x', 'y'),
            'f': Sequelize.TINYINT,
        }, { tableName: 'tk', timestamps: false })
        assert.deepStrictEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => getColKind(md.rawAttributes, k)), ['num', 'int', 'str', 'str', 'any', 'int'])
    })

    it('R8 主鍵欄之條件值依normPk正規化, 非主鍵欄維持R4', function() {
        //字串類主鍵欄: 有限數字即String(v), 含$in元素、範圍運算子、$not之內與sequelize原生Symbol
        let pairs = [
            [{ id: 123 }, { id: '123' }],
            [{ id: { $in: [123, '45'] } }, { id: { $in: ['123', '45'] } }],
            [{ id: { $nin: [1.5] } }, { id: { $nin: ['1.5'] } }],
            [{ id: { $gt: 2, $lte: 9 } }, { id: { $gt: '2', $lte: '9' } }],
            [{ id: { $ne: 7 } }, { id: { $ne: '7' } }],
        ]
        for (let [a, b] of pairs) {
            assert.strictEqual(LT.where(a, { pk: 'id' }), LT.where(b, { pk: 'id' }))
            assert.strictEqual(MS.where(a, { pk: 'id' }), MS.where(b, { pk: 'id' }))
        }
        assert.ok(LT.where({ id: 123 }, { pk: 'id' }).indexOf('`id` = \'123\'') >= 0)
        assert.ok(MS.where({ id: 123 }, { pk: 'id' }).indexOf('[id] = N\'123\'') >= 0)
        //null依R5
        assert.ok(LT.where({ id: null }, { pk: 'id' }).indexOf('`id` IS NULL') >= 0)
        //整數類主鍵欄: 標準整數寫法字串即數值, 超出安全整數者保留字串
        assert.strictEqual(LT.where({ i: '12' }, { pk: 'i' }), LT.where({ i: 12 }, { pk: 'i' }))
        assert.strictEqual(LT.where({ i: { $in: ['-3', 5] } }, { pk: 'i' }), LT.where({ i: { $in: [-3, 5] } }, { pk: 'i' }))
        assert.ok(LT.where({ big: '9007199254740993' }, { pk: 'big' }).indexOf('\'9007199254740993\'') >= 0)
        //其他數值類主鍵欄: 標準數字字串即數值
        assert.strictEqual(LT.where({ dec: '1.25' }, { pk: 'dec' }), LT.where({ dec: 1.25 }, { pk: 'dec' }))
        assert.strictEqual(LT.where({ f: '-2.5' }, { pk: 'f' }), LT.where({ f: -2.5 }, { pk: 'f' }))
        //無效與型別不符拒收, 訊息同R4
        let bads = [
            [{ id: true }, 'id', '[str]'],
            [{ id: '' }, 'id', '[str]'],
            [{ id: { $ne: '' } }, 'id', '[str]'],
            [{ id: { $in: [1, false] } }, 'id', '[str]'],
            [{ i: '012' }, 'i', '[int]'],
            [{ i: '+12' }, 'i', '[int]'],
            [{ i: 12.4 }, 'i', '[int]'],
            [{ i: { $gt: '1e1' } }, 'i', '[int]'],
            [{ i: true }, 'i', '[int]'],
            [{ big: Number('9007199254740993') }, 'big', '[int]'],
            [{ dec: '1.50' }, 'dec', '[num]'],
            [{ dec: '.5' }, 'dec', '[num]'],
            [{ dec: 1.254 }, 'dec', '[num] with scale [2]'],
            [{ dec: { $in: ['1.254'] } }, 'dec', '[num] with scale [2]'],
        ]
        for (let [f, pk, msg] of bads) {
            throwsMsg(() => cvFind(f, { ...LT.ctx, pk }), `does not match column type ${msg}`)
        }
        //非主鍵欄維持R4: 字串欄收數值拒收、整數欄收'012'放行、DECIMAL欄之字串檢scale
        throwsMsg(() => cvFind({ s: 1 }, { ...LT.ctx, pk: 'id' }), 'does not match column type [str]')
        assert.doesNotThrow(() => cvFind({ i: '012' }, { ...LT.ctx, pk: 'id' }))
        throwsMsg(() => cvFind({ dec: '1.254' }, { ...LT.ctx, pk: 'id' }), 'with scale [2]')
    })

})


describe('cvFind 審計02', function() {

    //規格句(CLAUDE_rulebook.md):
    //  [最低要求②] 〈條件(find)之支援範圍〉:不支援之運算子與無法轉譯之值必須reject, 不得靜默忽略、改變語意或擴大刪除範圍; ③不得因條件清單恰為空而刪全表
    //  [R3]  欄位層運算子產生之每個子式, 其SQL必含該欄名(欄位引用不變式); 常數僅限文件層
    //  [R5]  $in:[]恆假、$nin:[]恆真(含NULL列)、$not:{$in:[]}為全部; 空集合須引用其欄位且只引用一次
    //  [R4欄名解析] 嚴格鍵: 型別與主鍵檢核作用於屬性名或資料庫欄名完全相符之欄(屬性名優先), attrs已給而其餘者reject, 未給attrs者鍵不解析而交資料庫
    //  [R4 dateNoTz] ctx.dateNoTz值域、語意、驗證

    //空集合之各入口(欄名以f代入)
    let emptyFinds = (f) => [
        ['$in:[]', { [f]: { $in: [] } }],
        ['$in:[]+$nin非空', { [f]: { $in: [], $nin: ['x'] } }],
        ['$in:[]+比較運算子', { [f]: { $in: [], $gt: 'a' } }],
        ['$or含空$in', { $or: [{ [f]: { $in: [] } }, { id: 'zz' }] }],
        ['$and含空$in', { $and: [{ [f]: { $in: [] } }, { id: 'zz' }] }],
        ['$or內$and含空$in', { $or: [{ $and: [{ [f]: { $in: [] } }, { id: 'zz' }] }] }],
    ]

    it('[R3][最低要求②] 空集合之各入口產生之SQL皆引用其欄位, 使資料庫得以回報不存在之欄(attrs已給之欄與未給attrs之任意欄)', function() {
        for (let M of [LT, MS]) {
            for (let f of ['s', 'title']) {
                for (let [lb, find] of emptyFinds(f)) {
                    let w = M.where(find)
                    assert.ok(w.indexOf(M.q(f)) >= 0, `${lb} × ${f}: SQL未引用欄位: ${w}`)
                }
            }
            //未給attrs: 鍵不解析而交資料庫, 不存在之欄須由資料庫回報, 故SQL須含該欄名
            for (let f of ['nocol', 'nane']) {
                for (let [lb, find] of emptyFinds(f)) {
                    let w = M.where0(find)
                    assert.ok(w.indexOf(M.q(f)) >= 0, `${lb} × ${f}(未給attrs): SQL未引用欄位: ${w}`)
                }
            }
        }
    })

    it('[R3][R4最低要求②③] attrs已給時不存在之欄於轉譯階段reject(含空集合各入口、遞迴與包覆), 不依賴資料庫回報', function() {
        for (let M of [LT, MS]) {
            for (let f of ['nocol', 'nane']) {
                for (let [, find] of emptyFinds(f)) {
                    throwsMsg(() => M.where(find), `unknown column name [${f}]`)
                }
            }
        }
    })

    it('[R3][最低要求②] 白名單內之運算子 × 各類值(未給attrs): 凡未被拒收者其SQL皆引用其欄位(防日後新增分支再犯); sequelize之Op Symbol一律於形狀階段reject', function() {
        let vals = [[], [1, 2], ['x'], null, 1, 'x', '', true, false, new Date(0)]
        let n = 0
        for (let M of [LT, MS]) {
            for (let op of ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']) {
                for (let v of vals) {
                    let w = null
                    try {
                        w = M.where0({ nocol: { [op]: v } })
                    }
                    catch (e) {
                        continue //拒收者不產生SQL
                    }
                    n++
                    assert.ok(w.indexOf(M.q('nocol')) >= 0, `${op} × ${JSON.stringify(v)}: SQL未引用欄位: ${w}`)
                }
            }
            for (let name of Object.keys(Op)) {
                throwsMsg(() => M.where0({ nocol: { [Op[name]]: 1 } }), 'symbol key is not allowed')
            }
        }
        assert.ok(n > 20, `被檢核之案數過少: ${n}`)
    })

    it('[R5] 空集合之欄位只引用一次: mssql驅動遇同一語句≥2個錯誤時err.message為空字串', function() {
        //R5: $in:[]以f IS NULL AND 1 = 0表示, 不用f IS NULL AND f IS NOT NULL之雙引用形式($nin:[]已於形狀階段reject)
        for (let M of [LT, MS]) {
            let w = M.where({ s: { $in: [] } })
            assert.strictEqual(w.split(M.q('s')).length - 1, 1, `$in:[]: 欄位引用次數不為1: ${w}`)
            throwsMsg(() => M.where({ s: { $nin: [] } }), '$nin with empty array is always true')
        }
    })

    it('[R3] 屬性名≠欄名之空集合: 經sequelize映射後SQL含資料庫欄名physical_title(單元之where不經映射, 另以mapWhereFieldNames補)', function() {
        //R3: 欄位層子式之SQL必含該欄名; 實際送出者為映射後之資料庫欄名, 非屬性名
        for (let M of [LT, MS]) {
            for (let [lb, find] of emptyFinds('title')) {
                let w = M.whereDb(find)
                assert.ok(w.indexOf(M.q('physical_title')) >= 0, `${lb}: 映射後SQL未含資料庫欄名: ${w}`)
                assert.strictEqual(w.indexOf(M.q('title')), -1, `${lb}: 映射後SQL仍含屬性名: ${w}`)
            }
        }
    })

    it('[R5] 同一find含多個空集合時, 各空集合各引用其欄位一次(欄名自然出現多次)', function() {
        for (let M of [LT, MS]) {
            let w = M.where({ $or: [{ s: { $in: [] } }, { s: { $in: [] } }] })
            assert.strictEqual(w.split(M.q('s')).length - 1, 2, w)
        }
    })

    it('[R4欄名解析] 嚴格鍵: 屬性名或資料庫欄名完全相符者依其型別檢核, 其餘一律reject unknown column name(無折疊、不分大小寫亦不收、無關方言)', function() {
        //規格句: R4欄名解析——鍵須與屬性名或資料庫欄名完全相符, 否則reject; 不模擬資料庫之識別字解析
        let ws = String.fromCharCode(0x3000) //全形空白(mssql預設定序視同尾端空白)
        let fe = String.fromCharCode(0xFEFF) //mssql CI定序下附加於id後仍等同id之可忽略字元(2026-10-16實測)
        let ip = String.fromCharCode(0x26A) //U+026A, mssql CI定序下等同i(2026-10-16實測)
        for (let M of [LT, MS]) {
            //完全相符之屬性名與資料庫欄名(title → physical_title)依其型別檢核
            throwsMsg(() => cvFind({ i: { $lt: 'abc' } }, M.ctx), '[int]')
            throwsMsg(() => cvFind({ f: { $lt: 'abc' } }, M.ctx), '[num]')
            throwsMsg(() => cvFind({ d: { $lt: 'garbage' } }, M.ctx), '[date]')
            throwsMsg(() => cvFind({ title: 5 }, M.ctx), '[str]')
            throwsMsg(() => cvFind({ physical_title: 5 }, M.ctx), '[str]')
            assert.doesNotThrow(() => cvFind({ i: { $lt: 5 } }, M.ctx))
            assert.doesNotThrow(() => cvFind({ physical_title: 'x' }, M.ctx))
            //其餘一律reject: ASCII大小寫變體、全形、尾端空白(含全形空白)、可忽略字元、mssql等價字元、attrs未列之欄、sqlite隱含欄
            //(第33項批1: 含空白、可忽略字元等不屬欄名文法者於形狀階段即reject為unsupported column name; 符合文法者〔字母、數字、底線〕由嚴格鍵reject為unknown column name)
            for (let k of ['I', 'F', 'D', 'PHYSICAL_TITLE', 'TITLE', 'Title', 'ｉ', 'i ', `i${ws}`, `i${fe}`, `${ip}`, ` i`, 'nocol', 'rowid', 'oid', '_rowid_']) {
                let pre = /^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(k) ? 'unknown column name' : 'unsupported column name'
                throwsMsg(() => cvFind({ [k]: { $lt: 'abc' } }, M.ctx), pre)
                throwsMsg(() => cvFind({ [k]: 1 }, M.ctx), pre)
                throwsMsg(() => cvFind({ [k]: { $in: [] } }, M.ctx), pre)
                throwsMsg(() => cvFind({ [k]: { $nin: [1] } }, M.ctx), pre)
                throwsMsg(() => cvFind({ $or: [{ s: 'a' }, { [k]: 1 }] }, M.ctx), pre)
            }
            throwsMsg(() => cvFind({ I: { $lt: 'abc' } }, M.ctx), 'unknown column name [I]')
        }
    })

    it('[R4欄名解析] 性質: 任一屬性名/資料庫欄名經各種變異(大小寫、全形、空白、可忽略字元、引號、方括號、點、前後$、等價字元、增刪字元)後, 凡不等於某完全相符名者一律reject', function() {
        //規格句: R4欄名解析——只收完全相符者; 以變異窮舉取代逐例(三輪外審皆為再模擬一條規則而漏一個拼寫)
        let cp = (n) => String.fromCharCode(n)
        let full = (s) => s.replace(/[!-~]/g, (c) => cp(c.charCodeAt(0) + 0xFEE0)) //ASCII → 全形
        let muts = [
            (s) => s.toUpperCase(), (s) => s.toLowerCase(), (s) => s[0].toUpperCase() + s.slice(1), (s) => s[0].toLowerCase() + s.slice(1).toUpperCase(),
            (s) => `${s} `, (s) => `${s}  `, (s) => ` ${s}`, (s) => `${s}${cp(0x3000)}`, (s) => `${s}${cp(0xFEFF)}`, (s) => `${s}${cp(0xAD)}`, (s) => `${s}${cp(0x200B)}`,
            (s) => `${s}\t`, (s) => `${s}\n`, (s) => `${s}${cp(0)}`, (s) => `${s}${cp(0xA0)}`,
            (s) => `${s.slice(0, 1)}\`${s.slice(1)}`, (s) => `${s}\``, (s) => `${s}"`, (s) => `${s}'`, (s) => `${s.slice(0, 1)}[${s.slice(1)}`, (s) => `${s}]`, (s) => `[${s}]`,
            (s) => `${s}.x`, (s) => `x.${s}`, (s) => `$${s}$`, (s) => `$${s}`, (s) => `${s}$`,
            (s) => full(s), (s) => s.replace(/i/g, cp(0x26A)).replace(/I/g, cp(0x26A)), (s) => s.replace(/e/g, cp(0xE9)), (s) => s.normalize('NFD'),
            (s) => s + s.slice(-1), (s) => s.slice(0, -1), (s) => `x${s}`, (s) => `${s}x`, (s) => s.split('').reverse().join(''),
        ]
        let M0 = mk('sqlite', { ...defs, 'Éa': Sequelize.STRING, 'x y': Sequelize.INTEGER, '中文欄': Sequelize.STRING })
        for (let M of [M0, mk('mssql', { ...defs, 'Éa': Sequelize.STRING, 'x y': Sequelize.INTEGER, '中文欄': Sequelize.STRING })]) {
            let attrs = M.ctx.attrs
            let ok = new Set()
            Object.keys(attrs).forEach((k) => {
                ok.add(k)
                ok.add(attrs[k].field)
            })
            let nRej = 0
            for (let base of ok) {
                if (base.length === 0) {
                    continue
                }
                for (let mu of muts) {
                    let k = mu(base)
                    if (ok.has(k) || k === '__proto__') {
                        continue //變異後恰為另一完全相符名(合法)
                    }
                    for (let v of [{ $lt: 'abc' }, '012', { $in: [] }, { $not: { $gt: 1 } }]) {
                        let e = null
                        try {
                            cvFind({ [k]: v }, M.ctx)
                        }
                        catch (err) {
                            e = err
                        }
                        assert.ok(e !== null && /unknown column name|unsupported column name|invalid column name|unsupported operator/.test(e.message), `未reject: ${JSON.stringify(k)} (源自${JSON.stringify(base)}): ${e && e.message}`)
                        nRej++
                    }
                }
            }
            assert.ok(nRej > 1000, `被檢核之案數過少: ${nRej}`)
        }
    })

    it('[R4欄名解析] unknown column name 之提示僅供診斷: 不分大小寫相同者附did you mean, 解析結果不變(仍reject)', function() {
        throwsMsg(() => cvFind({ I: 1 }, LT.ctx), 'unknown column name [I], did you mean [i]?')
        throwsMsg(() => cvFind({ PHYSICAL_TITLE: 'x' }, MS.ctx), 'did you mean [title]?')
        let e = null
        try {
            cvFind({ nocol: 1 }, LT.ctx)
        }
        catch (err) {
            e = err
        }
        assert.ok(e !== null && e.message.indexOf('did you mean') < 0, '無相近者不附提示')
    })

    it('[R4欄名解析] 優先序與歧義: 屬性名完全相符 > 資料庫欄名完全相符; 欄名重複reject; 僅大小寫不同之屬性各依完全相符', function() {
        //屬性a之欄名為b、屬性b之欄名為c: {b:..}依屬性名完全相符為屬性b(INTEGER, 其欄c反查即b)
        let M1 = mk('sqlite', { id: pkStr, a: { type: Sequelize.STRING, field: 'b' }, b: { type: Sequelize.INTEGER, field: 'c' } })
        throwsMsg(() => cvFind({ b: 'x' }, M1.ctx), '[int]')
        assert.doesNotThrow(() => cvFind({ b: 5 }, M1.ctx))
        //屬性名無相符時, 資料庫欄名完全相符者
        throwsMsg(() => cvFind({ c: 'x' }, M1.ctx), '[int]')
        //屬性a之欄b恰為屬性b之名稱: sequelize反查為屬性b, 見「撞名」
        throwsMsg(() => cvFind({ a: 'x' }, M1.ctx), 'ambiguous column name [a]')
        //僅大小寫不同之兩屬性(只可能存在於區分大小寫之資料庫; sqlite與mssql預設定序下無法建表, 此處僅驗證各依完全相符之純函數行為): 各依完全相符; 其他拼寫reject
        let M2 = mk('sqlite', { id: pkStr, Ab: Sequelize.STRING, aB: Sequelize.INTEGER })
        assert.doesNotThrow(() => cvFind({ Ab: 'x' }, M2.ctx))
        assert.doesNotThrow(() => cvFind({ aB: 1 }, M2.ctx))
        throwsMsg(() => cvFind({ Ab: 1 }, M2.ctx), '[str]')
        throwsMsg(() => cvFind({ ab: 1 }, M2.ctx), 'unknown column name [ab]')
        //資料庫欄名重複(兩屬性對應同一欄): 以欄名查無從判定, reject
        let M3 = mk('sqlite', { id: pkStr, a: { type: Sequelize.STRING, field: 'x' }, b: { type: Sequelize.INTEGER, field: 'x' } })
        throwsMsg(() => cvFind({ x: 'a' }, M3.ctx), 'ambiguous column name [x]')
        //屬性名與他屬性之欄名: 屬性名之大小寫變體、欄名之大小寫變體皆不解析
        let M4 = mk('sqlite', { id: pkStr, ab: { type: Sequelize.STRING, field: 'c' }, q: { type: Sequelize.INTEGER, field: 'AB' } })
        throwsMsg(() => cvFind({ aB: 'x' }, M4.ctx), 'unknown column name [aB]')
        assert.doesNotThrow(() => cvFind({ AB: 5 }, M4.ctx))
        throwsMsg(() => cvFind({ AB: 'x' }, M4.ctx), '[int]')
        throwsMsg(() => cvFind({ ab: 5 }, M4.ctx), '[str]')
        //Object.prototype之成員名不是屬性(unsupported column name, 見「不安全欄名」)
        for (let k of ['constructor', 'toString', 'hasOwnProperty', '__defineGetter__']) {
            throwsMsg(() => cvFind({ [k]: 1 }, M1.ctx), `unsupported column name [${k}]`)
        }
        //未給attrs時不解析(型別any, 交資料庫)
        assert.doesNotThrow(() => cvFind({ I: { $lt: 'abc' } }, { escape: M2.ctx.escape, dialect: 'sqlite' }))
        assert.doesNotThrow(() => cvFind({ rowid: 1 }, { escape: M2.ctx.escape, dialect: 'sqlite' }))
    })

    it('[R4欄名解析][R8] 主鍵欄: 屬性名與資料庫欄名(屬性名≠欄名)皆依R8正規化; 非完全相符之鍵reject', function() {
        //R8: 字串類主鍵欄之數字即String(v)
        assert.ok(LT.where({ id: 123 }, { pk: 'id' }).indexOf('\'123\'') >= 0)
        //整數類主鍵欄: '012'為型別不符, '12'為12; 非主鍵整數欄收'012'
        throwsMsg(() => cvFind({ i: '012' }, { ...LT.ctx, pk: 'i' }), '[int]')
        assert.ok(LT.where({ i: '12' }, { pk: 'i' }).indexOf('`i` = 12') >= 0)
        assert.doesNotThrow(() => cvFind({ i: '012' }, { ...LT.ctx, pk: 'id' }))
        //屬性名≠欄名之主鍵: 屬性id對應欄ID_COL, 兩種完全相符之鍵皆依R8; 變體鍵reject(原於不分大小寫之資料庫繞過R8而刪除id=12)
        let M = mk('sqlite', { id: { type: Sequelize.INTEGER, primaryKey: true, field: 'ID_COL' }, name: Sequelize.STRING })
        let cx = { ...M.ctx, pk: 'id' }
        throwsMsg(() => cvFind({ id: '012' }, cx), '[int]')
        throwsMsg(() => cvFind({ ID_COL: '012' }, cx), '[int]')
        assert.ok(M.where({ ID_COL: '12' }, { pk: 'id' }).indexOf('`ID_COL` = 12') >= 0)
        for (let k of ['ID', 'Id', 'id_col', 'ID_COL ']) {
            let pre = k === 'ID_COL ' ? 'unsupported column name' : 'unknown column name' //尾端空白不屬欄名文法, 於形狀階段reject
            throwsMsg(() => cvFind({ [k]: '012' }, cx), pre)
            throwsMsg(() => cvFind({ [k]: '12' }, cx), pre)
        }
    })

    it('[R4欄名解析] 不安全欄名: 鍵或其映射後之資料庫欄名會被sequelize改寫或重新解讀者reject(引號/方括號字元、點、前後$、Object.prototype成員名、__proto__)', function() {
        //規格句: R4欄名解析(b)——sequelize之quoteIdentifier刪除引號與方括號字元(sqlite之val`ue成value)、點為JSON路徑與表.欄、$x$為欄引用、
        //原型名使sequelize查到函數而不依欄型序列化、賦值__proto__使條件遺失而刪全表; 這些名稱之比對對象不是該名稱之欄
        for (let dl of ['sqlite', 'mssql']) {
            //使用者之鍵(attrs已給: 非完全相符之此類鍵亦為unsupported而非unknown, 以免依賴其是否碰巧解析)
            let M = mk(dl)
            //($開頭之鍵為運算子、__proto__為R2之invalid column name, 不在此)
            //(訊息中之方括號為避免偽造路徑段而以?取代, 故只比對前綴)
            for (let k of ['val`ue', 'i"d', 'i\'d', 'i[d]', 'i]', 'a.b', 'constructor', 'valueOf', 'hasOwnProperty']) {
                throwsMsg(() => cvFind({ [k]: { $lt: 'abc' } }, M.ctx), 'unsupported column name')
                throwsMsg(() => cvFind({ [k]: '012' }, { ...M.ctx, pk: 'i' }), 'unsupported column name')
            }
            //屬性名安全, 但其映射後之資料庫欄名不安全(model之field為此類名稱, 如既有資料表之欄)
            for (let fd of ['meta.a', '$id$', 'a`b', 'x[y]', '__proto__', 'constructor', 'valueOf', 't.name', 'it\'s']) {
                let M2 = mk(dl, { id: pkStr, v: { type: Sequelize.INTEGER, field: fd }, at: { type: Sequelize.DATE, field: fd === 'valueOf' ? fd : 'dt' } })
                throwsMsg(() => cvFind({ v: 1 }, M2.ctx), `unsupported column name [${fd}]`)
                throwsMsg(() => cvFind({ v: { $gt: 1 } }, M2.ctx), `unsupported column name [${fd}]`)
            }
            //DATE欄之欄名為valueOf: 以屬性名查亦reject(sequelize查到Object.prototype.valueOf而不依欄型序列化)
            let M3 = mk(dl, { id: pkStr, ts: { type: Sequelize.DATE, field: 'valueOf' } })
            throwsMsg(() => cvFind({ ts: { $gt: 1893456000000 } }, M3.ctx), 'unsupported column name [valueOf]')
            throwsMsg(() => cvFind({ valueOf: { $gt: 1893456000000 } }, M3.ctx), 'unsupported column name [valueOf]')
            //含$者不屬欄名文法(第33項批1: p$x原為既有model之欄而可查詢, 現於形狀階段reject)
            throwsMsg(() => cvFind({ 'p$x': 'a' }, M.ctx), 'unsupported column name [p$x]')
        }
    })

    it('[R4欄名解析] VIRTUAL屬性非資料庫欄: 與資料庫欄僅大小寫不同之VIRTUAL屬性不得使其成為該欄之別名', function() {
        //run04 opus [8]: model {value:INTEGER, Value:VIRTUAL}, {Value:{$lt:'abc'}} 原由完全相符收下而不檢型別, sqlite不分大小寫解析到value欄而全命中
        for (let dl of ['sqlite', 'mssql']) {
            let M = mk(dl, { id: pkStr, value: Sequelize.INTEGER, Value: Sequelize.VIRTUAL(Sequelize.STRING) })
            throwsMsg(() => cvFind({ Value: { $lt: 'abc' } }, M.ctx), 'unknown column name [Value]')
            throwsMsg(() => cvFind({ value: { $lt: 'abc' } }, M.ctx), '[int]')
            assert.doesNotThrow(() => cvFind({ value: { $lt: 5 } }, M.ctx))
            //VIRTUAL屬性有field時, 以其欄名為鍵亦非資料庫欄(與屬性名鍵同一判斷; run05 opus [9])
            let M2 = mk(dl, { id: pkStr, v: { type: Sequelize.VIRTUAL(Sequelize.STRING), field: 'vc' } })
            throwsMsg(() => cvFind({ vc: 'a' }, M2.ctx), 'unknown column name [vc]')
            throwsMsg(() => cvFind({ v: 'a' }, M2.ctx), 'unknown column name [v]')
        }
    })

    it('[R4] 欄位運算子物件須至少一個運算子: 僅有值為undefined之$options、空物件皆reject(原條件消失而成恆真, delAll刪全表); $options已移除', function() {
        for (let M of [LT, MS]) {
            throwsMsg(() => cvFind({ s: { $options: undefined } }, M.ctx), 'unsupported operator [$options]')
            throwsMsg(() => cvFind({ $or: [{ s: { $options: undefined } }, { id: 'a' }] }, M.ctx), 'unsupported operator [$options]')
            throwsMsg(() => cvFind({ s: { $options: 'i' } }, M.ctx), 'unsupported operator [$options]')
            throwsMsg(() => cvFind({ s: {} }, M.ctx), 'empty operator object')
            throwsMsg(() => cvFind({ $or: [{ s: {} }, { id: 'a' }] }, M.ctx), 'empty operator object')
        }
    })

    it('[R2][最低要求①] cvFind輸出之每個一般物件最多一個欄位字串鍵(sequelize之mapWhereFieldNames於同一物件內遇{屬性:..,欄名:..}會互相覆寫而丟掉條件)', function() {
        let walk = (o, acc) => {
            if (Array.isArray(o)) {
                o.forEach((x) => walk(x, acc))
            }
            else if (o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype) {
                acc.push(Object.keys(o).length)
                Reflect.ownKeys(o).forEach((k) => walk(o[k], acc))
            }
        }
        for (let M of [LT, MS]) {
            for (let find of [
                { title: { $gt: 'a', $lt: 'z' }, physical_title: { $ne: 'q' } },
                { title: { $in: ['a'], $nin: ['b'], $eq: null } },
                { $or: [{ i: 1 }, { i: { $in: [] } }], s: { $in: [] } },
                { d: { $gte: new Date(0), $lte: new Date(1), $gt: 1 } },
            ]) {
                let acc = []
                walk(cvFind(find, M.ctx), acc)
                assert.ok(acc.length > 0 && acc.every((n) => n <= 1), JSON.stringify(acc))
            }
        }
    })

    it('[R4 DATE] 所有形式換算UTC後年份須在1–9999(sqlite以文字比較, 年10000起為5位數而命中全部日期列); 邊界放行', function() {
        let bads = [
            { d: { $gt: new Date(253402300800000) } }, //UTC 10000-01-01
            { d: { $gt: 253402300800000 } },
            { d: { $gt: '9999-12-31T23:30:00-05:00' } }, //UTC 10000-01-01T04:30
            { d: { $lt: new Date(-62135596800001) } }, //UTC 0000-12-31T23:59:59.999
            { d: { $lt: -62135596800001 } },
        ]
        for (let f of bads) {
            throwsMsg(() => cvFind(f, LT.ctx), '[date]')
        }
        for (let f of [{ d: { $gt: '9999-12-31T23:59:59Z' } }, { d: { $gt: new Date(253402300799999) } }, { d: { $lt: new Date(-62135596800000) } }]) {
            assert.doesNotThrow(() => cvFind(f, LT.ctx), JSON.stringify(f))
        }
        //dateNoTz: 本地時間通過回驗, 但換算UTC後年份超出者拒收
        withTz('America/New_York', () => {
            throwsMsg(() => cvFind({ d: { $gt: '9999-12-31T23:30:00' } }, { ...LT.ctx, dateNoTz: 'local' }), '[date]')
            assert.doesNotThrow(() => cvFind({ d: { $gt: '9999-12-31T18:30:00' } }, { ...LT.ctx, dateNoTz: 'local' }))
        })
    })

    it('[R4 DATE] 通過檢核之字串與epoch一律轉為Date送出: 與直接給同一瞬間之Date之SQL相同(令DATE值之SQL與sequelize之欄位查找無關)', function() {
        //各入口(欄位直給、$eq…$lte、$in/$nin、邏輯結合)皆須經同一轉換, 任一入口漏轉則該入口之字串/epoch與Date之SQL不同; 預期之Date由同一瞬間獨立給出
        let entries = [
            ['等值', (k, v) => ({ [k]: v })],
            ['$eq', (k, v) => ({ [k]: { $eq: v } })],
            ['$ne', (k, v) => ({ [k]: { $ne: v } })],
            ['$gt', (k, v) => ({ [k]: { $gt: v } })],
            ['$gte', (k, v) => ({ [k]: { $gte: v } })],
            ['$lt', (k, v) => ({ [k]: { $lt: v } })],
            ['$lte', (k, v) => ({ [k]: { $lte: v } })],
            ['$in', (k, v) => ({ [k]: { $in: [v, v] } })],
            ['$nin', (k, v) => ({ [k]: { $nin: [v] } })],
            ['$or內', (k, v) => ({ $or: [{ s: 'a' }, { [k]: v }] })],
            ['$and內$or', (k, v) => ({ $and: [{ $or: [{ s: 'a' }, { [k]: { $lt: v } }] }] })],
        ]
        let t2019 = new Date('2019-01-01T00:00:00Z')
        let t2030 = new Date(1893456000000)
        for (let M of [LT, MS]) {
            for (let [v, dt] of [['2019-01-01T00:00:00Z', t2019], ['2019-01-01 08:00:00+08:00', t2019], [1893456000000, t2030], [t2019, t2019]]) {
                for (let [lb, mkf] of entries) {
                    assert.strictEqual(M.where(mkf('d', v)), M.where(mkf('d', dt)), `${lb} ${String(v)}`)
                }
            }
            //epoch與字串不以原樣送出
            assert.strictEqual(M.where({ d: { $gt: 1893456000000 } }).indexOf('1893456000000'), -1)
            assert.strictEqual(M.where({ d: '2019-01-01T00:00:00Z' }).indexOf('T00:00:00Z'), -1)
        }

        //run05 sol F09: 上列SQL比較不能鎖住「cvFind必須轉Date」——欄位型別可由sequelize查得時, 字串與epoch未轉換而原樣交出, sequelize亦依欄型序列化成相同SQL(實測76/76格相同);
        //故直接斷言cvFind之輸出: 不含原樣之字串/epoch, 且含Date
        let leaves = (o, acc) => {
            if (Array.isArray(o)) {
                o.forEach((x) => leaves(x, acc))
            }
            else if (o instanceof Date) {
                acc.push(o)
            }
            else if (o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype) {
                Reflect.ownKeys(o).forEach((k) => leaves(o[k], acc))
            }
            else if (o === null || typeof o !== 'object') {
                acc.push(o)
            }
        }
        for (let [v, ms] of [['2019-01-01T00:00:00Z', 1546300800000], ['2019-01-01 08:00:00+08:00', 1546300800000], [1893456000000, 1893456000000]]) {
            for (let [lb, mkf] of entries) {
                let acc = []
                leaves(cvFind(mkf('d', v), LT.ctx), acc)
                assert.ok(acc.indexOf(v) < 0, `${lb} ${String(v)}: 輸出仍含原樣之字串/epoch`)
                let ds = acc.filter((x) => x instanceof Date)
                assert.ok(ds.length > 0 && ds.every((x) => x.getTime() === ms), `${lb} ${String(v)}: 輸出之Date不等於${ms}`)
            }
        }
    })

    it('[R4 dateNoTz] 值域: undefined或\'local\', 其餘拋錯(含find為空或非物件時)', function() {
        assert.doesNotThrow(() => cvFind({ d: '2026-01-01T00:00:00Z' }, { ...LT.ctx, dateNoTz: undefined }))
        assert.doesNotThrow(() => cvFind({ d: '2026-01-01T00:00:00Z' }, { ...LT.ctx, dateNoTz: 'local' }))
        for (let v of ['Local', 'utc', 'UTC', null, false, true, '', 0, {}]) {
            throwsMsg(() => cvFind({ d: '2026-01-01T00:00:00Z' }, { ...LT.ctx, dateNoTz: v }), 'invalid ctx: dateNoTz must be \'local\' or undefined')
        }
        //驗證早於提前返回, 拼錯不會被靜默忽略
        throwsMsg(() => cvFind({}, { ...LT.ctx, dateNoTz: 'Local' }), 'invalid ctx')
        throwsMsg(() => cvFind(undefined, { ...LT.ctx, dateNoTz: 'Local' }), 'invalid ctx')
    })

    it('[R4 dateNoTz] 未給時維持reject(R4:無時區者依主機時區解析而結果隨主機而變, 預設拒收)', function() {
        for (let s of ['2026-01-01T00:00:00', '2026-01-01 00:00', '2026-01-01T00:00:00.123']) {
            throwsMsg(() => cvFind({ d: s }, LT.ctx), '[date]')
            throwsMsg(() => cvFind({ d: s }, { ...LT.ctx, dateNoTz: undefined }), '[date]')
        }
    })

    //[字串, 本地時間分量[y,m,d,h,mi,s,ms]]
    let okForms = [
        ['2026-01-01T00:00:00', [2026, 1, 1, 0, 0, 0, 0]],
        ['2026-01-01 00:00:00', [2026, 1, 1, 0, 0, 0, 0]],
        ['2026-01-01T00:00', [2026, 1, 1, 0, 0, 0, 0]],
        ['2026-06-15T08:30:15', [2026, 6, 15, 8, 30, 15, 0]],
        ['2026-06-15T08:30:15.1', [2026, 6, 15, 8, 30, 15, 100]],
        ['2026-06-15T08:30:15.123', [2026, 6, 15, 8, 30, 15, 123]],
        ['2026-06-15T08:30:15.123456', [2026, 6, 15, 8, 30, 15, 123]], //Q-C C3: 截斷至毫秒
        ['2024-02-29T12:00:00', [2024, 2, 29, 12, 0, 0, 0]],
        ['2026-12-31T23:59:59.999', [2026, 12, 31, 23, 59, 59, 999]],
    ]

    it('[R4 dateNoTz] \'local\': 無時區字串 ≡ 以本地時間分量建構之Date(SQL相同), 於各主機時區', function() {
        for (let tz of ['UTC', 'Asia/Taipei', 'America/New_York', 'Australia/Lord_Howe']) {
            withTz(tz, () => {
                for (let M of [LT, MS]) {
                    for (let [s, a] of okForms) {
                        let dt = new Date(a[0], a[1] - 1, a[2], a[3], a[4], a[5], a[6])
                        for (let [lb, mkFind] of [
                            ['等值', (v) => ({ d: v })],
                            ['$eq', (v) => ({ d: { $eq: v } })],
                            ['$gt', (v) => ({ d: { $gt: v } })],
                            ['$gte', (v) => ({ d: { $gte: v } })],
                            ['$lt', (v) => ({ d: { $lt: v } })],
                            ['$lte', (v) => ({ d: { $lte: v } })],
                            ['$ne', (v) => ({ d: { $ne: v } })],
                            ['$in', (v) => ({ d: { $in: [v] } })],
                            ['$nin', (v) => ({ d: { $nin: [v] } })],
                            ['$or內', (v) => ({ $or: [{ s: 'a' }, { d: v }] })],
                        ]) {
                            assert.strictEqual(M.where(mkFind(s), { dateNoTz: 'local' }), M.where(mkFind(dt)), `${tz} ${lb} ${s}`)
                        }
                    }
                }
            })
        }
    })

    it('[R4 dateNoTz] \'local\': 結果隨主機時區而變(此即其語意)', function() {
        let at = (tz, s) => withTz(tz, () => LT.where({ d: s }, { dateNoTz: 'local' }))
        assert.ok(at('UTC', '2026-01-01T00:00:00').indexOf('2026-01-01 00:00:00.000 +00:00') >= 0)
        assert.ok(at('America/New_York', '2026-01-01T00:00:00').indexOf('2026-01-01 05:00:00.000 +00:00') >= 0) //EST
        assert.ok(at('America/New_York', '2026-07-01T00:00:00').indexOf('2026-07-01 04:00:00.000 +00:00') >= 0) //EDT
        assert.ok(at('Asia/Tokyo', '2026-01-01T00:00:00').indexOf('2025-12-31 15:00:00.000 +00:00') >= 0)
    })

    it('[R4 dateNoTz] \'local\': 曆法上或主機時區下不存在之時刻拒收, 夏令重疊取較早者', function() {
        let bads = [
            '2026-02-30T00:00:00', '2026-02-29T12:00:00', '2026-13-01T00:00:00', '2026-00-10T00:00:00', '2026-01-01T24:00:00', '2026-01-01T23:60:00',
            '2026-01-01T23:59:60', '2026-01-01T25:00:00',
        ]
        for (let s of bads) {
            throwsMsg(() => cvFind({ d: s }, { ...LT.ctx, dateNoTz: 'local' }), '[date]')
        }
        withTz('America/New_York', () => {
            throwsMsg(() => cvFind({ d: '2026-03-08T02:30:00' }, { ...LT.ctx, dateNoTz: 'local' }), '[date]') //夏令起始跳過之時刻
            assert.ok(LT.where({ d: '2026-11-01T01:30:00' }, { dateNoTz: 'local' }).indexOf('2026-11-01 05:30:00.000 +00:00') >= 0) //重疊取EDT(較早)
        })
    })

    it('[R4 dateNoTz] \'local\': 只放寬無時區之日期時間字串(Q-C C2:純日期仍拒收); 其餘格式與R4同', function() {
        let bads = ['2026-01-01', '0026-01-01T00:00:00', '12026-01-01T00:00:00', '-002026-01-01T00:00:00', '2026-01-01t00:00:00', ' 2026-01-01T00:00:00', '2026-01-01T00:00:00 ', '2026-1-1T00:00:00', '', 'garbage', '2026-01-01T00:00:00.', '2026-01-01T00:00:00Zx',
            '2026-01-00T00:00:00', '2026-00-01T00:00:00', '2026-01-01\t00:00:00', '2026-01-01  00:00:00', '2026-01-01T00:00.123', '2026-01-01T0:00:00', '０２０２６-01-01T00:00:00', '2026-01-01T00:00:00\n']
        for (let s of bads) {
            throwsMsg(() => cvFind({ d: s }, { ...LT.ctx, dateNoTz: 'local' }), '[date]')
        }
        //帶時區者與未給dateNoTz同(皆轉為Date送出)
        for (let s of ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00+08:00', '2026-01-01 00:00:00+0800']) {
            assert.strictEqual(LT.where({ d: s }, { dateNoTz: 'local' }), LT.where({ d: s }))
        }
        //Date與epoch照舊
        assert.doesNotThrow(() => cvFind({ d: new Date(0) }, { ...LT.ctx, dateNoTz: 'local' }))
        assert.doesNotThrow(() => cvFind({ d: 0 }, { ...LT.ctx, dateNoTz: 'local' }))
        //$in內含一個不合法者整體拒收
        throwsMsg(() => cvFind({ d: { $in: ['2026-01-01T00:00:00', '2026-02-30T00:00:00'] } }, { ...LT.ctx, dateNoTz: 'local' }), '[date]')
    })

    it('[R4 dateNoTz] \'local\': 僅作用於DATE欄; DATEONLY、字串、整數欄與無法解析之欄不受影響', function() {
        let cx = { ...LT.ctx, dateNoTz: 'local' }
        throwsMsg(() => cvFind({ do: '2026-01-01T00:00:00' }, cx), '[dateonly]')
        throwsMsg(() => cvFind({ i: '2026-01-01T00:00:00' }, cx), '[int]')
        //字串欄與未給attrs(欄位型別any)之欄: 原字串送出, 不轉換
        assert.ok(LT.where({ s: '2026-01-01T00:00:00' }, { dateNoTz: 'local' }).indexOf('\'2026-01-01T00:00:00\'') >= 0)
        assert.ok(LT.where0({ nocol: '2026-01-01T00:00:00' }, { dateNoTz: 'local' }).indexOf('\'2026-01-01T00:00:00\'') >= 0)
    })

    //外審修正輪2(聚焦再審 run03): 以下為對resolveAttr、折疊、DATE年份與轉Date四處之再審所得
    let pkStr = { type: Sequelize.STRING, primaryKey: true }

    it('[R4欄名解析] 屬性之欄名恰為他屬性之名稱或與他屬性共欄: sequelize以映射後之欄名反查屬性而依他屬性之型別序列化值, 反查所得非本屬性者一律reject(不論型別類別)', function() {
        for (let dl of ['sqlite', 'mssql']) {
            let M = (dfs) => mk(dl, { id: pkStr, ...dfs })
            let msg = 'ambiguous column name [a]'

            //撞名: 屬性a之欄名b恰為屬性b之名稱(sequelize把鍵a映射為b後以rawAttributes.b之型別序列化: DATE值被INTEGER之NUMBER._stringify轉成Date.toString文字, sqlite以文字比較而命中全部非NULL列)
            let M1 = M({ a: { type: Sequelize.DATE, field: 'b' }, b: { type: Sequelize.INTEGER, field: 'c' } })
            for (let f of [{ a: { $lt: '2026-01-01T00:00:00Z' } }, { a: { $gt: 1893456000000 } }, { a: new Date(0) }, { a: { $in: ['2026-01-01T00:00:00Z'] } }, { a: { $nin: [1893456000000] } }, { a: { $gte: 0, $lte: 1893456000000 } }]) {
                throwsMsg(() => cvFind(f, M1.ctx), msg)
            }
            //反向(A為INTEGER、B為DATE): {a:{$lt:5}}會被序列化為日期而語意全變
            let M2 = M({ a: { type: Sequelize.INTEGER, field: 'b' }, b: { type: Sequelize.DATE, field: 'c' } })
            throwsMsg(() => cvFind({ a: { $lt: 5 } }, M2.ctx), msg)
            //不撞名之入口照常: 屬性b(欄c)、資料庫欄名c; 大小寫變體不解析
            for (let f of [{ b: 5 }, { c: 5 }]) {
                assert.doesNotThrow(() => cvFind(f, M1.ctx), JSON.stringify(f))
            }
            throwsMsg(() => cvFind({ b: 'abc' }, M1.ctx), '[int]')
            throwsMsg(() => cvFind({ c: 'abc' }, M1.ctx), '[int]')
            throwsMsg(() => cvFind({ C: 5 }, M1.ctx), 'unknown column name [C]')

            //撞名但型別類別相同亦reject: 以「反查所得即本屬性」為唯一判準, 不倚賴型別類別相同即序列化相同(自訂DataType、any類別之序列化可能不同; run04 opus [7]、sol)
            let M3 = M({ a: { type: Sequelize.DATE, field: 'b' }, b: { type: Sequelize.DATE, field: 'c' } })
            throwsMsg(() => cvFind({ a: { $lt: '2026-01-01T00:00:00Z' } }, M3.ctx), msg)
            let M3a = M({ a: { type: Sequelize.TIME, field: 'b' }, b: { type: Sequelize.BLOB, field: 'c' } })
            throwsMsg(() => cvFind({ a: { $lt: '12:00' } }, M3a.ctx), msg)

            //兩屬性共用一欄: sequelize取最後定義者(fieldRawAttributesMap), 先定義者reject, 最後定義者照常
            let M4 = M({ a: { type: Sequelize.DATE, field: 'x' }, b: { type: Sequelize.INTEGER, field: 'x' } })
            throwsMsg(() => cvFind({ a: { $lt: '2026-01-01T00:00:00Z' } }, M4.ctx), msg)
            assert.doesNotThrow(() => cvFind({ b: { $lt: 5 } }, M4.ctx))
            throwsMsg(() => cvFind({ x: 5 }, M4.ctx), 'ambiguous column name [x]')

            //屬性名即欄名者不受影響(含屬性名大小寫不同之他屬性)
            let M5 = M({ a: { type: Sequelize.DATE }, A: { type: Sequelize.INTEGER } })
            assert.doesNotThrow(() => cvFind({ a: { $lt: '2026-01-01T00:00:00Z' } }, M5.ctx))
            assert.doesNotThrow(() => cvFind({ A: { $lt: 5 } }, M5.ctx))
        }
    })

    it('[R4 DATE] ISO字串之年0001–0099與Date、epoch同(曆法驗證不受Date.UTC對兩位數年之映射影響); 年0000與UTC年0000拒收', function() {
        for (let M of [LT, MS]) {
            assert.strictEqual(M.where({ d: '0001-01-01T00:00:00Z' }), M.where({ d: new Date(-62135596800000) }))
            assert.strictEqual(M.where({ d: { $gt: '0001-01-01T00:00:00Z' } }), M.where({ d: { $gt: -62135596800000 } }))
            let t50 = new Date(0) //0050-06-01T00:00:00Z, 以setUTCFullYear獨立求出(Date.UTC與new Date(y,..)皆把0–99年映射為1900–1999)
            t50.setUTCFullYear(50, 5, 1)
            assert.strictEqual(M.where({ d: '0050-06-01T00:00:00Z' }), M.where({ d: t50 }))
            assert.ok(M.where({ d: '0050-06-01T00:00:00Z' }).indexOf('0050-06-01 00:00:00.000 +00:00') >= 0)
            assert.ok(M.where({ d: '0099-12-31 23:59:59+00:00' }).indexOf('0099-12-31 23:59:59.000 +00:00') >= 0)
            assert.doesNotThrow(() => cvFind({ d: '0004-02-29T00:00:00Z' }, M.ctx)) //閏年
            for (let s of ['0000-01-01T00:00:00Z', '0001-01-01T00:00:00+00:01', '0100-02-29T00:00:00Z', '0001-02-29T00:00:00Z', '0050-13-01T00:00:00Z']) {
                throwsMsg(() => cvFind({ d: s }, M.ctx), '[date]')
            }
            //DATEONLY同用曆法驗證: 年0001–0099放行, 年0000與不存在之日期拒收
            assert.doesNotThrow(() => cvFind({ do: '0001-01-01' }, M.ctx))
            assert.doesNotThrow(() => cvFind({ do: '0099-12-31' }, M.ctx))
            for (let s of ['0000-01-01', '0001-02-29', '0100-02-29']) {
                throwsMsg(() => cvFind({ do: s }, M.ctx), '[dateonly]')
            }
        }
    })

    it('[R4 DATE] 非整數epoch依new Date(v)截斷至整數毫秒, -0即0', function() {
        for (let M of [LT, MS]) {
            assert.strictEqual(M.where({ d: 1780272000000.9 }), M.where({ d: 1780272000000 }))
            assert.strictEqual(M.where({ d: -0 }), M.where({ d: 0 }))
            assert.strictEqual(M.where({ d: { $gte: 1780272000000.9 } }), M.where({ d: { $gte: 1780272000000 } }))
        }
    })

    it('[R4欄名解析] 手造attrs(非define後之rawAttributes): field未設、屬性值為null或字串者不崩潰, 退化為以屬性名為欄名; field已設而非非空字串者reject(見「field須為非空字串」); 欄名含孤立代理字元不崩潰而於形狀階段依unsupported column name reject', function() {
        let attrs = { id: { type: Sequelize.STRING }, a: { type: Sequelize.INTEGER }, b: null, c: 'x', d: { type: Sequelize.DATE, field: undefined } }
        let cx = { escape: LT.ctx.escape, attrs, dialect: 'sqlite' }
        assert.doesNotThrow(() => cvFind({ a: 1, b: 2, c: 3, d: new Date(0) }, cx))
        throwsMsg(() => cvFind({ a: 'abc' }, cx), '[int]')
        throwsMsg(() => cvFind({ A: 'abc' }, cx), 'unknown column name [A]')
        throwsMsg(() => cvFind({ d: 'garbage' }, cx), '[date]')
        for (let dl of ['sqlite', 'mssql']) {
            throwsMsg(() => cvFind({ '\uD800': 1 }, { ...cx, dialect: dl }), 'unsupported column name')
        }
    })

})


describe('cvFind 最終審(run05)', function() {

    //規格句(CLAUDE_rulebook.md R4欄名解析、R2、R4 原生Symbol):
    //  [R4欄名解析(b)] 鍵或其映射後之資料庫欄名為sequelize於轉成SQL前改寫或重新解讀者reject: 空字串(_joinKeyValue遇空鍵只回值)、首尾皆$(isColString只比首尾字元)、field非非空字串
    //  [R4欄名解析(c)] sequelize之反查須即本屬性, 且共用一欄時只收最後定義者(實體欄之型別由最後定義者決定)
    //  [R4] attrs須為sequelize之rawAttributes形狀(一般物件、無Symbol鍵、自有字串鍵皆可列舉), 否則cvFind與sequelize看到不同之屬性集合
    //  [R2][最低要求②] 原生Symbol須為sequelize於欄位層可翻譯者(OperatorMap所有者), between/notBetween之值須為兩元素陣列
    let pkStr = { type: Sequelize.STRING, primaryKey: true }

    it('[R4欄名解析] 不安全欄名: 映射後之欄名為空字串、或首尾皆$(含中間有換行、僅單一$)者reject(run05 sol F01/F02、opus [1]、自查)', function() {
        //空字串: sequelize之sync以field||name建欄(欄名為屬性名)、寫入亦視為未設, 但mapWhereFieldNames把鍵映射為'', _joinKeyValue遇空鍵只回值, 條件成常數(WHERE (5)), delAll刪全表
        //首尾皆$: isColString只比首尾字元, 含換行之$a\nb$被當成欄引用而比對a\nb欄; 單一$被當成空識別字
        for (let dl of ['sqlite', 'mssql']) {
            for (let fd of ['', '$', '$$', '$\n$', '$a\nb$', '$a\r\nb$', '$a\u2028b$', '$a\u2029b$']) {
                let M = mk(dl, { id: pkStr, v: { type: Sequelize.STRING, field: fd } })
                for (let find of [{ v: 'a' }, { v: { $in: ['a'] } }, { v: { $gt: 'a' } }, { v: { $nin: ['a'] } }, { v: { $in: [] } }, { $or: [{ v: null }, { id: 'a' }] }]) {
                    throwsMsg(() => cvFind(find, M.ctx), `unsupported column name [${fd}]`)
                }
            }
            //前後皆$之判定與isColString一致: 僅首或僅尾為$者照常
            for (let fd of ['$a', 'a$', 'a\n$', '$\na']) {
                let M = mk(dl, { id: pkStr, v: { type: Sequelize.STRING, field: fd } })
                assert.doesNotThrow(() => cvFind({ v: 'a' }, M.ctx), JSON.stringify(fd))
            }
        }
    })

    it('[R4欄名解析] 屬性之field已設者須為字串(空字串見「不安全欄名」): null、數值、布林、物件、陣列皆reject(sequelize保留原值並以String(field)映射, cvFind若退回屬性名則二者指向不同欄; run05 opus [4])', function() {
        for (let fd of [null, 0, 123, true, false, {}, []]) {
            let attrs = { id: { type: Sequelize.STRING }, v: { type: Sequelize.INTEGER, field: fd } }
            throwsMsg(() => cvFind({ v: 1 }, { escape: LT.ctx.escape, attrs, dialect: 'sqlite' }), 'unsupported column name [v]')
            throwsMsg(() => cvFind({ v: { $gt: 'a' } }, { escape: LT.ctx.escape, attrs: { ...attrs, v: { type: Sequelize.STRING, field: fd } }, dialect: 'sqlite' }), 'unsupported column name [v]')
        }
        //field未設(undefined)者以屬性名為欄名
        let attrs = { id: { type: Sequelize.STRING }, v: { type: Sequelize.INTEGER, field: undefined }, w: { type: Sequelize.INTEGER } }
        assert.doesNotThrow(() => cvFind({ v: 1, w: 2 }, { escape: LT.ctx.escape, attrs, dialect: 'sqlite' }))
    })

    it('[R4欄名解析] 共用一欄: 欄名恰為先定義者之名稱時該先定義者亦reject(實體欄之型別由最後定義者決定, sequelize卻依先定義者之型別序列化; run05 opus [2])', function() {
        //屬性a(DATE)之欄名即a, 屬性b(INTEGER)亦映射到欄a: sync以欄名為鍵而後者覆寫, 實體欄a為INTEGER; sequelize把{a:..}依rawAttributes.a(DATE)序列化為文字,
        //sqlite下INTEGER < TEXT恆真, delAll刪光全部非NULL列
        for (let dl of ['sqlite', 'mssql']) {
            let M = mk(dl, { id: pkStr, a: { type: Sequelize.DATE }, b: { type: Sequelize.INTEGER, field: 'a' } })
            for (let f of [{ a: { $lt: '2030-01-01T00:00:00Z' } }, { a: { $gt: 1893456000000 } }, { a: new Date(0) }, { a: null }]) {
                throwsMsg(() => cvFind(f, M.ctx), 'ambiguous column name [a]')
            }
            //b之欄名a反查為屬性a(撞名), 欄名鍵a有兩個屬性
            throwsMsg(() => cvFind({ b: { $lt: 5 } }, M.ctx), 'ambiguous column name [b]')
            //兩屬性共用非屬性名之欄x: 先定義者reject、最後定義者照常(同「撞名」段M4)
            let M4 = mk(dl, { id: pkStr, a: { type: Sequelize.DATE, field: 'x' }, b: { type: Sequelize.INTEGER, field: 'x' } })
            throwsMsg(() => cvFind({ a: { $lt: '2030-01-01T00:00:00Z' } }, M4.ctx), 'ambiguous column name [a]')
            assert.doesNotThrow(() => cvFind({ b: { $lt: 5 } }, M4.ctx))
            //欄名恰為屬性名者(b之欄為c, 另有屬性a之欄為b): 仍依「撞名」reject, 不受影響之入口照常
            let M5 = mk(dl, { id: pkStr, a: { type: Sequelize.INTEGER }, b: { type: Sequelize.INTEGER } })
            assert.doesNotThrow(() => cvFind({ a: 1, b: 2 }, M5.ctx))
        }
    })

    it('[R4] attrs形狀: 須為一般物件(原型為Object.prototype或null)、無Symbol鍵、自有字串鍵皆可列舉, 否則拋invalid ctx(sequelize讀取之屬性集合與cvFind不同; run05 sol F05/F06/F07)', function() {
        let base = () => ({ id: { type: Sequelize.STRING, primaryKey: true }, i: { type: Sequelize.INTEGER }, d: { type: Sequelize.DATE, field: 'dt' } })
        let cx = (attrs) => ({ escape: LT.ctx.escape, attrs, dialect: 'sqlite' })

        //Symbol鍵: 與Op.and相撞時, mapWhereFieldNames把邏輯鍵Op.and映射為欄d, {i:1}之條件消失而改為比對d
        let a1 = base()
        a1[Op.and] = { type: Sequelize.DATEONLY, field: 'd', fieldName: Op.and }
        throwsMsg(() => cvFind({ i: 1 }, cx(a1)), 'invalid ctx: attrs')

        //原型非一般物件: sequelize以rawAttributes[欄名]查找會讀到繼承之定義(cvFind以自有屬性核對則看不到)
        let a2 = Object.setPrototypeOf(base(), { dt: { type: new Sequelize.INTEGER(), field: 'dt', fieldName: 'dt' } })
        throwsMsg(() => cvFind({ d: { $lt: '2020-01-01T00:00:00Z' } }, cx(a2)), 'invalid ctx: attrs')

        //自有而不可列舉: Object.keys建索引看不到, hasOwnProperty卻看得到
        let a3 = base()
        Object.defineProperty(a3, 'a', { value: { type: Sequelize.INTEGER, field: 'x' }, enumerable: false })
        throwsMsg(() => cvFind({ a: 1 }, cx(a3)), 'invalid ctx: attrs')
        throwsMsg(() => cvFind({ x: 1 }, cx(a3)), 'invalid ctx: attrs')

        //非物件之attrs(字串、數值、陣列)
        for (let bad of ['abc', 5, [], () => {}]) {
            throwsMsg(() => cvFind({ i: 1 }, cx(bad)), 'invalid ctx: attrs')
        }

        //原型為null、一般物件、真正之rawAttributes皆照常
        assert.doesNotThrow(() => cvFind({ i: 1 }, cx(Object.assign(Object.create(null), base()))))
        assert.doesNotThrow(() => cvFind({ i: 1 }, cx(base())))
        assert.doesNotThrow(() => cvFind({ i: 1, d: new Date(0) }, LT.ctx))
        assert.doesNotThrow(() => cvFind({ i: 1 }, MS.ctx))

        //attrs未給(undefined、null)者不檢, 維持現況; find為空者提前返回
        assert.doesNotThrow(() => cvFind({ i: 1 }, { escape: LT.ctx.escape, dialect: 'sqlite' }))
        assert.deepStrictEqual(cvFind({}, cx(a1)), {})
    })

})


describe('cvFind 第33項批1(R11 系列條件白名單接線)', function() {

    //規格句(CLAUDE_rulebook.md R11): cvFind第一步經wsemi之cvOrmFind(maxList:999)檢核並取複本, 其後只走訪複本; 對已檢核之複本再呼叫為冪等(w-orm-mdb於其normFind後再呼叫cvFind);
    //$and/$or清單超過32項者分組為平衡樹(SQLite運算式樹深度上限); ctx.escape與ctx.dialect已不使用

    let pkS = { type: Sequelize.STRING, primaryKey: true }
    //案例表之欄位: id name age g t flag d
    let defsF = { id: pkS, name: Sequelize.STRING, age: Sequelize.INTEGER, g: Sequelize.STRING, t: Sequelize.STRING, flag: Sequelize.BOOLEAN, d: Sequelize.DATE }
    let MF = [mk('sqlite', defsF), mk('mssql', defsF)]

    let tryOf = (fn) => {
        try {
            return { v: fn() }
        }
        catch (err) {
            return { err: String(err.message) }
        }
    }

    it('案例表: 每案cvFind(find)與cvFind(chkFindShape複本)結果相同(冪等); REJ案訊息即cvOrmFind之訊息', function() {
        let n = 0
        for (let M of MF) {
            for (let c of cvCases.cases) {
                let a = tryOf(() => M.where(c.find()))
                let b = tryOf(() => M.where(chkFindShape(c.find())))
                assert.deepStrictEqual(a, b, c.id)
                n++
                if (c.expect === 'REJ') {
                    let o = tryOf(() => cvOrmFind(c.find(), { maxList: 999 }))
                    assert.ok(a.err !== undefined, `${c.id} 應reject`)
                    assert.strictEqual(a.err, o.err, c.id)
                    assert.ok(a.err.indexOf(c.why) >= 0, `${c.id}: ${a.err}`)
                }
                else if (a.err !== undefined) {
                    assert.ok(c.schema === true, `非schema案不得reject: ${c.id} ${a.err}`)
                }
            }
        }
        assert.ok(n >= 500, `案數 ${n}`)
    })

    it('ctx.escape、ctx.dialect已不使用: 給或不給、給任意值結果相同; 空物件回{}', function() {
        for (let M of MF) {
            let f = { g: 'A', $or: [{ age: { $in: [20, 30] } }, { d: { $gte: new Date(0) } }] }
            let a = M.where(f)
            assert.strictEqual(M.where(f, { escape: undefined, dialect: undefined }), a)
            assert.strictEqual(M.where(f, { escape: () => 'X', dialect: 'nonsense' }), a)
        }
        assert.deepStrictEqual(cvFind({}, {}), {})
        assert.deepStrictEqual(cvFind(undefined, {}), {})
        assert.deepStrictEqual(cvFind(Object.create(null), {}), {})
    })

    it('$and/$or清單與並列欄位之隱含AND分組: 項數超過4者遞迴二分為平衡樹, 項數與順序不變, 邏輯節點層數僅隨項數對數成長(4項以內維持平鋪)', function() {
        //leaves, 逐層展開僅含單一Op.and/Op.or鍵之節點取葉, mx.v記最深邏輯節點層數
        let leaves = (o, acc, lv, mx) => {
            let ks = Reflect.ownKeys(o)
            if (ks.length === 1 && (ks[0] === Op.or || ks[0] === Op.and) && Array.isArray(o[ks[0]])) {
                mx.v = Math.max(mx.v, lv + 1)
                o[ks[0]].forEach((x) => leaves(x, acc, lv + 1, mx))
            }
            else {
                acc.push(o)
            }
        }
        //[項數, 預期最深邏輯節點層數]: 頂層Op.and → 清單節點 →(每超過4項之二分一層)→ 各子條件之Op.and; 4項以內為3, 5項起每次折半加1層
        for (let op of ['$or', '$and']) {
            for (let [n, lvExp] of [[1, 3], [4, 3], [5, 4], [8, 4], [9, 5], [32, 6], [33, 7], [999, 11]]) {
                let find = { [op]: Array.from({ length: n }, (_, i) => ({ id: `k${i}` })) }
                let acc = []
                let mx = { v: 0 }
                leaves(cvFind(find, LT.ctx), acc, 0, mx)
                assert.deepStrictEqual(acc.map((x) => x.id), Array.from({ length: n }, (_, i) => `k${i}`), `${op} ${n}: 葉之順序與數量`)
                assert.strictEqual(mx.v, lvExp, `${op} ${n}: 邏輯節點層數`)
            }
        }
        //同一條件物件內並列之欄位(隱含AND)亦分組: 40欄 → 葉數與順序不變, 層數僅對數成長
        let wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, i]))
        let dfs = { id: { type: Sequelize.STRING, primaryKey: true } }
        for (let k of Object.keys(wide)) {
            dfs[k] = Sequelize.INTEGER
        }
        let Mw = mk('sqlite', dfs)
        let accW = []
        let mxW = { v: 0 }
        leaves(cvFind(wide, Mw.ctx), accW, 0, mxW)
        assert.deepStrictEqual(accW.map((x) => Object.keys(x)[0]), Object.keys(wide), '並列欄位之順序與數量')
        assert.ok(mxW.v <= 8, `並列40欄之邏輯節點層數 ${mxW.v}`)
        //SQL: 999項之連接詞恆為998個(n項共n-1個), 子條件逐一出現
        for (let M of [LT, MS]) {
            for (let [op, kw] of [['$or', ' OR '], ['$and', ' AND ']]) {
                let w = M.where({ [op]: Array.from({ length: 999 }, (_, i) => ({ id: `k${i}` })) })
                assert.strictEqual((w.match(/'k\d+'/g) || []).length, 999, `${op}: 子條件數`)
                assert.strictEqual(w.split(kw).length - 1, 998, `${op}: 連接詞數`)
            }
        }
    })

    it('檢查之值即使用之值: 走訪不第二次讀取原物件(存取器不被呼叫, 以所讀之複本轉譯)', function() {
        let n = 0
        let o = {}
        Object.defineProperty(o, 'g', {
            enumerable: true,
            get() {
                n++
                return 'A'
            }
        })
        throwsMsg(() => cvFind(o, LT.ctx), 'accessor property is not allowed')
        assert.strictEqual(n, 0, '存取器不得被呼叫')
        //Proxy: 描述子陷阱每個鍵只被讀一次
        let reads = 0
        let p = new Proxy({ g: 'A', age: 20 }, {
            getOwnPropertyDescriptor(t, k) {
                reads++
                return Reflect.getOwnPropertyDescriptor(t, k)
            }
        })
        assert.ok(MF[0].where(p).indexOf('`g` = \'A\'') >= 0)
        assert.strictEqual(reads, 2, '2個鍵各讀1次')
    })

    it('匯出簽名不變(w-orm-mdb深引用): cvFind(find, ctx)、getColKind、getColScale、normPk; 新增chkFindShape', function() {
        assert.strictEqual(cvFind.length, 2)
        assert.strictEqual(getColKind.length, 2)
        assert.strictEqual(normPk.length, 2)
        assert.strictEqual(typeof chkFindShape, 'function')
        assert.strictEqual(chkFindShape.length, 1)
    })

})


describe('normPk', function() {

    //rulebook R8: 依主鍵欄型別正規化主鍵值, 與w-orm-mdb之normPk同一規則(主控複審run03第二節之表)

    let ok = (v, kind, exp, scale) => {
        assert.deepStrictEqual(normPk(v, kind, scale), { kind: 'ok', v: exp }, `${String(v)} @ ${kind} ${scale}`)
    }
    let no = (v, kind, r, scale) => {
        assert.deepStrictEqual(normPk(v, kind, scale), { kind: r }, `${String(v)} @ ${kind} ${scale}`)
    }

    it('R8 字串類: 非空字串原樣, 有限數字為String(v)', function() {
        ok('a', 'str', 'a')
        ok(' a ', 'str', ' a ')
        ok('123', 'str', '123')
        ok(123, 'str', '123')
        ok(1.5, 'str', '1.5')
        ok(0, 'str', '0')
        ok(-0, 'str', '0')
        //包裝物件(同new String、new Number)先取原始值
        ok(Object('a'), 'str', 'a')
        ok(Object(5), 'str', '5')
    })

    it('R8 整數類: 安全整數原樣, 標準整數寫法字串為Number(s), 其餘為型別不符', function() {
        ok(12, 'int', 12)
        ok(-3, 'int', -3)
        ok(0, 'int', 0)
        ok(Number.MAX_SAFE_INTEGER, 'int', Number.MAX_SAFE_INTEGER)
        ok('12', 'int', 12)
        ok('-12', 'int', -12)
        ok('0', 'int', 0)
        //表外細化: 超出安全整數之標準整數寫法字串保留為字串(精確值, 供BIGINT)
        ok('9007199254740993', 'int', '9007199254740993')
        for (let v of [12.4, Number('9007199254740993'), 2 ** 53, 1e21, '012', '+12', '12.0', '1e1', ' 12', '12 ', '0x1', 'abc', '-0']) {
            no(v, 'int', 'mismatch')
        }
    })

    it('R8 其他數值類: 有限數字與標準數字字串為數值, 其餘字串為型別不符', function() {
        ok(1.5, 'num', 1.5)
        ok(12, 'num', 12)
        ok('1.5', 'num', 1.5)
        ok('-2', 'num', -2)
        ok('1.254', 'num', 1.254)
        for (let v of ['1.50', '.5', '5.', '1e3', ' 1', 'abc', '0x1']) {
            no(v, 'num', 'mismatch')
        }
    })

    it('R8 DECIMAL(表外細化): 小數位多於scale者寫入時會被四捨五入而改變鍵, 為型別不符', function() {
        ok(1.25, 'num', 1.25, 2)
        ok('1.25', 'num', 1.25, 2)
        ok('0.5', 'num', 0.5, 2)
        ok(3, 'num', 3, 0)
        ok('-7', 'num', -7, 0)
        for (let [v, sc] of [[1.254, 2], ['1.254', 2], [1.005, 2], [0.1 + 0.2, 2], [2.5, 0], ['2.5', 0]]) {
            no(v, 'num', 'mismatch', sc)
        }
    })

    it('R8 其他型別: 非空字串與有限數字原樣', function() {
        ok('2020-01-01T00:00:00Z', 'date', '2020-01-01T00:00:00Z')
        ok(5, 'any', 5)
        ok('x', 'bool', 'x')
    })

    it('R8 任何型別: NaN、±Infinity、空字串、布林、物件、陣列、Date、BigInt、null、undefined為無效', function() {
        for (let kind of ['str', 'int', 'num', 'date', 'any']) {
            for (let v of [NaN, Infinity, -Infinity, '', Object(''), true, false, {}, [], [1], new Date(0), 10n, null, undefined]) {
                no(v, kind, 'invalid')
            }
        }
    })

})

import assert from 'assert'
import Sequelize from 'sequelize'
import cvFind, { getColKind, normPk } from '../src/cvFind.mjs'


//cvFind為select與delAll共用之條件轉譯純函數, 本檔不連線資料庫
//斷言分兩類: 拒收(reject之訊息)與方言專屬之SQL片段(ESCAPE、N前綴、LOWER內之實際欄名);
//命中集合之語意由test/api-suite.mjs之find段於sqlite與mssql實際執行斷言, 本檔不以SQL之括號結構作斷言
//對應CLAUDE_rulebook.md之R1–R6與R8(normPk)


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
let mk = (dialect) => {
    let sq = dialect === 'sqlite'
        ? new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
        : new Sequelize('worm', 'u', 'p', { dialect: 'mssql', host: 'localhost', port: 1, logging: false })
    let md = sq.define('tcond', defs, { tableName: 'tcond', timestamps: false })
    let qg = sq.getQueryInterface().queryGenerator
    let ctx = { escape: (v) => sq.escape(v), attrs: md.rawAttributes, dialect }
    let where = (find, ex = {}) => {
        let sql = qg.selectQuery('tcond', { where: cvFind(find, { ...ctx, ...ex }) }, md)
        let k = sql.indexOf(' WHERE ')
        return k >= 0 ? sql.slice(k + 7).replace(/;$/, '') : ''
    }
    return { ctx, where }
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


describe('cvFind', function() {

    it('R1 非物件與陣列之find回空物件(現況保留), 非一般物件拒收', function() {
        for (let v of [undefined, null, [], 'a', 1, true, [{ id: 'a' }]]) {
            assert.deepStrictEqual(cvFind(v, LT.ctx), {})
        }
        assert.deepStrictEqual(cvFind({}, LT.ctx), {})
        class Q {
            constructor() {
                this.s = 'a'
            }
        }
        for (let v of [Object.create({ s: 'a' }), new Q(), new Date(), new Map([['s', 'a']]), /a/]) {
            throwsMsg(() => cvFind(v, LT.ctx), 'find must be a plain object')
        }
        assert.ok(LT.where(Object.assign(Object.create(null), { s: 'a' })).indexOf('`s` = \'a\'') >= 0)
    })

    it('R2 欄名length不得使其他條件失效, 欄名含$視為欄名', function() {
        let w = LT.where({ s: 'x', length: 0 })
        assert.ok(w.indexOf('`s` = \'x\'') >= 0 && w.indexOf('`length` = 0') >= 0, w)
        assert.ok(LT.where({ 'p$x': 'q' }).indexOf('`p$x` = \'q\'') >= 0)
    })

    it('R2 Symbol須為sequelize之運算子, 欄位層之邏輯Symbol拒收', function() {
        throwsMsg(() => cvFind({ i: { [Op.gt]: { x: 1 } } }, LT.ctx), 'value must be')
        throwsMsg(() => cvFind({ [Op.like]: 'x' }, LT.ctx), 'unsupported symbol operator')
        throwsMsg(() => cvFind({ [Symbol('or')]: [{ s: 'a' }] }, LT.ctx), 'unsupported symbol operator')
        throwsMsg(() => cvFind({ i: { [Symbol('gt')]: 1 } }, LT.ctx), 'unsupported symbol operator')
        throwsMsg(() => cvFind({ i: { [Op.or]: [{ [Op.eq]: 1 }], [Op.gt]: 10 } }, LT.ctx), 'unsupported symbol operator')
        throwsMsg(() => cvFind({ i: { [Op.or]: [] } }, LT.ctx), 'unsupported symbol operator')
        throwsMsg(() => cvFind({ i: { [Op.and]: 0 } }, LT.ctx), 'unsupported symbol operator')
        throwsMsg(() => cvFind({ s: 'a', [Symbol.toStringTag]: 'Q' }, LT.ctx), 'unsupported symbol operator')
        //Symbol與對應之$運算子產生相同之條件
        assert.strictEqual(LT.where({ i: { [Op.not]: { [Op.gt]: 2 } } }), LT.where({ i: { $not: { $gt: 2 } } }))
        assert.strictEqual(LT.where({ i: { [Op.in]: [1, 2] } }), LT.where({ i: { $in: [1, 2] } }))
    })

    it('R2 同義之鍵各自成一子式, 非列舉之鍵亦納入', function() {
        let w = LT.where({ i: { $gt: 5, [Op.gt]: 1 } })
        assert.ok(w.indexOf('`i` > 5') >= 0 && w.indexOf('`i` > 1') >= 0, w)
        let w2 = LT.where({ $and: [{ s: 'a' }], [Op.and]: [{ s: 'b' }] })
        assert.ok(w2.indexOf('`s` = \'a\'') >= 0 && w2.indexOf('`s` = \'b\'') >= 0, w2)
        let f = {}
        Object.defineProperty(f, 's', { value: 'a', enumerable: false })
        assert.ok(LT.where(f).indexOf('`s` = \'a\'') >= 0)
    })

    it('R2 欄名__proto__與空字串拒收', function() {
        throwsMsg(() => cvFind(JSON.parse('{"__proto__":1}'), LT.ctx), 'invalid column name')
        throwsMsg(() => cvFind({ '': 1 }, LT.ctx), 'invalid column name')
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

    it('R3 邏輯運算子須為非空之物件陣列, 陣列不得有洞', function() {
        for (let op of ['$and', '$or', '$nor']) {
            throwsMsg(() => cvFind({ [op]: [] }, LT.ctx), 'nonempty array')
            throwsMsg(() => cvFind({ [op]: { s: 1 } }, LT.ctx), 'requires an array')
            throwsMsg(() => cvFind({ [op]: ['x'] }, LT.ctx), 'condition must be an object')
            throwsMsg(() => cvFind({ [op]: new Array(2) }, LT.ctx), 'holes or undefined')
        }
        throwsMsg(() => cvFind({ [Op.and]: [] }, LT.ctx), 'nonempty array')
        throwsMsg(() => cvFind({ i: { $in: [1, undefined] } }, LT.ctx), 'holes or undefined')
        throwsMsg(() => cvFind({ i: { $exists: 'yes' } }, LT.ctx), '$exists must be a boolean, 0 or 1')
    })

    it('R4 非純量值不得交sequelize之型別stringify', function() {
        let bads = [
            [{ d: { $lt: { x: 1 } } }, 'value must be'],
            [{ f: { $gt: [1] } }, 'value must be'],
            [{ i: { $in: [{}] } }, 'value must be'],
            [{ i: NaN }, 'number must be finite'],
            [{ i: Infinity }, 'number must be finite'],
            [{ d: new Date('x') }, 'invalid Date'],
            [{ i: 10n }, 'value must be'],
            [{ s: () => 1 }, 'value must be'],
            [{ s: Symbol('x') }, 'value must be'],
            [{ s: new Map() }, 'value must be'],
            [{ s: undefined }, 'value is undefined'],
            [{ i: {} }, 'empty operator object'],
            [{ s: { a: 1 } }, 'nested object is not supported'],
            [{ i: { $gt: null } }, 'null is not allowed'],
            [{ i: { $in: 1 } }, 'must be an array'],
            [{ i: { $not: [1] } }, '$not does not accept an array'],
            [{ i: { $not: {} } }, 'empty operator object'],
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
        //Buffer只用於未分類型別之欄
        throwsMsg(() => cvFind({ s: Buffer.from('a') }, LT.ctx), 'value must be')
        //相符者放行
        for (let f of [{ i: '2' }, { i: '-25' }, { f: '-2.5' }, { dec: '.5' }, { dec: '1.25' }, { dec: 1.254 }, { d: 8.64e15 }, { big: '9007199254740993' }, { p: 2.5 }, { d: { $lt: '2020-01-01T00:00:00Z' } }, { d: { $lt: '2020-01-01 08:00:00+08:00' } }, { d: { $lt: 1577836800000 } }, { do: '2020-01-01' }, { b: 1 }, { nocol: 1 }]) {
            assert.doesNotThrow(() => cvFind(f, LT.ctx), JSON.stringify(f))
        }
    })

    it('R4 巢狀深度上限與循環參照', function() {
        let o = {}
        o.$and = [o]
        throwsMsg(() => cvFind(o, LT.ctx), 'too deep')
    })

    it('R6 $regex跳脫LIKE萬用字元並帶ESCAPE, mssql為N前綴', function() {
        assert.ok(LT.where({ t: { $regex: '_' } }).indexOf('LIKE \'%!_%\' ESCAPE \'!\'') >= 0)
        assert.ok(LT.where({ t: { $regex: '%' } }).indexOf('LIKE \'%!%%\' ESCAPE \'!\'') >= 0)
        assert.ok(LT.where({ t: { $regex: '!' } }).indexOf('LIKE \'%!!%\' ESCAPE \'!\'') >= 0)
        assert.ok(LT.where({ t: { $regex: '\\[a-c\\]' } }).indexOf('LIKE \'%![a-c]%\' ESCAPE \'!\'') >= 0)
        assert.ok(LT.where({ t: { $regex: 'a\\.c' } }).indexOf('LIKE \'%a.c%\'') >= 0)
        assert.ok(MS.where({ t: { $regex: '_' } }).indexOf('LIKE N\'%!_%\' ESCAPE \'!\'') >= 0)
        assert.ok(MS.where({ t: { $regex: '中' } }).indexOf('LIKE N\'%中%\'') >= 0)
    })

    it('R6 $regex只收字面子字串, 旗標只收i', function() {
        for (let p of ['^pe', 'a.c', 'a*', '[a]', 'a|b', '(a)', 'a{2}', 'a?', 'a+', 'a$', '\\d', 'a/b', 'a\\']) {
            throwsMsg(() => cvFind({ t: { $regex: p } }, LT.ctx), '$regex supports literal substrings only')
        }
        throwsMsg(() => cvFind({ t: { $regex: 'a' + String.fromCharCode(0) + 'x' } }, LT.ctx), 'NUL')
        throwsMsg(() => cvFind({ t: { $regex: 'a', $options: 'm' } }, LT.ctx), 'supports [i] only')
        throwsMsg(() => cvFind({ t: { $regex: /a/m } }, LT.ctx), 'supports [i] only')
        throwsMsg(() => cvFind({ t: { $regex: /a/, $options: 'i' } }, LT.ctx), '$options can not be used with a RegExp')
        throwsMsg(() => cvFind({ t: { $options: 'i' } }, LT.ctx), '$options requires $regex')
        throwsMsg(() => cvFind({ t: { $regex: 1 } }, LT.ctx), '$regex must be a string or RegExp')
        for (let c of ['i', 'f', 'p', 'dec', 'b', 'd']) {
            throwsMsg(() => cvFind({ [c]: { $regex: '1' } }, LT.ctx), '$regex requires a string column')
        }
        //同義寫法產生相同之條件
        let wi = LT.where({ t: { $regex: 'PeT', $options: 'i' } })
        assert.ok(wi.indexOf('LOWER(`t`) LIKE LOWER(\'%PeT%\') ESCAPE \'!\'') >= 0, wi)
        assert.strictEqual(LT.where({ t: { $regex: 'PeT', $options: '$i' } }), wi)
        assert.strictEqual(LT.where({ t: { $regex: /PeT/i } }), wi)
        assert.strictEqual(LT.where({ t: /PeT/i }), wi)
        assert.strictEqual(LT.where({ t: { $regex: new RegExp('') } }), LT.where({ t: { $regex: '' } }))
    })

    it('R6 給i時LOWER內為實際欄名; sqlite下含非ASCII大小寫字母者拒收', function() {
        assert.ok(LT.where({ title: { $regex: 'a', $options: 'i' } }).indexOf('LOWER(`physical_title`)') >= 0)
        throwsMsg(() => cvFind({ t: { $regex: 'é', $options: 'i' } }, LT.ctx), 'ASCII letters only')
        assert.doesNotThrow(() => cvFind({ t: { $regex: '中', $options: 'i' } }, LT.ctx))
        assert.ok(MS.where({ t: { $regex: 'é', $options: 'i' } }).indexOf('LOWER([t]) LIKE LOWER(N\'%é%\')') >= 0)
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
            [{ id: [1.5] }, { id: ['1.5'] }],
            [{ id: { $gt: 2, $lte: 9 } }, { id: { $gt: '2', $lte: '9' } }],
            [{ id: { $not: { $eq: 7 } } }, { id: { $not: { $eq: '7' } } }],
            [{ id: { [Op.in]: [7] } }, { id: { [Op.in]: ['7'] } }],
            [{ id: { [Op.between]: [1, 2] } }, { id: { [Op.between]: ['1', '2'] } }],
        ]
        for (let [a, b] of pairs) {
            assert.strictEqual(LT.where(a, { pk: 'id' }), LT.where(b, { pk: 'id' }))
            assert.strictEqual(MS.where(a, { pk: 'id' }), MS.where(b, { pk: 'id' }))
        }
        assert.ok(LT.where({ id: 123 }, { pk: 'id' }).indexOf('`id` = \'123\'') >= 0)
        assert.ok(MS.where({ id: 123 }, { pk: 'id' }).indexOf('[id] = N\'123\'') >= 0)
        //null依R5, $regex不受影響
        assert.ok(LT.where({ id: null }, { pk: 'id' }).indexOf('`id` IS NULL') >= 0)
        assert.ok(LT.where({ id: { $regex: '12' } }, { pk: 'id' }).indexOf('LIKE \'%12%\'') >= 0)
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

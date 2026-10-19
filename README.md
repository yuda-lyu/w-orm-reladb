# w-orm-reladb
An operator for relational database in nodejs.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-orm-reladb.svg?style=flat)](https://npmjs.org/package/w-orm-reladb) 
[![license](https://img.shields.io/npm/l/w-orm-reladb.svg?style=flat)](https://npmjs.org/package/w-orm-reladb) 
[![npm download](https://img.shields.io/npm/dt/w-orm-reladb.svg)](https://npmjs.org/package/w-orm-reladb) 
[![npm download](https://img.shields.io/npm/dm/w-orm-reladb.svg)](https://npmjs.org/package/w-orm-reladb) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-orm-reladb.svg)](https://www.jsdelivr.com/package/npm/w-orm-reladb)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-orm-reladb/WOrm.html).

### `insert` with `option.returnList`

An aggregate count answers "how many rows were new", but not **which ones** — and the latter is what deduplication actually needs, when only new rows should trigger an expensive downstream action. Setting `returnList` hands back the per row verdict that `insert` already computes internally:

```alias
let rs = await w.insert(data, { returnList: true })
// => [ { n: 1, nInserted: 1, ok: 1 }, { n: 1, nInserted: 0, ok: 1 }, ... ]
let fresh = data.filter((v, k) => rs[k].nInserted === 1)
```

The returned array is the same length as the input and in the same order. Each element carries `n: 1` and `ok: 1` — any failure in `insert` is a batch level error and rejects, so a per row element never reports a failure. `rs.filter(v => v.nInserted === 1).length` equals the `nInserted` of the default aggregate form, and invalid input returns `[]` instead of the aggregate empty result.

The switch is static: the shape is decided solely by the value you write at the call site, never by the data or by what happened at run time. Treat the two values as two separate contracts and do not share result handling code between call sites that use different ones.

### `insert` and `insertBulk`

Both write rows that do not yet exist, and both return `{ n, nInserted, ok }`. They differ in what happens on a conflict, so `insertBulk` is **not** a faster `insert`:

| Situation | `insert` | `insertBulk` |
|---|---|---|
| Primary key already exists | that row is skipped, the batch still returns `ok: 1` | the whole call **rejects, and not a single row is written** |
| Duplicate primary keys inside one batch | only the first one counts toward `nInserted` | treated as a conflict, the whole call rejects |
| `nInserted` | rows actually inserted, `0 ≤ nInserted ≤ n` | equals `n` whenever the call succeeds |
| Use it for | ordinary writes against a table that may already hold data | bulk import where no conflict is expected |

With no conflict the two are indistinguishable, so you may swap them under that assumption — and if the assumption is wrong, `insertBulk` tells you by rejecting rather than silently skipping.

`insertBulk` is considerably faster here, because `insert` has to write row by row to report an exact `nInserted` (measured on this machine, Windows 11 / Node 24 / sequelize 6):

| Rows | sqlite `insert` → `insertBulk` | mssql `insert` → `insertBulk` |
|---|---|---|
| 1000 | 5549 ms → 25 ms (226x) | 6802 ms → 190 ms (36x) |
| 5000 | 29825 ms → 50 ms (592x) | 44116 ms → 489 ms (90x) |

The all-or-nothing guarantee is provided by a transaction, not by the batch statement alone: mssql splits a large batch into several statements because of its bind parameter limit, so without one an interrupted batch would leave earlier rows behind. When you pass `option.transaction`, a SAVEPOINT is used instead, so a failure rolls back only this call and leaves the rest of your transaction untouched.

### Closed instances

`init()` hands you an instance you can share across calls through `option.instance`, and `instance.close()` ends it. Once closed, **every function rejects immediately** with a message naming the closed state — including `selectByPk`, which does not fall back to its usual `null`. This matters because a closed instance and "no such row" would otherwise look identical, and a deduplication caller reading that as "not present yet" would re-run the whole batch downstream. Do not keep using an instance after closing it; call `init()` again for a new one.

Note also that a plain call made without `option.instance` opens and closes its own connection, so it ends any instance you are holding. Do not mix the two styles against the same `WOrmReladb` object.

### Condition (`find`) whitelist for `select` and `delAll`

`select(find)` and `delAll(find)` accept the same series wide whitelist (shared with the other `w-orm-*` packages through `cvOrmFind` of `wsemi`) and translate it through one function, so **the rows `delAll` deletes are exactly the rows `select` returns** for the same `find`. Anything outside the whitelist **rejects as a whole** (and emits `error`) before the model files are loaded and before a connection is made or any SQL is sent: nothing is ignored, reinterpreted or deleted. The error message is `invalid find: <reason> at [<path>]`; the shared whitelist check never echoes the offending value (the column type check described below may quote it).

| Form | Meaning |
|---|---|
| `find` omitted, `undefined` or `{}` | all rows (for `delAll`: **every row is deleted**, see below) |
| `{ col: value }` | equality; several columns are combined with AND; the value is a string (no NUL, no lone surrogate), a finite number, a boolean, a valid `Date`, or `null` (`IS NULL`) |
| `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` | comparison with a scalar (`null` only for `$eq` / `$ne`); several operators on one column are combined with AND |
| `$in` `$nin` | an array of scalars (no `null`); `$in: []` matches nothing, `$nin: []` rejects |
| `$and` `$or` | a non empty array of non empty condition objects, **at most 999 items** (SQLite fails at 1000 flat items; 999 is the shared limit for the packages running on SQLite) |

Limits: nesting depth 32, `$in` / `$nin` at most 10000 values, at most 100000 nodes, column names of 1 to 128 characters matching `^[\p{L}_][\p{L}\p{M}\p{N}_]*$` (so no dots, quotes, hyphens, spaces or a leading `$`).

Everything else rejects, among them: a `find` that is not a plain condition object (`null`, an array, a string, a number, a boolean, a function, a `Date`, a `RegExp`, a `Map`, a class instance …, which are **never** treated as `{}`), `$not` `$nor` `$regex` `$options` `$exists` `$where` `$expr` `$like` `$ilike` and any other operator, `$and` / `$or` inside a column, sequelize `Op` symbols, a `RegExp` value, an array as a column value (write `$in`), `undefined`, functions, symbols, `BigInt`, `Buffer`, `NaN`, `±Infinity` and invalid `Date` values, symbol keys, getters and non enumerable keys, sparse arrays or arrays with extra properties, empty operator objects, empty `$and` / `$or` or a `{}` inside them.

On top of the whitelist this package checks, and rejects what cannot be translated with its meaning intact: values that do not fit the column type (for example `'abc'` or `'1e3'` against an integer column, a decimal string with more fractional digits than the column's scale, a date string without a time zone such as `'2020-01-01'` — use a `Date`, an epoch number or `'2020-01-01T00:00:00Z'` — or an integer beyond `Number.MAX_SAFE_INTEGER`, which should be passed as a decimal string instead) and column names that the model does not list (see below).

Differences from MongoDB you should know: `NULL` follows SQL three valued logic, so `$ne` and `$nin` do not match rows whose column is `NULL`. To say it explicitly use the portable forms (they return the same rows on every `w-orm-*` package): leave `NULL` out with `{ $and: [{ f: { $ne: null } }, { f: { $ne: x } }] }`, or keep it with `{ $or: [{ f: null }, { f: { $ne: x } }] }`. Equality and comparison of strings follow the database collation (sqlite compares binary and is case sensitive, the default collation of mssql is case insensitive), and there is no pattern matching: to search for a substring, `select` and filter in memory.

**`delAll` needs care.** `delAll()`, `delAll(undefined)` and `delAll({})` delete every row without asking; only a condition makes it a partial delete. Use it sparingly and prefer `del` for single rows; a `find` that is not a condition object rejects instead of deleting everything. Check what a condition matches with `select(find)` first. If the condition comes from a variable that may be `undefined`, `null` or an empty array, decide that yourself before calling: `undefined` values and `$nin: []` reject (they are never ignored), `$in: []` matches nothing.

Column names in a `find` must match the model exactly: the attribute name, or the database column name (`field`) of exactly one attribute. Any other spelling is rejected with `unknown column name`: a different letter case, full width forms, a column the model does not list (sqlite's hidden `rowid` included) or a virtual attribute. Databases resolve identifiers with their own collation rules (the default collation of mssql treats `id`, `ID`, `ＩＤ`, `id ` and `ɪd` as the same column) and the ORM rewrites names before they reach the database, so a spelling that is not an exact match could slip past the type checks above (`{ VALUE: { $lt: 'abc' } }` used to delete every non `NULL` row on sqlite); the error message suggests the closest name. Names that the ORM rewrites or re-interprets are rejected with `unsupported column name`: names outside the grammar above, names that are members of `Object.prototype` (such as `constructor`, `valueOf`), an attribute whose `field` is set but is not a string, or whose database column name is empty, contains quote characters, brackets or dots, or starts and ends with `$`; an attribute whose column is also the name of another attribute, and an attribute that shares its column with an attribute defined later (only the last one defined of a shared column is accepted), are rejected as `ambiguous column name`, because the ORM would serialize the value with the type of the other attribute, or the type of the column is decided by another one. The `attrs` you hand to `cvFind` must be the `rawAttributes` of the model that runs the query (a plain object without symbol keys and with enumerable keys only), otherwise `cvFind` throws `invalid ctx`. `delAll` is also refused for a model whose `defaultScope` has `limit`, `offset`, `group`, `having`, a non-empty `include`, or a `where` that uses `Op.and` (`select` and `delete` would not touch the same rows). The model must therefore list every column you query (a model generated by `genModelsByTabs` does). A name that matches nothing is rejected before the database is reached, an empty `$in` included (`delAll({ misspelled: { $in: [] } })` rejects instead of matching nothing silently). A `DATE` value (a `Date`, an epoch number, truncated to whole milliseconds, or an ISO string with a time zone) must fall in the years 1 to 9999 (UTC) and is always sent as a `Date`.

A primary key value whose type does not fit the primary key column (for example `'abc'` or `12.4` for an integer key; a number for a string key is converted to its string form instead) is an invalid key: `selectByPk` returns `null`, `del` reports that row with `ok: 0`, and `insert`, `insertBulk` and `save` reject without writing anything.

Model files are only read, never rewritten; an `id` column that lacks `primaryKey: true` is treated as the primary key in memory.

### Breaking changes: condition whitelist

The condition syntax was cut down to the whitelist above (series wide, issue "condition whitelist"). The "before" column is what the previous release (1.1.9) did, checked by running it on sqlite against six rows; there is no transition period.

| `find` | before (1.1.9) | now |
|---|---|---|
| `null`, `[]`, `[{ id: 'a' }]`, a string, a number, `true`, a function, a `BigInt`, a `Symbol`, a `Proxy` around `{}` as the whole `find` | `select` returned **every row** and `delAll` **deleted every row** (treated as `{}`) | rejects: `invalid find: condition must be a plain object …` (a `Proxy` around `{}`: `an empty find must be an ordinary object`) |
| `$not`, `$nor`, `$exists` | supported | rejects (`unsupported operator`); express it with `$ne` / `$nin` / `$and` / `$or` (see the portable forms above) |
| `$regex` with `$options`, a `RegExp` value | literal substring match through `LIKE` | rejects; `select` and filter in memory |
| an array as a column value, `{ col: [1, 2] }` | treated as `$in` (a `null` inside included) | rejects: `array value is not supported, use $in`; write `{ col: { $in: [1, 2] } }` |
| sequelize `Op` symbols as keys (`Op.or`, `Op.in`, `Op.between`, `Op.like`, `Op.and`, `Op.not` …) | accepted | rejects: `symbol key is not allowed` |
| `null` inside `$in` | accepted (`IN (…) OR IS NULL`) | rejects; use `{ $or: [{ col: null }, { col: { $in: […] } }] }` |
| `null` inside `$nin` | accepted (`NOT IN (…) AND IS NOT NULL`) | rejects; drop the `null`: `{ col: { $nin: […] } }` already skips `NULL` rows (SQL three valued logic); for `$nin: [null]` alone use `{ col: { $ne: null } }` |
| `$nin: []` | matched **every row** (`delAll` deleted all) | rejects |
| `$and: [{}]`, `$or: [{}]` | matched **every row** | rejects: `empty condition` |
| a getter or non enumerable property, an array with extra properties, a string with a lone surrogate | accepted (the getter was called) | rejects |
| a `Buffer` value on a column the model does not classify (for example `BLOB`) | accepted (`= X'…'`) | rejects: `unsupported value type` |
| a string containing NUL | database error | rejects |
| `$and` / `$or` with 999 items | `select` failed on sqlite with `Expression tree is too large` while `delAll` went through | accepted (the translation turns long lists, and columns listed side by side, into balanced trees, so nesting and length do not add up to the database limits), the limit is 999 items |
| `$and` / `$or` with more than 999 items | database error on sqlite | rejects before the database is reached |
| `$in` / `$nin` with more than 10000 values | accepted | rejects |
| a chain of 32 nested `$and` levels | rejects (`find is too deep`) | accepted (the limit is 32 levels) |
| a column name outside `^[\p{L}_][\p{L}\p{M}\p{N}_]*$` (for example `p$x`) | accepted when the model listed that column | rejects: `unsupported column name` |
| the same object repeated so that the condition expands exponentially | database error or the process ran out of memory | rejects: `condition is too large` |

`select(null, connState)` and `delAll(null)` style calls must become `select({}, connState)` / `delAll({})` (or no argument). The options `ctx.escape` and `ctx.dialect` of `cvFind` are no longer used (they were only needed by `$regex`) and are ignored.

### Dates on write: years 1 to 9999

`insert`, `insertBulk` and `save` **reject** a `DATE` or `DATEONLY` value that is not a valid time in the years 1 to 9999, on every dialect. Why: sqlite stores a date as text (`'2026-01-01 00:00:00.000 +00:00'`), and a year outside the range gives text that does not sort like the time it stands for. `new Date(8.64e15)`, the usual "never expires" sentinel, is stored as `'275760-09-13 …'`, which sorts *before* `'3000-…'`, so `delAll({ d: { $lt: someDate } })` deleted it and `$gt` missed it. mssql (`datetimeoffset`, `date`) only covers years 1 to 9999 anyway and fails in the database; this package now refuses before sending, so both dialects behave the same.

| Column | The value is checked as | Rejected examples | Accepted examples |
|---|---|---|---|
| `DATE` | the time it stands for (a `Date`, an epoch number, a date string, whatever `new Date(value)` accepts), by its UTC year | `new Date(8.64e15)`, `new Date(-8.64e15)`, `new Date('+010000-01-01T00:00:00Z')`, `'0000-12-31T23:59:59.999Z'`, `8.64e15` | `new Date('0001-01-01T00:00:00.000Z')`, `new Date('9999-12-31T23:59:59.999Z')`, `null` |
| `DATEONLY` | the `YYYY-MM-DD` text that is actually stored (the calendar year of the host time zone for a `Date`) | the same values as above, `'+010000-01-01'`, `'0000-12-31'` | `'0001-01-01'`, `'9999-12-31'`, `'2026-06-15'` |

The whole call rejects (`save` too: it does not turn this into a per row `ok: 0`) and **nothing is written**, even for the valid rows of the same batch. The error is emitted once as the `error` event before the promise rejects, and no `change` event is emitted. The message never quotes the value, it names the position and the column of the first offender (in the order the model lists its attributes):

```alias
invalid data: date is not a valid time in years 1-9999 at [data[1].expireAt]
```

For a "never expires" marker write `null` (the usual choice, and `{ expireAt: null }` is queryable), or `new Date('9999-12-31T23:59:59.999Z')`.

A value that is not a valid time at all is rejected the same way: `new Date(NaN)`, `NaN`, `Infinity`, `''`, `false`, `'garbage'`, an epoch beyond ±8.64e15, a `BigInt` or a `Symbol` (only `0`, the epoch, is a valid falsy value). sqlite would store the text `Invalid date`, which sorts after every year, so `$gt` and `delAll` would match it by mistake, and mssql fails in the database. Objects that sequelize converts more than once (`Date` subclasses, `new Number(…)`, arrays, objects with their own `valueOf` / `toString`) are evaluated once and replaced in the copy of your data by the checked value, so what is checked is exactly what is stored. `Sequelize.fn` / `literal` / `col` values are SQL expressions you chose and are not checked. Only the value given for the attribute is checked: a custom `set` function of the model that rewrites it afterwards is not.

**Rows written before this version are not migrated or read differently.** A row that already holds an out of range date (sqlite text such as `275760-09-13 …`, `-271821-…`, `10000-…`, `0000-…`) still sorts wrongly: conditions on that column can match it by mistake or miss it, and `delAll` follows the same comparison. Clean it up yourself, for example by reading the rows without a date condition and writing `null` (or the 9999 value above) over the stored text:

```alias
let rows = await w.select({})
// sqlite returns the stored text; a well formed date starts with a 4 digit year from 0001
let bad = rows.filter((v) => typeof v.expireAt === 'string' && (!/^\d{4}-/.test(v.expireAt) || v.expireAt.startsWith('0000-')))
await w.save(bad.map((v) => ({ id: v.id, expireAt: null })))
```

### Breaking changes: dates on write

Checked by running the previous release (1.1.10) on sqlite.

| Written value (`DATE` / `DATEONLY` column) | before (1.1.10) | now |
|---|---|---|
| `new Date(8.64e15)`, `new Date(-8.64e15)`, `8.64e15`, `-8.64e15`, `'+010000-01-01T00:00:00Z'`, `'0000-12-31T23:59:59.999Z'` | stored as the text `275760-09-13 …`, `-271821-04-20 …`, `10000-01-01 …`, `0000-12-31 …` (in a `DATEONLY` column `275760-09-13`, `Invalid date`, `10000-01-01`, `0000-12-31`) | `insert` / `insertBulk` / `save` reject as a whole (`invalid data: date is not a valid time in years 1-9999 at [data[i].column]`), nothing is written |
| the same values on mssql | the database failed the conversion (`Conversion failed when converting date and/or time from character string.`): `insert` rejected but kept the valid rows before the offender, `insertBulk` rejected and wrote nothing, `save` resolved with `ok: 0` for that row and wrote the others | rejected before sending as a whole, nothing is written, with the same message |
| years 1 to 9999 (`0001-01-01T00:00:00.000Z` … `9999-12-31T23:59:59.999Z`) | stored | stored (unchanged) |
| `new Date(NaN)`, `NaN`, `''`, `false`, `'garbage'`, `1e16`, a `BigInt`, a `Symbol` | sqlite: stored as the text `Invalid date` (it sorts after every year); mssql: the database failed the conversion | rejected as a whole, nothing is written (`0`, the epoch, stays valid) |

`inDateRange` and `genDateChecker` are new exports of `src/cvFind.mjs`; the condition side (`select` / `delAll`) and the write side use the same range test.

### Concurrency

The scope of the atomicity guarantee, by range:

| Range | Guaranteed | Provided by |
|---|---|---|
| Cross process — several processes against the same database | Yes | The database itself. `insert` and `save` write through single conditional statements, and the primary key unique constraint decides the winner. Independent of `opt.useStable`. |
| Single process — several parallel calls in one process | Yes **when `opt.useStable` is `true`** (the default) | A built-in queue that runs one operation at a time. |
| Single process, with `opt.useStable` set to `false` | **No** | — |

**Do not issue parallel calls from one process while `opt.useStable` is `false`.** Each instance holds one shared connection, opened at the start of a call and closed at its end, so a second call running in parallel closes the connection the first one is still using. Measured on 30 parallel calls in a single process: sqlite raised `SQLITE_MISUSE: Database handle is closed` and rejected 12 of the batches, mssql reported `ConnectionManager.getConnection was called after the connection manager was closed!` as a per row failure; both ended with 29 of the 30 rows written, so writes are silently lost. Keep the default `true`, or serialize the calls yourself (for example `await` them one by one).

Cross process was measured with 2 independent processes against the same 20 primary keys: `nInserted` summed to exactly 20 with 20 rows in the table, and with each process writing a different column to those keys all 40 operations returned `ok: 1` with both columns preserved on all 20 rows. sqlite was repeated over 6 rounds to rule out timing dependent `SQLITE_BUSY`. Platform: Windows 11, Node 24, sequelize 6, MSSQL 2022.

## Before Installation
> If you need to use encrypted sqlite, you need to manually install `@journeyapps/sqlcipher`, as follows:
>1. Open visual studio code by system administrator.
>2. Open the project folder, and need to make sure the words of path are `ascii` for Python 2.7.
>3. Install `windows-build-tools` into npm global first, and specify with `vs2015`. Use command to install: `npm i -g windows-build-tools --vs2015`.
>4. Install `@journeyapps/sqlcipher` second, use command to install: `npm i @journeyapps/sqlcipher`.

## Installation

### Using npm(ES6 module):

> **Note:** `@journeyapps/sqlcipher` is not compiled into the *.umd file by default, and it is not tied to the dependents for general use in package.json.

```alias
npm i w-orm-reladb
```

#### Example for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-mssql.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function test() {


    //w
    let w = wo(opt)


    //createStorage, create table for mssql
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)


    //select by $or, $and, $ne, $in, $nin
    let spc = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
    console.log('select by $or, $and, $ne, $in, $nin', spc)


    //select by equality (there is no pattern matching: filter in memory for substrings)
    let sr = await w.select({ name: 'peter(modify)' })
    console.log('selectEq', sr)


    //del
    let d = []
    if (ss) {
        d = ss.filter(function(v) {
            return v.name !== 'kettle'
        })
    }
    await w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


}
test()
// createStorage
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $and, $gt, $lt [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $or, $gte, $lte [
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select by $or, $and, $ne, $in, $nin [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// selectEq [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
```

#### Example of commit transaction for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-mssql-transaction-commit.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function testCommit() {


    //w
    let w = wo(opt)


    //createStorage, create table for mssql
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //connState
    let instance = await w.init()
    let transaction = await w.genTransaction()
    let connState = {
        instance, //可由外部初始化共用instance, 可單獨使用不另外給transaction
        transaction, //若外部使用共用之transaction, 亦需使用共用instance
    }
    console.log('init')


    //insert
    await w.insert(rs, connState)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { ...connState, autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //del
    await w.del({ id: 'id-rosemary' }, connState)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //select all
    let ssBeforeCommit = await w.select({}, connState)
    console.log('select all (before commit)', ssBeforeCommit) //此時select可查到暫時有效的數據
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //commit
    await transaction.commit()
    console.log('commit')


    //close
    await instance.close()
    console.log('close')


    //select all
    let ssFinal = await w.select()
    console.log('select all (final)', ssFinal)
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //check
    let rPeter = ssFinal.filter((v) => {
        return v.name === 'peter(modify)'
    })
    let bPeter = rPeter?.[0]?.value === 123

    let rRosemary = ssFinal.filter((v) => {
        return v.name === 'rosemary(modify)'
    })
    let bRosemary = rRosemary?.[0]?.value === 123.456

    let rKettle = ssFinal.filter((v) => {
        return v.name === 'kettle'
    })
    let bKettle = rKettle?.[0]?.value === 456

    if (bPeter && !bRosemary && bKettle) {
        console.log('commit success')
    }
    else {
        console.log('commit error')
    }


}
testCommit()
// createStorage
// change delAll
// delAll then { n: 2, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before commit) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit
// close
// select all (final) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit success
```

#### Example of rollback transaction for mssql
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-mssql-transaction-rollback.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function testRollback() {


    //w
    let w = wo(opt)


    //createStorage, create table for mssql
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //connState
    let instance = await w.init()
    let transaction = await w.genTransaction()
    let connState = {
        instance, //可由外部初始化共用instance, 可單獨使用不另外給transaction
        transaction, //若外部使用共用之transaction, 亦需使用共用instance
    }
    console.log('init')


    //insert
    await w.insert(rs, connState)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { ...connState, autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //del
    await w.del({ id: 'id-rosemary' }, connState)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //select all
    let ssBeforeRollback = await w.select({}, connState)
    console.log('select all (before rollback)', ssBeforeRollback) //此時select可查到暫時有效的數據
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //rollback
    await transaction.rollback()
    console.log('rollback')


    //close
    await instance.close()
    console.log('close')


    //select all
    let ssFinal = await w.select()
    console.log('select all (final)', ssFinal)
    // => []


    //check
    let rPeter = ssFinal.filter((v) => {
        return v.name === 'peter(modify)'
    })
    let bPeter = rPeter?.[0]?.value === 123

    let rRosemary = ssFinal.filter((v) => {
        return v.name === 'rosemary(modify)'
    })
    let bRosemary = rRosemary?.[0]?.value === 123.456

    let rKettle = ssFinal.filter((v) => {
        return v.name === 'kettle'
    })
    let bKettle = rKettle?.[0]?.value === 456

    if (!bPeter && !bRosemary && !bKettle) {
        console.log('rollback success')
    }
    else {
        console.log('rollback error')
    }


}
testRollback()
// createStorage
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before rollback) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// rollback
// close
// select all (final) []
// rollback success
```

#### Example for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function test() {
    //測試sqlite


    //w
    let w = wo(opt)


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //createStorage, create table for sqlite
    await w.createStorage()
    console.log('createStorage')


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)


    //select by $or, $and, $ne, $in, $nin
    let spc = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
    console.log('select by $or, $and, $ne, $in, $nin', spc)


    //select by equality (there is no pattern matching: filter in memory for substrings)
    let sr = await w.select({ name: 'peter(modify)' })
    console.log('selectEq', sr)


    //del
    let d = []
    if (ss) {
        d = ss.filter(function(v) {
            return v.name !== 'kettle'
        })
    }
    await w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


}
test()
// createStorage
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $and, $gt, $lt [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $or, $gte, $lte [
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select by $or, $and, $ne, $in, $nin [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// selectEq [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
```

#### Example commit transaction for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite-transaction-commit.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function testCommit() {


    //w
    let w = wo(opt)


    //createStorage, create table for sqlite
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //connState
    let instance = await w.init()
    let transaction = await w.genTransaction()
    let connState = {
        instance, //可由外部初始化共用instance, 可單獨使用不另外給transaction
        transaction, //若外部使用共用之transaction, 亦需使用共用instance
    }
    console.log('init')


    //insert
    await w.insert(rs, connState)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { ...connState, autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //del
    await w.del({ id: 'id-rosemary' }, connState)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //select all
    let ssBeforeCommit = await w.select({}, connState)
    console.log('select all (before commit)', ssBeforeCommit) //此時select可查到暫時有效的數據
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //commit
    await transaction.commit()
    console.log('commit')


    //close
    await instance.close()
    console.log('close')


    //select all
    let ssFinal = await w.select()
    console.log('select all (final)', ssFinal)
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //check
    let rPeter = ssFinal.filter((v) => {
        return v.name === 'peter(modify)'
    })
    let bPeter = rPeter?.[0]?.value === 123

    let rRosemary = ssFinal.filter((v) => {
        return v.name === 'rosemary(modify)'
    })
    let bRosemary = rRosemary?.[0]?.value === 123.456

    let rKettle = ssFinal.filter((v) => {
        return v.name === 'kettle'
    })
    let bKettle = rKettle?.[0]?.value === 456

    if (bPeter && !bRosemary && bKettle) {
        console.log('commit success')
    }
    else {
        console.log('commit error')
    }


}
testCommit()
// createStorage
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before commit) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit
// close
// select all (final) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// commit success
```

#### Example rollback transaction for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite-transaction-rollback.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
    storage: './worm.sqlite',
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function testRollback() {


    //w
    let w = wo(opt)


    //createStorage, create table for sqlite
    await w.createStorage()
    console.log('createStorage')


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //connState
    let instance = await w.init()
    let transaction = await w.genTransaction()
    let connState = {
        instance, //可由外部初始化共用instance, 可單獨使用不另外給transaction
        transaction, //若外部使用共用之transaction, 亦需使用共用instance
    }
    console.log('init')


    //insert
    await w.insert(rs, connState)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { ...connState, autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //del
    await w.del({ id: 'id-rosemary' }, connState)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //select all
    let ssBeforeRollback = await w.select({}, connState)
    console.log('select all (before rollback)', ssBeforeRollback) //此時select可查到暫時有效的數據
    // => [
    //     { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //     { id: '{random id}', name: 'kettle', value: 456 }
    // ]


    //rollback
    await transaction.rollback()
    console.log('rollback')


    //close
    await instance.close()
    console.log('close')


    //select all
    let ssFinal = await w.select()
    console.log('select all (final)', ssFinal)
    // => []


    //check
    let rPeter = ssFinal.filter((v) => {
        return v.name === 'peter(modify)'
    })
    let bPeter = rPeter?.[0]?.value === 123

    let rRosemary = ssFinal.filter((v) => {
        return v.name === 'rosemary(modify)'
    })
    let bRosemary = rRosemary?.[0]?.value === 123.456

    let rKettle = ssFinal.filter((v) => {
        return v.name === 'kettle'
    })
    let bKettle = rKettle?.[0]?.value === 456

    if (!bPeter && !bRosemary && !bKettle) {
        console.log('rollback success')
    }
    else {
        console.log('rollback error')
    }


}
testRollback()
// createStorage
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// init
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all (before rollback) [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// rollback
// close
// select all (final) []
// rollback success
```

#### Example of sqlcipher for sqlite
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/g-sqlite-encryption.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `sqlite://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
    storage: './worm.sqlite',
    useEncryption: true,
}

//因worm.sqlite可能為加密數據, 若有切換useEncryption時得先刪除, 再通過createStorage重新產生
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function test() {
    //測試加密sqlite
    //安裝@journeyapps/sqlcipher方式：
    //1.visual studio code得使用系統管理員權限開啟
    //2.開啟專案資料夾, 確定路徑內不能含有中文, 否則python2.7無法接受
    //3.先安裝windows-build-tools並指定安裝vs2015, 使用指令安裝至全域: npm i -g windows-build-tools --vs2015
    //4.若切換或重新安裝nodejs, 因全域環境不同, 記得得要重裝windows-build-tools
    //5.安裝@journeyapps/sqlcipher: npm i @journeyapps/sqlcipher


    //w
    let w = wo(opt)


    //genModelsByDB, disable if got models
    // await w.genModelsByDB({
    //     username,
    //     password,
    //     dialect: 'mssql', //default
    //     host: 'localhost', //default
    //     port: 1433, //default
    //     db: opt.db,
    //     fdModels: opt.fdModels,
    // })


    //createStorage, create table for sqlite
    await w.createStorage()
    console.log('createStorage')


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)


    //select by $or, $and, $ne, $in, $nin
    let spc = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
    console.log('select by $or, $and, $ne, $in, $nin', spc)


    //select by equality (there is no pattern matching: filter in memory for substrings)
    let sr = await w.select({ name: 'peter(modify)' })
    console.log('selectEq', sr)


    //del
    let d = []
    if (ss) {
        d = ss.filter(function(v) {
            return v.name !== 'kettle'
        })
    }
    await w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


}
test()
// createStorage
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //autoInsert=false
//   { n: 1, nInserted: 1, nModified: 0, ok: 1 } //autoInsert=true
// ]
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $and, $gt, $lt [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// ]
// select by $or, $gte, $lte [
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// select by $or, $and, $ne, $in, $nin [
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 }
// ]
// selectEq [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 }
// ]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
```

#### Example for genModelsByTabs
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-reladb/blob/master/sp-genModelsByTabs.mjs)]
```alias
import wo from 'w-orm-reladb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mssql://${username}:${password}@localhost:1433`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'json',
    // autoGenPk: false,
}

let fd = opt.fdModels
let tabs = {
    tb1: {
        id: {
            type: 'STRING', //主鍵不能使用TEXT
            pk: true,
        },
        title: 'TEXT',
        price: 'DOUBLE',
        isActive: 'INTEGER',
    },
    tb2: {
        sid: {
            type: 'STRING', //主鍵不能使用TEXT
            pk: true,
        },
        name: 'TEXT',
        size: 'DOUBLE',
        age: 'INTEGER',
    },
    tb3: {
        keyINTEGER: 'INTEGER',
        keyBIGINT: 'BIGINT',
        keyFLOAT: 'FLOAT', //精確度7位
        keyDOUBLE: 'DOUBLE', //精確度15~16位
        keyDECIMAL: 'DECIMAL', //精確度28~29位
        keyDATE: 'DATE',
        keyBOOLEAN: 'BOOLEAN',
        keySTRING: 'STRING',
        keyTEXT: 'TEXT',
    },
}

async function test() {
    //測試使用數據tabs並呼叫genModelsByTabs來產生models


    //w
    let w = wo(opt)


    //genModelsByTabs, 預設產生js格式的設定檔
    w.genModelsByTabs(fd, tabs)


    //genModelsByTabs, 產生json格式的設定檔
    w.genModelsByTabs(fd, tabs, { type: 'json' })


}
test()
// generate file:  ./models/tb1.js
// generate file:  ./models/tb2.js
// generate file:  ./models/tb3.js
// generate file:  ./models/tb1.json
// generate file:  ./models/tb2.json
// generate file:  ./models/tb3.json

// tb1.json
// {
//     table: 'tb1',
//     fields: {
//         id: {
//             type: 'DataTypes.STRING',
//             primaryKey: true,
//             allowNull: false,
//             autoIncrement: false,
//             comment: null,
//         },
//         title: {
//             type: 'DataTypes.TEXT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         price: {
//             type: 'DataTypes.DOUBLE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         isActive: {
//             type: 'DataTypes.INTEGER',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//     },
//     options: {
//         tableName: 'tb1',
//     },
// }

// tb1.js
// module.exports = function(sequelize, DataTypes) {
//     return sequelize.define('tb1', {
//     "id": {
//         "type": DataTypes.STRING,
//         "primaryKey": true,
//         "allowNull": false,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "title": {
//         "type": DataTypes.TEXT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "price": {
//         "type": DataTypes.DOUBLE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "isActive": {
//         "type": DataTypes.INTEGER,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     }
// }, {
//         tableName: 'tb1'
//     });
// };

// tb2.json
// {
//     table: 'tb2',
//     fields: {
//         sid: {
//             type: 'DataTypes.STRING',
//             primaryKey: true,
//             allowNull: false,
//             autoIncrement: false,
//             comment: null,
//         },
//         name: {
//             type: 'DataTypes.TEXT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         size: {
//             type: 'DataTypes.DOUBLE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         age: {
//             type: 'DataTypes.INTEGER',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//     },
//     options: {
//         tableName: 'tb2',
//     },
// }

// tb2.js
// module.exports = function(sequelize, DataTypes) {
//     return sequelize.define('tb2', {
//     "sid": {
//         "type": DataTypes.STRING,
//         "primaryKey": true,
//         "allowNull": false,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "name": {
//         "type": DataTypes.TEXT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "size": {
//         "type": DataTypes.DOUBLE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "age": {
//         "type": DataTypes.INTEGER,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     }
// }, {
//         tableName: 'tb2'
//     });
// };
    
// tb3.json
// {
//     table: 'tb3',
//     fields: {
//         keyINTEGER: {
//             type: 'DataTypes.INTEGER',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyBIGINT: {
//             type: 'DataTypes.BIGINT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyFLOAT: {
//             type: 'DataTypes.FLOAT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyDOUBLE: {
//             type: 'DataTypes.DOUBLE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyDECIMAL: {
//             type: 'DataTypes.DECIMAL',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyDATE: {
//             type: 'DataTypes.DATE',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyBOOLEAN: {
//             type: 'DataTypes.BOOLEAN',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keySTRING: {
//             type: 'DataTypes.STRING',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//         keyTEXT: {
//             type: 'DataTypes.TEXT',
//             primaryKey: false,
//             allowNull: true,
//             autoIncrement: false,
//             comment: null,
//         },
//     },
//     options: {
//         tableName: 'tb3',
//     },
// }

// tb3.js
// module.exports = function(sequelize, DataTypes) {
//     return sequelize.define('tb3', {
//     "keyINTEGER": {
//         "type": DataTypes.INTEGER,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyBIGINT": {
//         "type": DataTypes.BIGINT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyFLOAT": {
//         "type": DataTypes.FLOAT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyDOUBLE": {
//         "type": DataTypes.DOUBLE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyDECIMAL": {
//         "type": DataTypes.DECIMAL,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyDATE": {
//         "type": DataTypes.DATE,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyBOOLEAN": {
//         "type": DataTypes.BOOLEAN,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keySTRING": {
//         "type": DataTypes.STRING,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     },
//     "keyTEXT": {
//         "type": DataTypes.TEXT,
//         "primaryKey": false,
//         "allowNull": true,
//         "autoIncrement": false,
//         "comment": null
//     }
// }, {
//         tableName: 'tb3'
//     });
// };
```

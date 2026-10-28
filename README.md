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

A primary key value whose type does not fit the primary key column (for example `'abc'` or `12.4` for an integer key; a number for a string key is converted to its string form instead) is an invalid key: `selectByPk` returns `null`, `del` reports that row with `ok: 0`, and `insert`, `insertBulk` and `save` reject without writing anything. A string key with a lone surrogate or a NUL is refused as well, with a different outcome for `save` (that row only gets `ok: 0`), see "Well formed strings" below.

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

### `defaultScope` of a model: always combined with AND

A model may carry a `defaultScope` (`{ defaultScope: { where: … } }` in its definition). The `where` of the scope is combined with AND with every condition this package sends to the database: the `find` of `select` and `delAll` (`scope AND find`), and the primary key condition of `selectByPk`, `del` and `save`. Only the `where` is covered: `insert`, `insertBulk` and `save` do not check the rows you write against the scope, and the other scope options (`limit`, `offset`, `group`, `having`, `include`) are applied by `select` and `selectByPk` only, while `del` and `delAll` ignore them (`delAll` refuses such a model, see below).

sequelize merges the two `where` objects by `Object.assign` by default, so a key of your `find` replaced the same key of the scope, and a scope written as `Sequelize.literal(…)` or `Sequelize.where(…)` was **dropped completely**: `select` returned rows outside the scope and `delAll` deleted them. This package now creates its Sequelize instance with `define: { whereMergeStrategy: 'and' }` and sets the same strategy on the model it imports (a model that declares `whereMergeStrategy: 'overwrite'` in its own options would otherwise override the instance default; it is switched to `'and'` after the import), so the scope and the condition are always joined with AND, for every kind of scope `where`: plain keys, `Op.or`, `Op.and`, `Sequelize.literal` and `Sequelize.where`. `delAll` stays refused for a model whose `defaultScope` has `limit`, `offset`, `group`, `having` or a non-empty `include` (`select` and the delete would not touch the same rows), and, kept as it was, for a `where` that uses `Op.and` (with the AND merge described here `select` and the delete now do touch the same rows for that case; the refusal is kept for compatibility, and its message still carries the older wording).

| Model `defaultScope.where` | before (1.1.13) | now |
|---|---|---|
| plain keys (`{ g: 'A' }`), `Op.or` | combined with AND (the condition built by this package has `Op.and` on top, so no key of the scope was replaced) | unchanged |
| `Sequelize.literal(…)`, `Sequelize.where(…)` | the scope was ignored: `select` returned every row matching the `find`, `delAll` deleted rows outside the scope (also `selectByPk` and `del`) | combined with AND |
| `Op.and` | `select` ignored the scope (`delAll` was refused) | `select` applies the scope (`delAll` is still refused) |
| any scope, `save` of a primary key that already exists **outside** the scope | with `Sequelize.literal` / `Sequelize.where` the scope was ignored and the row was updated (`nModified: 1`); with the other scopes it failed | fails for every kind of scope: the pre-read does not see the row, `save` turns to an insert, the insert hits the existing key and the call ends with `ok: 0` and `can not save data[i].<pk> in 3 tries`; the row is not touched (with `autoInsert: false` it reports `nModified: 0`) |

### Date conditions without a time zone: `ctx.dateNoTz` (`'local'`, `'floating'`) and `toFloating`

This is for packages that sit on top of `cvFind` (`w-orm-mdb` does); `select` and `delAll` of this package never set it, so they keep rejecting a date string without a time zone. `cvFind(find, { attrs, dateNoTz })` accepts `undefined` (default), `'local'` or `'floating'`; anything else throws `invalid ctx: dateNoTz must be 'local', 'floating' or undefined, got [x]`.

- `'local'` reads a string without a time zone (`2026-01-01T00:00:00`, or with a single space) in the **host time zone** and rejects the years 1 to 99 (JavaScript's `new Date(y, …)` maps them to 1900 to 1999). It is unchanged and has a known defect for backends that keep wall clock times without any time zone (such as Jet): in a time zone behind UTC (the Americas, for instance) the sentinel `9999-12-31 23:59:59` becomes year 10000 in UTC, sorts before `2026-…` as text and is **matched by `$lt` today and deleted by `delAll`**, and using the sentinel as a condition value is rejected; in a time zone with daylight saving time (Berlin, Lord Howe) a wall clock time inside the skipped hour is normalised. Use `'floating'` for such backends.
- `'floating'` turns every `DATE` condition value (strings without a time zone, a `Date`, an epoch number, a string with a time zone; every element of `$in` / `$nin` too) into a **wall clock time** and sends that wall clock time as if it were UTC: a string without a time zone is taken as it is; a `Date`, an epoch number or a string with a time zone is first an instant and then read through its **local** fields (so `new Date(2026, 0, 1)` is always `2026-01-01T00:00:00Z`, whatever the host time zone). Years 1 to 9999 of the wall clock are accepted (`'local'` refuses 1 to 99); a time inside a skipped hour is valid; an ambiguous hour is compared by its wall clock (no "earlier one wins"). A date without a time (`'2026-01-01'`) is still rejected. Result: conditions that name the same wall clock time (a string without a time zone, or a `Date` / epoch built from the same local fields) give the same rows in every time zone (checked on 12 time zones, sqlite and mssql, 108 conditions each). A fixed instant such as `new Date('2026-01-01T00:00:00Z')` or an epoch constant is read through the host's local fields, so it names a different wall clock time in each time zone.
- `toFloating(v)` (exported by `src/cvFind.mjs`) applies the same rule to a `Date`, an epoch number or a string and returns the floating `Date`, or `null` when the value is not acceptable (it never throws). The caller builds the `DATE` values of its in-memory table with it, so that conditions and data live in the same floating space.

Three obligations of the caller, because breaking them silently returns or deletes the wrong rows: (1) **a floating `Date` is the result of the encoding, not an input**: `toFloating(toFloating(x))` and a `Date` read back from the table used as a `'floating'` condition shift the time a second time (not a no-op in any time zone but UTC); (2) **when `toFloating` returns `null`, reject the whole batch**; never store the original value or `NULL` instead (a `NULL` row is skipped by `$lt` / `$gt` and matched by `{ col: null }`, the very mistakes `'floating'` removes); (3) **use `'floating'` and `toFloating` together**: a table filled with ordinary dates and queried with `'floating'` (or the other way round) matches the wrong rows without any error.

### Well formed strings: primary keys, written data and names

A string with a **lone surrogate** (half of a UTF-16 surrogate pair; `s.isWellFormed()` is `false`) cannot be stored as it is: the database turns the lone half into U+FFFD (sqlite stores text as UTF-8), so different keys become one key. On sqlite `'a\uD800'`, `'a\uDC00'` and `'a\uFFFD'` are the same primary key: `insert` skipped the "duplicate", `save` overwrote the other row, `selectByPk` and `del` hit a row that was never meant (checked on the previous release, 1.1.12). The conditions of `select` and `delAll` have refused such strings for a long time; the write side and the primary key functions now apply the same standard, series wide (shared with the other `w-orm-*` packages through `chkOrmStr` and `chkOrmData` of `wsemi`). Everything below happens **before the model files are loaded, before a connection is made and before anything is read, written or deleted**, on the copy of your data that is used for writing (made when you call the function), and it does not depend on `opt.autoGenPk`: a bad key you supplied is never replaced by a generated one. U+FFFD itself and valid pairs (emoji, rare CJK characters) are well formed and accepted as before.

| What | Refused |
|---|---|
| the primary key value (also a `new String(…)` wrapper) | a lone surrogate, and also `NUL` (`\u0000`), the same standard as a `find` |
| every string value and key name inside the data of `insert`, `insertBulk` and `save` (nested objects, array items, `Map` / `Set` content, `Error` / `RegExp` text …), **whether or not the model has that column** | a lone surrogate (a `NUL` inside a value is not refused by this check) |
| `opt.url`, `opt.db`, `opt.cl`, `opt.storage` | a lone surrogate: **the constructor throws** `invalid opt.<name>: string contains lone surrogate` (two different names would otherwise point to the same storage, for example two sqlite files) |

| Function | What happens with a bad primary key or bad data |
|---|---|
| `insert`, `insertBulk` | the whole call rejects and **nothing is written**, the error is emitted once as the `error` event before the promise rejects, no `change` event |
| `save` | **only that row** reports `{ n: 1, nInserted: 0, nModified: 0, ok: 0, err }` (also with `autoInsert: false`), the other rows are processed as usual; nothing is read or written for the bad row, and when every row is bad no connection is made at all |
| `del` | only that row reports `{ n: 0, nDeleted: 0, ok: 0, err }`, the other rows are deleted as usual; only the primary key is checked, the other fields of the row you pass are not; when every row is bad no connection is made at all |
| `selectByPk` | `null` (a closed instance still rejects first) |
| `select`, `delAll` | unchanged: the condition check rejects with `invalid find: …` |

The messages are fixed words and **never quote the value**; the position uses the index of the row in your array (`data[0]` when you pass a single object):

```alias
invalid id: string contains lone surrogate at [data[1].id]
invalid id: string contains NUL at [data[1].id]
invalid data: string contains lone surrogate at [data[1].meta.tags[0]]
invalid data: string contains lone surrogate at [data[1].<invalid key>]
invalid opt.cl: string contains lone surrogate
```

Per row the primary key comes before the data and a key name before its value; for `insert` / `insertBulk` the row with the smallest index is reported. The other error messages that used to quote the primary key do not any more (`invalid id[…]` and `type does not match pk column` now read `invalid data[<index>].<pk>…`; the `save` message after three failed tries names the position instead of the key).

Known limits: a `new String('…')` inside the data that holds a valid pair is neither unwrapped nor refused (the check follows the characters you wrote; nobody should store wrapper objects); output of a custom `toJSON` / `toString` / `valueOf` is not inspected; a custom `set` function of the model that rewrites a value afterwards is not checked either.

**Rows written before this version are not migrated or read differently.** On sqlite a lone surrogate written earlier was already replaced by U+FFFD by the database: the original text is gone, and the stored text is well formed, so nothing changes for those rows. mssql (`nvarchar`) kept the lone surrogate. To find such rows and remove them:

```alias
let bad = (await w.select()).filter((v) => typeof v.id === 'string' && !v.id.isWellFormed())
// selectByPk(bad[0].id) is null and del reports it with ok: 0 from now on (invalid id); address the row through another column,
// for example await w.delAll({ name: bad[0].name }) (a condition with a lone surrogate is refused as well), or clear the table with await w.delAll()
```

**Equal text on mssql.** On mssql the string comparison follows the database collation, and the default collation (for example `SQL_Latin1_General_CP1_CI_AS`) treats **well formed** strings such as `'a'`, `'a'` followed by an emoji and `'a'` followed by U+FFFD as equal (checked on SQL Server 2022: all three compare equal under the default collation and different under `Latin1_General_100_BIN2`). That is a property of the collation, like the case insensitivity already described above, not a malformed string, so this check cannot and does not change it, and `createStorage` still creates the tables with the database default collation. If keys or values must be compared exactly, create the table (or the column) with a binary collation such as `Latin1_General_100_BIN2`; be aware that this also makes the comparison case sensitive. sqlite compares binary and is not affected.

### Breaking changes: well formed strings

Checked by running the previous release (1.1.12) on sqlite (and on mssql where stated); there is no transition period.

| Input | before (1.1.12) | now |
|---|---|---|
| `insert` of a row whose key has a lone surrogate (`'a\uD800'`) | sqlite: stored as `'a\uFFFD'`, or skipped as a duplicate when `'a\uFFFD'` already exists (`nInserted` short by one, `ok: 1`); mssql: stored with the lone surrogate, or skipped as a duplicate when a key that compares equal under the collation (such as `'a\uFFFD'`) exists | the whole call rejects, nothing written: `invalid id: string contains lone surrogate at [data[i].id]` |
| `insertBulk` of such a row | sqlite: stored as `'a\uFFFD'`, or rejects as a duplicate key (`Validation error`) when it exists; mssql: stored with the lone surrogate, or `Validation error` when an equal key exists | rejects, nothing written (same message) |
| `save` of such a row | sqlite: overwrote the row `'a\uFFFD'`; mssql: updated the row that compares equal (and replaced its stored key by the lone surrogate), or inserted a new row | that row `ok: 0` with the same message, the other rows are saved |
| `del` of such a key | sqlite: deleted the row `'a\uFFFD'` (`ok: 1`); mssql: deleted the row that compares equal | that row `ok: 0` with the same message |
| `selectByPk` of such a key | sqlite and mssql: returned the row `'a\uFFFD'` | `null` |
| a key containing NUL | sqlite: `insert` stored it, while `insertBulk` rejected, `save` and `del` reported `ok: 0` and `selectByPk` rejected, all with a database error (`SQLITE_ERROR: unrecognized token`); mssql: `insert`, `insertBulk` and `save` stored the key with the NUL, `del` found nothing (`n: 0`) and `selectByPk` returned `null` | the same refusal as a lone surrogate (`invalid id: string contains NUL …`); a NUL inside a data value is not refused |
| a lone surrogate in a string value or key name of the data, at any depth (also columns the model does not list, which sequelize drops silently) | stored as `U+FFFD` text (sqlite) or as it is (mssql), or dropped | `insert` / `insertBulk` reject as a whole, `save` marks that row `ok: 0` (`invalid data: … at [data[i].path]`) |
| `opt.url`, `opt.db`, `opt.cl` or `opt.storage` with a lone surrogate | accepted (the storage path was converted, so two names could share one file) | the constructor throws `invalid opt.<name>: string contains lone surrogate` |
| error messages of `insert`, `insertBulk`, `save`, `del` for a primary key of the wrong type | quoted the key value (`invalid data[0].id[12.4], type does not match pk column [id]`, `invalid id[NaN]`) | no value: `invalid data[0].id, type does not match pk column [id]` (`insert`, `insertBulk`, `save`), `invalid data[0].id` and `invalid data[0].id, type does not match pk column` (`del`) |

`chkPkWf` and `chkWf` are new exports of `src/cvFind.mjs`; `normPk` keeps its signature and result shape (`{ kind, v }`) and now answers `{ kind: 'invalid' }` for a string with a lone surrogate or NUL.

### Concurrency

The scope of the atomicity guarantee, by range:

| Range | Guaranteed | Provided by |
|---|---|---|
| Cross process — several processes against the same database | Yes | The database itself. `insert` and `save` write through single conditional statements, and the primary key unique constraint decides the winner. Independent of `opt.useStable`. |
| Single process — several parallel calls in one process | Yes **when `opt.useStable` is `true`** (the default) | A built-in queue that runs one operation at a time. |
| Single process, with `opt.useStable` set to `false` | **No** | — |

**Do not issue parallel calls from one process while `opt.useStable` is `false`.** Each instance holds one shared connection, opened at the start of a call and closed at its end, so a second call running in parallel closes the connection the first one is still using. Measured on 30 parallel calls in a single process: sqlite raised `SQLITE_MISUSE: Database handle is closed` and rejected 12 of the batches, mssql reported `ConnectionManager.getConnection was called after the connection manager was closed!` as a per row failure; both ended with 29 of the 30 rows written, so writes are silently lost. Keep the default `true`, or serialize the calls yourself (for example `await` them one by one).

Cross process was measured with 2 independent processes against the same 20 primary keys: `nInserted` summed to exactly 20 with 20 rows in the table, and with each process writing a different column to those keys all 40 operations returned `ok: 1` with both columns preserved on all 20 rows. sqlite was repeated over 6 rounds to rule out timing dependent `SQLITE_BUSY`. Platform: Windows 11, Node 24, sequelize 6, MSSQL 2022.

### Diagnostic output: `opt.logDetail`, `opt.funLog` and `opt.logging`

Everything this package prints goes through **one exit**. By default that exit writes only a fixed label and a short summary that holds **no data value, no primary key, no user identity, no error text of the back end and no path** — the console of a service is often collected by a log system, and a row's primary key (a user id or e-mail in downstream systems) or the text of a driver error must not end up there by accident. Connection strings and credentials (`opt.url`, the user name and the password, also as `user:password`, URL encoded, as `scheme://user:password@host` and as the value of `PRAGMA key`) are **never** printed, not even in the detailed forms below: they are replaced by `***`.

| Option | Default | Effect |
|---|---|---|
| `opt.logDetail` | `false` | `true` restores the former detailed console output (the error a subscriber threw and the original error when a model cannot be imported, printed bare as before; the full SQL of `opt.logging`; the generated file path). It can show data values and ids: **for debugging only**. Anything other than `true` is ignored. |
| `opt.funLog` | none | A function `(label, safe, detail)`. When given, diagnostic output goes **only** to it, the console is not written. `label` is the fixed label, `safe` the summary without personal data (may be `undefined`), `detail` the full detail (the argument is absent when there is none), with credentials already replaced by `***`. Use it to mask and forward to your own logger. `detail` is a masked **copy**, bounded in size: plain objects (class instances become plain objects, the prototype is not kept), arrays, `Error`s (message, stack, `cause`, own fields such as `original` and `parameters`) and dates are copied; nesting deeper than 6 levels or more than 2000 nodes becomes `'[Truncated]'`, and functions, binary data, `Map`/`Set` and getters become markers (`'[Function]'`, `'[Binary 12 bytes]'`, `'[Object]'`, `'[Getter/Setter]'`). No code of yours (getters, custom `inspect`) is run to build it. Anything but a function is ignored; a function that throws, or returns a promise that rejects, never affects the operation. |
| `opt.logging` | `false` | `true` records the SQL that is executed. By default only the kind of statement is printed (`sql { stmt: 'SELECT' }`); the full SQL needs `logDetail` or `funLog`. |

**SQL records carry values.** `select`, `selectByPk`, `del` and `delAll` (and the read inside `save`) embed the values of the condition in the SQL text — `WHERE users.id = 'a@b.c'` — so the full SQL contains primary keys and column values. `insert`, `insertBulk` and the update of `save` use bind parameters (`$1`, `$2`, …) and the package keeps the sequelize option `logQueryParameters` off, so their values do not appear (checked on sqlite). That is why the full SQL is available only when you ask for it twice (`logging: true` together with `logDetail: true` or `funLog`), and why it is meant for debugging, not for production.

What is printed by default:

| Where | Before (1.1.15 and earlier) | Now |
|---|---|---|
| a `change` or `error` subscriber throws | `console.log(err)`: the whole error, including whatever the subscriber put in its message | `change handler threw { mode: 'insert', errType: 'Error' }` — the operation, the error class, and a machine code (`ENOENT`, `ELOGIN`, `SQLITE_…`, a small integer) when there is one |
| a model cannot be imported (file missing or throwing, database unreachable) | `console.log({ state: 'error', msg: <the original error> })`, with file paths, driver text, host and login | `can not import model { cl: 'users', errType: 'Error' }`. **To see the original error, set `logDetail: true`** (or read it from `funLog`). The reject message `can not import model: …` is unchanged. |
| `opt.logging: true` | sequelize wrote the full SQL with `console.log` | `sql { stmt: 'SELECT' }` per statement |
| `sqlcipher` does not support transactions | a fixed line | the same fixed line |
| the constructor throws for an invalid `opt.url` | `…, opt.url[mssql://user:password@host]` (the password in the message) | `…, opt.url[mssql://***@host]` (same prefix, same `Error`; see the breaking changes below) |
| `genModelsByTabs` | `generate file:  <path>`, `save file catch <error>` | `generate file: { name: 'users', type: 'js' }`, `save file catch { name: 'users', type: 'js', errType: 'Error', errCode: 'EISDIR' }` |
| `genModelsByDB` (needs `w-auto-sequelize` 1.0.51 or later) | sequelize's default logger wrote the full SQL of every table-structure query with `console.log`; when the list of tables or the foreign keys could not be read, `console.error(err)` wrote the whole error and the models were still generated | nothing on success; with `logging: true` one `genModelsByDB sql { stmt: 'SELECT' }` per statement (stdout); on failure one `genModelsByDB tables catch { errType: 'ConnectionError', errCode: 'SQLITE_CANTOPEN' }` or `genModelsByDB foreign keys catch { … }` (stderr, as before) |

```alias
// production: only labels and summaries on the console
let w = WOrmReladb({ url })

// debugging: the former detail, credentials still masked
let wd = WOrmReladb({ url, logging: true, logDetail: true })

// forward everything to your own logger, masking what you must
let wf = WOrmReladb({
    url,
    logging: true,
    funLog: (label, safe, detail) => {
        logger.info({ label, safe }) // safe holds no personal data
        // `detail` has full text, keys and values: mask it before it leaves your process
    },
})
```

`genModelsByDB` takes the same three options. By default it **inherits** the `logging`, `logDetail` and `funLog` given to the constructor; the `option` passed to a single call overrides them for that call (`logging` and `logDetail` must be booleans, `funLog` a function; anything else is ignored and the constructor's setting stays). Its labels carry the prefix `genModelsByDB ` (`genModelsByDB sql`, `genModelsByDB foreign keys catch`, `genModelsByDB tables catch`), and everything goes through the same exit, so the connection string `opt.url` and the credentials are masked as well, also in `detail`:

```alias
let w = WOrmReladb({ url, fdModels: './models', logging: true, funLog: (label, safe, detail) => { /* … */ } })

// inherits logging and funLog from the constructor
await w.genModelsByDB({ dialect: 'mssql', host, port, username, password })

// this call only: no SQL records
await w.genModelsByDB({ dialect: 'mssql', host, port, username, password, logging: false })

// this call only: a different receiver
await w.genModelsByDB({ dialect: 'mssql', host, port, username, password, funLog: (label, safe, detail) => { /* … */ } })
```

A `funLog` given at the constructor cannot be switched off for a single call (`null` counts as not given); give a different function instead.

### Breaking changes: diagnostic output

Only what is printed changes. The values a function resolves or rejects with, their timing, and the `change` and `error` events are the same as before.

- The detailed console output listed above is now opt-in (`opt.logDetail`).
- `opt.logging: true` no longer prints the SQL text by default: **to see the full SQL add `logDetail: true`, or read it from `funLog`**. By itself `logging: true` now prints only the kind of statement. It is passed to sequelize as a function, so the sequelize warning `SEQUELIZE0002` about `logging: true` is gone as well.

  ```alias
  // before (1.1.15 and earlier): full SQL on the console, ids and column values included
  WOrmReladb({ url, logging: true })

  // now: the same output, asked for explicitly (credentials in it are masked)
  WOrmReladb({ url, logging: true, logDetail: true })
  // or receive it yourself: funLog('sql', { stmt: 'SELECT' }, 'Executing (default): SELECT …')
  WOrmReladb({ url, logging: true, funLog: (label, safe, detail) => { /* … */ } })
  ```
- The constructor still throws an `Error` for an invalid `opt.url`, with the same message prefix as before (`no dialect in opt.url`, `invalid dialect in opt.url`, `invalid username or password in opt.url`, `invalid username in opt.url`, `invalid password in opt.url`, `invalid host in opt.url`, `invalid port in opt.url`), but the quoted `opt.url[…]` no longer carries the user name or the password (the message goes to stderr when nothing catches it). It is now `<scheme>://***@<host[:port]>`: everything between `://` and the **last** `@` is replaced by `***`; the host part is kept only when it looks like a host name or address (up to the first `/`, `?` or `#`), otherwise it is `***` too. Without an `@` (for example `mssql://host:1433`, which the parser reads as user `host` and password `1433`) only `<scheme>://***` is shown, and without `://` the whole value is `***`; a scheme that is not a plain identifier is `***`. Example: `invalid port in opt.url, opt.url[mssql://***@db.local]`.
- The summary may name the table (`cl`, or the table names you pass to `genModelsByTabs`) and the error class and machine code (`errType`, `errCode`): they are schema and program identifiers that are also part of the reject messages, so do not put personal data into table names. A user name on its own is masked only when it has at least 3 characters (shorter ones would blot out unrelated text); `user:password` and the connection string are always masked.
- `genModelsByDB` (with `w-auto-sequelize` 1.0.51 or later) no longer lets sequelize's default logger write the table-structure queries, and its failures to read the tables or the foreign keys are no longer written as a whole error object with `console.error`: both go through the exit described above (labels `genModelsByDB sql`, `genModelsByDB foreign keys catch`, `genModelsByDB tables catch`; the two failure labels still go to stderr). What it resolves or rejects with, the generated model files, and "a failure to read the tables or the foreign keys is only reported, not rejected" are the same as before. With `logDetail: true` the error is printed bare as before, but as a masked copy, so its class shows as `Error [SequelizeConnectionError]` instead of `ConnectionError [SequelizeConnectionError]`.
- Not covered: sequelize prints a few fixed warnings itself (for example about `UNSIGNED` columns on sqlite); and a reversed, mistyped URL (`host:port@user:12345`, with a numeric password of at most 5 digits) looks like a host name and port after the `@` and would be quoted by the constructor's error message.

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

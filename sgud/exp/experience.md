# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 條件(find)與 sequelize(2026-10-14 審計 run01 實測)

- sequelize 6 不認字串 `$` 運算子(未設 `operatorsAliases`);無法辨識之物件會被交給**欄型之 stringify**,結果依欄型而異且多為靜默:FLOAT/REAL/DOUBLE→`'NaN'`(`data-types.js:248-263`),INTEGER/DECIMAL→`'[object Object]'`(`:166-174`),DATE→`moment(物件)`=本地今日 00:00(`:331-342`),STRING/TEXT/BOOLEAN→`Invalid value` reject。故「reject 了就安全」不可推廣:同一條件在 DATE 欄會刪錯列並回報成功。判斷條件相關問題時**一定要跨欄型與方言實測**,不可只用字串主鍵欄。
- sqlite 對 `'NaN'`、`'[object Object]'` 只是不命中(靜默 n:0);mssql 對數值欄會轉換失敗而 reject;DATE 欄兩方言都靜默以今日 00:00 比對。
- sequelize 欄位層 `Op.not` 遇物件改為 `Op.ne`(`query-generator.js:1978-1983`),不支援 `{f:{[Op.not]:{[Op.gt]:x}}}`;要否定運算式須提升為頂層 `{[Op.not]:{f:{…}}}`。
- `Op.substring`/`startsWith`/`endsWith` 不跳脫 `%`、`_`(`query-generator.js:2021-2032`);mssql 之 `[ ]` 亦為萬用字元;SQLite LIKE 無預設跳脫字元,須帶 `ESCAPE`。
- lodash `each` 對具數值 `length` 之一般物件當陣列樣迭代;處理使用者給的物件鍵一律用 `Reflect.ownKeys`。lodash `each` 也不走 Symbol 鍵。
- 以 logging 觀察實際 SQL:`wo({...opt, logging: true})` 時 sequelize 以 `console.log` 輸出(並有 SEQUELIZE0002 棄用警告),探測時暫時替換 `console.log` 收集即可(見 `tmp/audit01/probe-sql.mjs` 之作法)。

- sequelize 之 where 還有下列靜默行為(2026-10-16 外審 sol 實測、本人核對):空條件(`{}`、空 `Op.and`)於 OR、NOT 內被濾除(`$nor:[{}]` 會變全部),故恆真恆假要以 `literal('1 = 1')`/`literal('1 = 0')` 明寫;非 `Op` 成員之 Symbol 鍵被丟棄(`utils.js` 之 getOperators);欄位名 `''` 經 `_joinKeyValue` 變成常數 `WHERE 1`;欄位層 `Op.or`/`Op.and` 會提前 return 而丟棄同層其他運算子;`Sequelize.col(屬性名)` 不做屬性→欄名映射。
- sqlite 比較不同型別不報錯(INTEGER < TEXT 恆真),型別不符之條件在 sqlite 會變成全刪,mssql 則轉型失敗 reject——條件值一定要依 model 欄型檢核。
- sqlite 之 `LOWER()` 只折疊 ASCII;mssql 依定序(實測 `SQL_Latin1_General_CP1_CI_AS` 之 `LOWER('É')` 可配 `é`)。
- model `defaultScope` 之 limit/order 會套進 findAll,但 sqlite 之限量 destroy 用 rowid 子查詢而不採 order。
- `ESCAPE '!'`:`!` 在 sqlite、mssql、postgres、mysql 字串常值皆無特殊意義,可免依方言跳脫 ESCAPE 子句本身;mssql 下 `![` 可跳脫字元類。
- mssql 比較「欄位 vs 字串常值」時把字串轉成欄型:DECIMAL(10,2) 對 `'1.254'` 四捨五入而命中 1.25;INTEGER 對 `'2.5'`、`'1e3'`、`'5.'` 轉型失敗;sqlite 則依型別親和(`'1e3'` 命中 1000、`'5.'` 命中 5)。數值字串要依欄型用嚴格正則並檢 DECIMAL 之 scale(`type._scale`,未指定為 undefined)。
- DATE 欄給 |epoch| > 8.64e15 之數值,sequelize 會 stringify 為 `'Invalid date'`;無時區之日期字串由 moment 依主機時區解析(CI 為 UTC、本機 UTC+8,結果不同)。驗證要另以 `TZ=UTC` 跑一次。
- 外審派工時我仍在改檔,三位審查者都自行快照比對(opus 之 snap/snap2、deepseek 記 md5)——下次可在任務書寫明「工作樹可能變動,以快照為準」,或先凍結再派。

## 主鍵型別(2026-10-16 run04 實測)

- 系列規則:主鍵值依主鍵欄型別「轉型」而非拒收(字串主鍵欄之 123 即 `'123'`),與 w-orm-mdb 之 `normPk`、上游 w-serv-orm 一致;判斷主鍵型別之處置前先讀 w-orm-mdb `src/pk.mjs`(只讀)。
- 送出前不檢查時(run03 碼之紅燈實測):整數主鍵欄之 `'012'` 於 sqlite、mssql 皆轉為 12 而 selectByPk 命中、del 刪掉 12;del `12.4` 兩方言皆 ok 1、未刪(`12.4` 之 insert 行為未單獨觀察)。
- mssql 之 DECIMAL(10,2) 主鍵收 1.254:寫入時捨入為 1.25 而撞既有鍵(insert 回 nInserted 0、save 該筆 ok 0),selectByPk(1.254) 卻回 null;sqlite 另存 1.254。凡「寫入會改變鍵」之值都要在送出前判為型別不符。
- HEAD 實測(`tmp/run04/accept-*-head.json`):mssql 之 nvarchar 主鍵欄以數字比較時把**欄位**轉成 int,表中只要有一列非數字(如 `'1.5'`)即 `Conversion failed` 而 reject;sequelize 把 `Infinity` 原樣寫進 SQL 而成欄名錯誤(`no such column: Infinity`),sqlite insert 則存成 `'Inf'`。
- BIGINT 讀回:sqlite3 驅動回 JS 數值(`9007199254740993` 讀成 `9007199254740992`,失精度),tedious 回字串。驗收比對時只比結果類別,不比讀回表示。
- 驗收腳本範本 `tmp/run04/accept.mjs`(4 種主鍵欄 × 輸入 × 7 函數,mssql 自建 `worm-audit04-mssql` 埠 9064 並移除);結案隨 `./tmp/` 清除時,作法即本條。
- eslint 之 no-new-wrappers 禁 `new String`;測包裝物件改用 `Object('a')`、`Object(5)`。

## model 檔與 importModels

- `modifyModel` 每次操作都 `writeFileSync` 呼叫端之 model 檔(並 trim 每行、刪空行、CRLF 變 LF);多行程併發會把檔截為 0 位元組。探測或測試時**一律把 model 複製到 `./tmp/` 或 `test/_tmp/`** 再以 `fdModels` 指過去,否則會動到版控中之 `models/users.js`(至少改 mtime)。
- `requireModel` 用 CommonJS `require`,同一行程內有快取:model 檔被毀後本行程仍可運作,新行程才失敗——驗證 model 檔問題要另起行程。
- 2026-10-16 起改為不寫 model 檔:`id` 缺 `primaryKey` 時於記憶體內補(暫以實例自有屬性包裝 `sequelize.define`,`finally` 內 `delete` 即回復原型方法)。照搬 w-orm-mdb 之「需要時寫檔後 rename」仍會在第一次讀取時寫檔(違反 T9),故不採。`requireModel.js` 與 `genModelsByTabs.mjs` 被 w-orm-mdb、w-data-collector 深層引用,勿改簽章或路徑。

## 發布產物(dist)

- 測試只跑 `src` 時,打包才出現之缺陷完全看不到:`require(fn)`(非字面值)被 commonjs 外掛換成必拋 `Could not dynamically require` 之樁,自 2021-05-12 起所有 dist 之 js 型 model 皆不可用,2026-10-16 才由主控轉來 w-package-tools 審計之發現。判斷「經 main 可用」只能以建出之產物在「已安裝佈局」(`app/node_modules/w-orm-reladb/{package.json,dist}`,由 app 以套件名 `require`)實跑,`require(main)` 成功只是必要條件(本例 require 成功,呼叫 importModels 才拋)。作法見 `test/api-dist.test.mjs`:複製 `toolg/gDistRollup.mjs` 只換 `fdTar`,於專案根目錄以子行程執行(babel.config.js 與 package.json 才與發布一致),約 5–15 秒。
- 打包後之樁被 `initSequelize` 轉成 `can not import model: …`;真正原因只在 `console.log(r)` 之輸出內。看到此訊息而 src 正常時,先查 dist 是否含 `Could not dynamically require`。
- gDistRollup 未給 `runin`,w-package-tools 以 browser 模式解析(`preferBuiltins:false`):Node 內建模組(`fs`、`path`、`module`)須列入 `external`,未列者解析不到而被當成 external 並發警告,產物仍 `require` 之。
- 以 sequelize 建構期例外測試錯誤管道:本套件不相依 mysql2、pg、mariadb、@journeyapps/sqlcipher,`mysql://`、`postgres://`、`mariadb://`、`useEncryption:true` 之 sqlite 皆於 `new Sequelize` 拋 `Please install … package manually`/`Unable to find dialect at …`,不需連線(2026-10-16 實測)。

## 測試與環境

- `npm test` 約 1.5 分鐘(2026-10-16,含 api-dist 之建置;474 案),mssql 由 `test/api-mssql.test.mjs` 自建自刪容器 `worm-test-mssql`(需 docker daemon 已啟動)。
- 臨時方言實測:可用使用者機器上既有之映像起容器,條件為不拉新映像、埠 9060–9079、`--rm`、容器名以 `worm-audit` 開頭、用完即移除並記錄;不得動 `mssql-worm`、`postgresql-worm`(主控 2026-10-16 裁定)。腳本範本 `tmp/audit01/mssql-ct.mjs`(審計結案後隨 `./tmp/` 清除時,其作法即本條)。
- 本機僅有 `sqlite3`、`tedious` 驅動;mysql/mariadb/postgres 無驅動無法實測(sequelize 建構即需驅動)。
- 系列語意參照可用 w-orm-lmdb 之 `node_modules/mingo`(`createRequire('C:/opensrc/開源-JS-015-4-w-orm-lmdb/w-orm-lmdb/package.json')('mingo')`),只讀。
- 比對修前行為:以 `execFileSync('git', ['show', 'HEAD:src/WOrmReladb.mjs'])` 取原碼副本放 `./tmp/`,不用 stash/checkout。

## 審計02(2026-10-16,cvFind 欄位引用不變式與 dateNoTz;產物在 `tmp/audit02/`)

- 不變式:cvFind 為欄位層運算子產生之每個子式,其 SQL 都必須含該欄名,資料庫才能回報不存在之欄(R4 把欄名檢核外包資料庫)。常數子式(`1 = 1`、`1 = 0`)只可用於文件層(`{}`,本無欄)。`cvIn` 之空集合曾違反(單一入口 `Op.in`/`Op.notIn`、陣列值、`$not` 包覆皆走同一分支)。驗證法:離線以 `queryGenerator.getWhereConditions` 取 WHERE 文字,Op 全集 × 值 × 結合/包覆窮舉(`tmp/audit02/p1-sql-ref.mjs`)。
- mssql 驅動(tedious 19 + sequelize 6.37)遇同一語句**兩個以上**錯誤(如同一不存在之欄被引用兩次)時,`err.message` 為空字串,訊息在 `err.original.errors[].message`;單一錯誤則 `message` 正常。故讓不存在之欄「恰引用一次」(`f IS NULL AND 1 = 0`),而不用 `f IS NULL AND f IS NOT NULL`。測試讀欄名時兩處都取。
- 欄位解析:cvFind 以屬性名完全相符查 `ctx.attrs`;資料庫不分大小寫(sqlite、mssql 預設定序、mysql)且認資料庫欄名。大小寫變體(`VALUE`、`ID`)與欄名別名(`age_num`)使型別檢核(R4)與主鍵正規化(R8)落空:sqlite 的 `{VALUE:{$lt:'abc'}}` 刪光非 NULL 列,兩方言整數主鍵 `{ID:'012'}` 刪 id=12。判斷條件相關問題時,欄名也要試大小寫與別名。
- sqlite 對未分類型別(`TIME`、`JSON`、`BLOB`)比較型別不符之值不報錯,命中全部非 NULL 列(`TIME` 宣告型別為 NUMERIC 親和);`ENUM`(TEXT 親和)則轉字串比較。mssql 對 `TIME` 轉型失敗而 reject。
- Windows 上 Node 的 `delete process.env.TZ` **不還原**主機時區(仍停在最後設定值);執行期賦值 IANA 名(`process.env.TZ = 'America/New_York'`)可即時生效,啟動時以環境變數給 IANA 名卻不生效(`TZ=America/New_York node …` 仍為本機時區),POSIX 名(`EST5EDT`)可。測試切時區:載入時記 `Intl.DateTimeFormat().resolvedOptions().timeZone`,還原時賦值。
- 既有 `api-suite.mjs` 之 `bads` 迴圈斷言 select 與 delAll 訊息全等,只適用於 cvFind 自拋之訊息;資料庫回報之訊息兩函數不同(sqlite 的 select 為 `users.nocol`、delAll 為 `nocol`),須另設區塊。
- (實作期,外審 opus 實證)sequelize 只在 where 之鍵為屬性名或欄名**完全相符**時才依欄型序列化值(`_findField`,`query-generator.js`);大小寫變體鍵會把字串與 epoch 原樣送出。sqlite 的 DATE 為 `'YYYY-MM-DD HH:mm:ss.SSS +00:00'` 文字,故 `{D:{$gt:epoch}}` 以「TEXT 恆大於 INTEGER」命中全部非 NULL 列。對策:cvFind 自己把通過檢核之 DATE 值轉 `Date`(與鍵拼寫無關)。其他欄型(STRING/TEXT/INTEGER/FLOAT/DOUBLE/DECIMAL/BOOLEAN)變體鍵與屬性名鍵同結果(api 25 案實測)。
- DATE 年份:sequelize 以 `YYYY` 格式化,年 10000 起為 5 位數 `'10000-…'`,sqlite 文字比較下 `'2026…' > '1000…'` 成立,`{d:{$gt:年10000}}` 命中並刪光全部日期列(HEAD 既有,Date/epoch/帶偏移 ISO 皆然);mssql datetimeoffset 範圍 0001–9999,超出則轉型失敗。cvFind 現要求 UTC 年 1–9999。ISO 字串之年 0001–0099 原因 `isCalendarDate` 用 `Date.UTC`(將 0–99 年映射為 1900–1999)而一向拒收,run03 改以 `setUTCFullYear` 驗曆法後放行(與同一瞬間之 Date/epoch 同);`new Date(y,…)` 亦有同樣映射,故 dateNoTz 之本地時間年 0001–0099 仍不收。
- mssql 預設定序(`SQL_Latin1_General_CP1_CI_AS`)的識別字解析不分大小寫**也不分全形半形**:`{ＩＤ:'r1'}` 解析為 `id`;sqlite 只折疊 ASCII(`no such column`)。欄名折疊 run03 起依方言(sqlite 只折 ASCII,其他 NFKC + 去尾端空白 + 小寫),run04 已全部取消,改嚴格鍵(見〈重構 run04〉)。
- 第三方審之派工:`gpt-6.1-sol` 遇 Codex 用量上限(`ERROR: You've hit your usage limit`)8 秒即失敗,離開碼 1,不重派;muse(opencode)提示詞若未禁止 bash,模型會嘗試跑測試,唯讀鎖(`bash:'ask'`)自動拒絕後**整個工作階段中止、報告遺失**(離開碼仍 0、stdout 只有進度句)——提示詞須明寫「沒有 bash 權限,切勿呼叫 bash」。opus(`claude-opus-5-5`,`--effort xhigh --tools Read,Glob,Grep`)約 16 分鐘完成 14 條,含兩條實證為真的高嚴重度。審查簡報放 `tmp/review05/brief.md`,diff 事先落檔、被審者自行讀檔。
- 以原型副本跑 repo 測試而不動 src:`tmp/audit02/run-mocha.mjs <原型目錄> <測試檔…>` 把原型 `src`、現行 `test`、`models` 複製到 `tmp/audit02/run-<原型>/` 再以該夾為 cwd 跑 mocha(`GREP=` 環境變數可濾案);`tmp/audit02/extra-test/` 之檔會覆蓋進 `test/`。審計用臨時 mssql:`worm-audit02-mssql` 埠 9062,`mssql-ctl.mjs setup|stop`。

## 再審 run03(2026-10-16,外審修正輪之聚焦再審;產物在 `tmp/review06/`)

- sequelize `mapWhereFieldNames`(`utils.js:156`)把屬性名之鍵改成其欄名 f 後,`_findField(f)`(`query-generator.js:1824`)取型別的順序是 `rawAttributes[f]`(**名稱為 f 之屬性**)、再 `fieldRawAttributesMap[f]`(欄名為 f 之屬性,同欄多個取最後定義者);故「屬性 A 之欄名 f 恰為屬性 B 之名稱」時,A 之值以 B 之型別序列化。實測:`ra`(DATE,欄 `rb`)+ `rb`(INTEGER,欄 `rc`),sqlite 下 `{ra:{$lt:'2026-01-01T00:00:00Z'}}` 的 select 與 destroy 都命中並刪光 `rb` 欄之全部非 NULL 列(`NUMBER._stringify` 對 `Date` 回傳 `Date.toString` 文字,`'2…' < 'T…'` 恆真);直接給 `Date` 者 HEAD 即如此。重現:`tmp/review06/p6-clash-demo.mjs <cvFind檔>`。對策:`resolveAttr` 之①核對反查屬性之型別類別(`chkSeqAttr`),不同者 reject。`mk()` 之 `whereDb` 可離線看到映射後之 SQL。
- mssql 識別字等價(定序 `SQL_Latin1_General_CP1_CI_AS`、`Latin1_General_100_CS_AS`,`tmp/review06/collation-probe.sql` 以 T-SQL 迴圈列舉 BMP 全部字元):尾端空白(任意個,含全形空白 U+3000 因寬度不敏感)被忽略 → `{'id ':'012'}` 命中 id=12(R8 繞過);CI 定序另有 U+026A(`ɪ`)等同 `i`、`id` 後附加大批未定義/可忽略字元(如 U+FEFF)等同 `id`;CS_100 定序之可忽略集合不同。折疊無法窮盡此集合,故 `resolveAttr` 解析不到者視為 `'any'`(已知限制),mssql 對不符之值多轉型失敗而 reject,只有前導零等寬鬆轉型可繞過 R8,不致誤刪全表。尾端空白最可能因人為疏忽出現,已納入折疊(以迴圈去除,不用 `/ +$/` 以免長鍵回溯)。
- sqlite 識別字只對 ASCII 不分大小寫:欄 `i` 與 `ｉ`、`Éa` 與 `éa` 可在同一張表共存,NFKC+小寫折疊會把 `{I:5}`、`{ÉA:'x'}` 誤判歧義而拒收合法查詢(opus [2],實測 `{ÉA:'e'}` sqlite 命中 `Éa` 欄)。折疊須依方言。
- mssql CS_AS 資料庫(`CREATE DATABASE wcs COLLATE Latin1_General_100_CS_AS`)實測:屬性名/欄名完全相符之合法查詢(含 `ab`/`aB` 兩欄)皆不誤拒;`resolveAttr` ③ 只處理資料庫本就會拒收之鍵(腳本 `tmp/review06/p3-mssql-cs.mjs`、輸出 `out-p3-mssql-cs.txt`)。同一 `mssql-ctl.mjs setup` 建 `worm`(預設)與 `wcs`(CS)兩庫,埠 9063。
- 原生 `Op.startsWith/endsWith/substring` 於 sequelize 以 JS 樣板字串插值(`query-generator.js:2021-2033`),`Date` 值成為 `Date.toString()` 文字(隨主機時區與語系而變);DATE 欄上此三運算子命中原即恆為空,現 reject。
- `Date.parse(v.replace(' ','T'))` 與 moment 對通過 `reIsoTz` 與曆法驗證之字串結果相同(`tmp/review06/p1-parse-vs-moment.mjs`;不同者皆為 `Date.parse` 回 NaN 而被拒收,或曆法驗證已擋之 2-29)。
- 工具提醒:本 harness 會把工具參數內之 `\uXXXX` 字面還原為實際字元(`U+3000` 之跳脫寫法 變成全形空白而被 ESLint `no-irregular-whitespace` 抓到;孤立代理 `\uD800` 則保留);需要在檔內寫跳脫文字時,以 `String.fromCharCode(92)` 組出反斜線再以 node 腳本替換。測試用字元優先以字串跳脫寫,事後 `grep` 確認未變成字面字元。
- 派工:opus(`claude-opus-5-5`,xhigh,唯讀)約 16.5 分鐘出 6 條(高 1、中 1、低 4)+ 4 疑慮,其中疑慮 1(mssql 尾端空白)經實測為真;muse(提示詞明寫無 bash)約 6.9 分鐘出 5 條(中 1、低 4);sol 再遇用量上限(8 秒失敗)。`tmp/review06/dispatch.mjs <opus|sol|muse>` 為派工腳本(同 review05)。
- 修前紅證據:`tmp/review06/run-mocha.mjs <原型目錄> <測試檔…>`(同 audit02 之作法);原型 `tmp/review06/proto-pre/` 由 `git show HEAD:src/cvFind.mjs` 套 `diff-src.patch` 重建(行尾為 CRLF,HEAD 之 blob 為 CRLF 而工作檔為 LF,比對時先 `tr -d '\r'`)。

## 重構 run04(2026-10-16,欄名解析改嚴格鍵;產物在 `tmp/review07/`)

- 結構性根因:同一個鍵由三方各自解析——cvFind、sequelize(`mapWhereFieldNames` 映射、`_findField` 反查、`quoteIdentifier` 改寫、`whereItemQuery` 之 JSON 路徑與 `$x$` 欄引用)、資料庫(依定序折疊)。後兩者之規則不可窮盡,三輪外審各查出高嚴重度(每輪皆為「再模擬一條規則」)。**安全性取決於「解析不到時怎麼辦」(fail-open 或 fail-closed),不取決於是否模擬**(opus):改為 attrs 已給時完全相符才收、其餘 reject,模擬即消失。
- sequelize 識別字改寫(`query-generator.js` 之 `quoteIdentifier`):sqlite/mysql 刪反引號(`sqlite/query-generator.js:358`)、mssql 刪 `[`、`]`、`'`(`mssql/query-generator.js:819`)——``{'val`ue':{$lt:'abc'}}`` 實送 `` `value` < 'abc' ``,sqlite 刪光全部非 NULL 列(實測);前輪 `tmp/audit02/p6-names.mjs` 之 ``a`b`` 刪字後成 `ab`(表無此欄)而誤判「由資料庫 reject」。sqlite 隱含欄 `rowid`:`{rowid:{$lt:'abc'}}` 判為 any 交資料庫,刪光全部列(實測,含 NULL 列)。
- sequelize `where` 對「完全相符」欄名之再解讀(sol H3、H4,實測 `tmp/review07/p1-sol-holes.mjs`):含 `.` 且前綴為 JSON 屬性 → JSON 路徑;前後 `$` → 欄引用;`field:'__proto__'` → `mapWhereFieldNames` 賦值遺失條件而 `{value:1}` 命中全部列並刪全表(表須以原生 SQL 建,sequelize `sync` 建不出該欄);`rawAttributes[欄名]` 取到 `Object.prototype` 成員(實測 sqlite 為 `s.replace is not a function` 崩潰,safe,但仍列入 reject)。`VIRTUAL` 屬性與同名欄僅大小寫不同時,完全相符收下而資料庫解析到實欄(opus [8],實測)。
- `{f:{$options:undefined}}`:`$options` 為 undefined 視同未給,物件無任何子式 → 條件消失成恆真,`delAll` 刪全表(實測 select 全部、刪 3/3);HEAD 既有。修:運算子物件須至少產生一個子式。
- 設計取捨(外審收斂):S1 嚴格鍵為 opus、sol 一致推薦;**DATE 值轉 `Date`(④)應保留**(令 SQL 與 sequelize 之欄位查找無關;原型拿掉後 opus [2]、sol H2 在理論上重開缺口,實測 sqlite 為崩潰而非刪除);`chkSeqAttr` 改為「反查所得須即本屬性」(不比型別類別:opus [7] 指 `'any'` 類別如 TIME/BLOB 之序列化可能不同);cvRegex 之 LOWER 欄名由 resolveAttr 之解析結果帶出(原以原鍵再查 attrs)。不採 T(鍵正規化:CS 庫靜默改派)、N(自行序列化:`Sequelize.col` 亦經 quote 改寫)、W2(ASCII 封閉:全形 schema 欄仍可繞過 R8)、Z(只查欄名不免除 attrs=表)。
- 深引用者 w-orm-mdb 之接線風險(與選哪個方案無關,已寫入帳本〈深引用者接線契約〉):`castPkFind` 與 `size(keys(find))===0` 以 lodash `each`/`keys` 迭代,丟棄 Symbol 鍵、具 `length` 之物件、非一般物件而在 cvFind 之前使條件變 `{}`;嚴格鍵只收完全相符之主鍵名,與其 `k === pk` 一致(其他路線之近似鍵會繞過 Jet 之等值判定);ctx.attrs 須取執行端(記憶體 sqlite)model 之 `rawAttributes`;兩份 sequelize(reladb 6.37.1、mdb 6.37.8)之 `SequelizeMethod` 互不 `instanceof`(疑慮,未證實)。
- 派工:opus 約 21 分(10 發現含 2 高 + mdb 2 高)、sol 約 18 分(額度未用盡,5 高含 H1 孤立 `$options` 全刪)、muse 逾 70 分無輸出(opencode 行程仍在、`~/.local/share/opencode/log/opencode.log` 為全機共用,其中 17:57 之 `Rate limit exceeded` 屬他人之 muse 行程;本次之 opencode 子行程為派工腳本 node 之子行程,以 `Get-CimInstance Win32_Process` 查父行程辨別)。
- 工具:`quiet-run --cwd <repo根>` 可在 shell cwd 被誤改時仍把 log 落在 repo 之 `tmp/quiet-run/`;Bash 工具之 cwd 被 `cd` 改過後會於下一次呼叫被 harness 重置;`node -e` 內巢狀引號易誤,多行改檔以 `tmp/` 下之 `.mjs` 腳本做。

## 最終審 run05(2026-10-16,對 S1′ 最終程式碼之獨立審;產物在 `tmp/review08/`、`tmp/final/`)

- 外審對「實作」比對「方案」更能找到細縫:S1′ 的核心(完全相符才收)未被推翻,縫隙全在**「完全相符且通過 chkColName 之名稱,sequelize 仍另有處理」**與**「attrs 形狀/scope/原生 Symbol 等周邊假設」**。派工:opus 約 19 分(9 條 + 4 疑慮)、sol 約 18 分(7 實作 + 2 測試 + 1 文件)。opus 只有 Read/Glob/Grep,結論標「推得」;sol 在 read-only 沙箱以 `:memory:` sqlite 實測,故其實測格最可信(F01–F07 皆附實際 SQL 與命中集合)。
- `isColString`(`utils.js:196`)只比首尾字元,正規式 `/^\$.*\$$/` 之 `.` 不匹配換行:`field:'$a\nb$'` 被當欄引用而比對 `a\nb` 欄,而 `$regex`+`i` 走 `Sequelize.col` 引用完整欄名——**同一 find 因旗標而命中不同列**(實測)。判定須與被模擬者逐字相同:改為 `n[0]==='$' && n[n.length-1]==='$'`。
- 空欄名:`_joinKeyValue(key='')` 只回值(`query-generator.js:1942`),`WHERE (5)` 常數謂詞;sqlite 下 sync 以 `field||name` 建欄、`mapWhereFieldNames` 卻映射為 `''`,`delAll({a:5})` 刪全表;**mssql 的 `sync()` 會把 `rawAttributes.a.field` 由 `''` 正規化為屬性名**(實測,api 測試因此僅 sqlite 實跑)。
- 共用一欄:實體欄型別由**最後定義者**決定(sync 以欄名為鍵後者覆寫),sequelize 的 `where` 序列化卻依 `rawAttributes[欄名]`(先定義者若名稱即該欄名);「反查即本屬性」不足,須再要求本屬性為該欄之最後定義者。
- 原生 Symbol:`Op` 40 個成員中 `values`、`join` 不在各方言 `OperatorMap`,欄位層遇之退回等值並把整個物件交欄型 stringify(DATEONLY 成**查詢當日**、DATE 成現在);防空轉測試用 `qg.OperatorMap` 動態列出缺席者。`Op.between` 以 `value[0]`/`value[1]` 取值,字串逐字元、短陣列補 NULL(`NOT BETWEEN` 可命中全部非 NULL 列)。其餘缺席於 sqlite/mssql 之原生 Op(`&&`、`@>`、`~*`…)皆為語法錯,fail-closed;`Op.strictLeft/Right` 於 sqlite 為位元位移(語意無意義但屬呼叫端自負)。
- `defaultScope` 對 `findAll` 與 `destroy` 不對稱:`group`/`having`、required `include` 只套用於 `findAll`(實測 select=[2] destroy=3);`where` 含 `Op.and` 時 `_mergeFunction` 以 `Object.assign` 合併,cvFind 輸出之頂層 `Op.and` 覆寫 scope 條件。`chkScopeForDelAll` 原只查 limit/offset。
- attrs 周邊:`rawAttributes[Op.and]`(Symbol 屬性)使 `mapWhereFieldNames` 把邏輯鍵映射為欄;原型上之定義被 `rawAttributes[欄名]` 讀到而自有屬性核對看不到;不可列舉屬性使 `Object.keys` 索引與 `hasOwnProperty` 分歧——以 `chkAttrs` 形狀守門(一般物件、無 Symbol 鍵、自有字串鍵皆可列舉)一次排除。
- 測試判別力:SQL 字串比較不能鎖住「cvFind 必須轉 Date」(欄型可查得時 sequelize 自行序列化成相同 SQL,76/76 格相同)——直接走訪 cvFind 輸出斷言 Date;別名正向案之預期集合不可取自同一實作之另一入口(雙方同錯仍綠),須由 seed 數據獨立推得。
- 工具:Edit 工具會把 `old_string`/`new_string` 內之 ` `/` ` 轉成字面字元(eslint `no-multi-str` 報錯),改以 `tmp/final/fix-ls.mjs` 腳本還原;`node -e` 內之 ` ` 亦被 harness 展開——含此類字元之檔案修改一律用 `.mjs` 腳本且以 `String.fromCharCode` 組字。

## 第 33 項批 1(2026-10-19,條件白名單接線;產物證據在 `C:\opensrcOper\dnow\20261019163525\agent-out\run01-evidence\`)

- SQLite 運算式樹深度上限 1000 對 select 與 delAll **不對稱**:select 之欄位帶表別名(`` `t`.`c` ``,葉高 3)、delAll 不帶(葉高 2),平鋪 `a OR b OR …` 為左深樹,select 最多 998 項、delAll 最多 999 項;故 `cvOrmFind` 之 `maxList: 999` 並不足以保證 DB 不報錯(HEAD 之 999 項 `$or`:select 報錯、delAll 刪 1 列)。另有獨立之右深巢狀遞迴上限(約 830 層,`SQLITE_ERROR: Recursion limit`)。巢狀層數 × 清單長度會累加(32 層 × 每層 33 項平鋪即超限)。對策是對所有 `$and/$or` 清單與並列欄位之隱含 AND 遞迴二分為平衡樹(`cvGroup`,`nFlat = 4`),使全樹深度與層數 × log(項數) 成比例;探測腳本 `probe-depth.mjs`(證據夾)。外審二位(opus、sol)各自獨立找到「單層分組不夠」。
- HEAD 對被拒收之 find 本來就**不送出 SQL**(`initSequelize()` 不 sync,`sequelize` 連線惰性),差別只在 HEAD 先載入 model 檔與建立 sequelize 實例才檢核。故「壞 find 不送 SQL」之測試對檢核順序無辨別力;能辨別順序者是 `cl` 指向不存在之 model 時的錯誤優先序(壞 find 回 `invalid find`、合法 find 回 `can not import model`)。初稿帳本曾寫成「HEAD 先 sync 送 CREATE TABLE」,為不實敘述(被自己之變異測試與兩位外審發現)——**寫「原行為」前先實跑 HEAD**。
- 預檢放在 `initSequelize()` 之前後,`finally` 若仍只看 `instance === null` 就 `closeSequelize`,會關閉**呼叫端先前以 `init()` 持有之共享連線**(`sequelize` 為 `WOrmReladb` 閉包變數);須以 `inited` 旗標只關本次自己建立者。
- 變異測試常見空洞:「檢核移到初始化之後」「delAll 改用原物件」兩種接線變異在初稿全綠。接線測試要對 select 與 delAll **各自**用變值 Proxy(第二次讀取回不同值)驗只讀一次;順序要有可觀察量。
- HEAD 對共享參照指數展開(案例 H19,深度 25)會使行程 OOM 崩潰:HEAD 修前紅與「拿掉 `cvOrmFind`」之變異皆須略去 H19 才跑得完。
- 外審提示詞給 sol 一律中性措辭(本次未被擋);審查副本需 `node_modules` 時以 PowerShell `New-Item -ItemType Junction`(Git Bash 的 `cmd //c mklink` 遇中文路徑失敗);beam-free 約 4 分鐘即交 0 條,且其「文件相符」「變異皆轉紅」之結論不實(未實跑變異),opus 約 48 分、sol 約 18 分各找出可證實之缺陷。

## 第 66 項批 1f(2026-10-20,字串良構 R13;探測、變異、審查包腳本與輸出在 `C:/opensrcOper/dnow/20261020172106/agent-out/批1-reladb-evidence`;結案時 ./tmp 已清除)

- **只在 `normPk` 加判定不夠**:建議書「`normPk` 字串分支回 `{kind:'invalid'}`」會讓 `autoGenPk:true` 時 `procPk` 把呼叫端所給之不合格 id 當成[未給主鍵]而以 UUID 取代(`isEffPk` 即 `normPk(...).kind !== 'invalid'`)。須先以 `chkWf` 逐筆檢出並整批 reject(save 為逐筆),`normPk` 之 invalid 只是 `selectByPk` 等的第二道防線。看到[沿用既有無效主鍵處置]時要想:既有處置在 `autoGenPk:true` 是補值,不是拒絕。
- **`useStable` 的佇列延後複製**:`ee.insert` 等經 `pmQueue(1)`,其 `run` 內先 `await delay(1)` 才呼叫函數;原函數內之 `cloneDeep(data)` 因此在輪到時才發生,呼叫端於呼叫後立即改動原數據(重用同一陣列)會改變實際寫入值(HEAD 即如此,與良構無關,案例表 `toctou:*:mutate-after-call` 才發現)。修法是在註冊處以 `snap(fn)` 於呼叫當下同步複製(複製拋錯回 rejected promise),函數內不再複製。測 TOCTOU 要用 `useStable` true/false 兩種;`afterCall` 在 `wo[api](...)` 回傳後、await 前同步改動。
- **shared instance 與第二個物件**:同一 `WOrmReladb` 物件混用[給 instance]與[不給 instance]會互相關閉(閉包內單一 `sequelize` 變數),測[不給 instance]必須另建一個物件做呼叫、原物件的 instance 只做驗證讀取;不同物件持有之 instance 不可互傳(會得 `instance is closed`,因 `procClosed` 看的是該物件自己的閉包)。
- **預檢失敗不得關閉先前持有之連線**:與 R11 同型,`insert`/`insertBulk`/`save`/`del` 之 `finally` 原為 `if (instance === null) closeSequelize()`,新增預檢(在 `initSequelize` 之前拋錯)後必須配 `inited` 旗標,否則 `wk.init()` 之後以 `wk.insert(壞資料)`(不給 instance)失敗會把 `wk` 之連線關掉。save/del 另有[全部不合格不連線]:此時 `si` 為 null,後續 `si.err`/`si.mds` 須判 null。
- 去回顯之既有訊息共 4 處:`normPks`、`del` 兩條、`saveOne` 重試耗盡;後者須[預讀見該列且更新連續三次未命中]才可觸發,真實併發構造不出,測試以替身 `ins.mds.twf.findOne`/`update`(測後 `delete` 還原為繼承之靜態方法)構造;首輪變異 W22 存活即因缺此案。
- 實測 HEAD(證據夾 `probe-head-sqlite.txt`、`probe-head-mssql.txt`,腳本 `scripts/head-probe.mjs`:以 `git show HEAD:src/<檔>` 取 HEAD 副本後執行):sqlite 與 mssql 預存 `'a\uFFFD'` 後 `insert('a\uD800')` 皆回 `nInserted:0 ok:1`(視為重複,靜默少寫一筆),`save` 覆寫該列(mssql 還把該列之 id 改成孤立代理),`del` 刪該列,`selectByPk` 回該列;mssql 無預存時保真存入。NUL 主鍵:sqlite 之 `insert` 存入而其餘函數以 `SQLITE_ERROR: unrecognized token` 失敗,mssql 全部存入/不命中而 `del` 回 `n:0`,`a\0` 與 `a` 依排序規則相等(`insert` 回 `nInserted:0`)。`opt.storage` 為 `s\uD800.sqlite` 與 `s\uDC00.sqlite` 的兩個物件實際共用同一檔(`s\uFFFD.sqlite`)。
- 排序規則(D4)實測:`SQL_Latin1_General_CP1_CI_AS` 下 `N'a'`、`N'a'+emoji`、`N'a'+NCHAR(0xFFFD)` 兩兩相等,`Latin1_General_100_BIN2` 下皆不等(證據夾 `collation-probe.txt`;用 `docker exec <容器> sqlcmd -d worm -Q`)。
- 本機 `docker run` 前以 `getFreePort()` 取埠有競爭:他程序(同機其他 agent 之容器)可能在取埠與綁定之間佔用,`api-mssql.test.mjs` 現於綁定失敗(錯誤含 `bind`)時換埠重試至 5 次。容器收尾 `docker rm -f -v`,`stopContainer` 先記下 `.Mounts` 之 volume 名稱,移除後回驗容器與 volume 皆不存在(mssql 2022 映像實測無匿名 volume,仍保留回驗)。
- 案例表逐案在 sqlite 約 3.5 分鐘/全表、mssql 約 4.5 分鐘(每案約 70–110 ms;1100 餘案 x 3 組);變異每個存活者要跑滿 3.5 分鐘,故證據夾 `scripts/mutate.mjs` 並行 4 個、unit 與 api 兩者皆跑並分記[由誰轉紅],以知悉某變異是否只被結構掃描(unit)殺死。
- 工具:harness 會把工具參數內之 `\uFFFD`(及其他良構跳脫)還原成字面字元,孤立代理 `\uD800` 則保留;寫完含 `\uFFFD` 之檔後執行證據夾 `scripts/fix-esc.mjs <檔…>`(把字面 U+FFFD 還原為跳脫文字;使用時複製到 ./tmp)。`Edit` 之 `old_string` 含 `\uFFFD` 時對不上已還原之檔,錨點要避開含該字元之片段。

## 第 78 項(2026-10-19,寫入側 DATE 範圍檢核 R12;探測在 `tmp/wprobe/`、`tmp/head/`、`tmp/mut/`、`tmp/mdbprobe/`、`tmp/review78/`)

- sequelize 寫入 DATE 之實際轉換(6.37.1 `data-types.js`):`DATE._sanitize` 對 truthy 非 Date 值做 `new Date(值)`,falsy(`''`、`false`、`NaN`)不轉;無效時間不報錯,存為文字 `Invalid date`(`Validator.isDate` 在 create 路徑並未擋)。`DATEONLY._sanitize` 以 `moment(值).format('YYYY-MM-DD')` 依**本地時間**格式化;`new Date(8.64e15)` 得 `275760-09-13`、`new Date(-8.64e15)` 得 `-271821-04-20`(之後查詢階段 `_stringify` 對該文字再過一次 moment,負年份變 `Invalid date` 才真正存入),`'+010000-01-01'` 得 `10000-01-01`。故 DATEONLY 要判「`_sanitize` 所得文字」而非存入文字;`_sanitize` 不產生 `Invalid date` 於有效時間(曾寫的 `isTimeLike` 分支為死碼,變異 M23 存活而發現並刪除)。
- 本套件 `select` 對 DATE 欄回 raw 文字(sqlite:`YYYY-MM-DD HH:mm:ss.SSS +00:00`;mssql:Date),測試讀回要正規化(`normD`),年份 > 4 位數之 sqlite 文字也要能解(`\d{4,6}`)。
- mssql 修前(HEAD)對範圍外值之實跑:`Conversion failed when converting date and/or time from character string.`——`insert` 逐筆 create 無回滾(前面合法筆已寫入而 reject)、`insertBulk` 因交易無一筆寫入、`save` resolve 且該筆 `ok:0`、其餘照寫。表示 HEAD 在 mssql 即非「整批」;現行於送出前整批拒,兩方言一致。探測法:複製 `api-mssql.test.mjs` 之容器啟停程式,換成自訂 describe(`tmp/wprobe/mkprobe-mssql.mjs`)。
- 修前紅法:`tmp/wprobe/mkhead.mjs` 以 `git show HEAD:src/<檔>` 取 HEAD 之 src 放 `tmp/head/src`、現行 test/models 複製過去,以 `quiet-run --cwd tmp/head` 跑 mocha(`node ../../node_modules/mocha/bin/mocha.js`,靠祖先目錄解析 repo 之 node_modules)。**失敗的測試不得留下開啟中的交易**(sqlite 會鎖庫,連累同 describe 後續案成 `SQLITE_BUSY` 的 before-each hook 失敗而整組中止,紅燈數被低估)——測試內交易一律 try/finally 回滾。
- 變異法:`tmp/wprobe/mutate.mjs` 把 src/test/models 複製到 `tmp/mut/<名>/`、副本一律轉 LF 後以字串錨點套單一變異,unit + sqlite 並行 3 個,M04(只檢 sqlite)另需 mssql 容器。src 檔行尾:`WOrmReladb.mjs` 為 CRLF、`cvFind.mjs` 為 LF(Edit 工具保留原行尾),字串錨點含換行時須先正規化。
- w-orm-mdb 實測(已發布 1.0.37,Jet 4.0,主機 Asia/Taipei;`tmp/mdbprobe/`):範圍外 `Date(±8.64e15)`、`+010000-01-01`、UTC 年 9999 末刻(本地已跨 10000 年)皆被 Jet 以 `Syntax error in date in query expression '#…#'` 拒收(fail-closed,訊息為資料庫層);但**年 1–99 被靜默改年**(`0001-06-15` 存成 `2015-01-06`、`0029`→`2029`、`0050`→`1950`、`0099`→`1999`;`0100` 起正確),屬 Jet 日期字面常值之兩位數年解讀。Jet 日期為數值,無字典序問題($lt/$gt 對成功寫入者依時間序)。npm 安裝時 sqlite3 的 install script 被擋(`allowScripts`),把 repo 已編好之 `node_modules/sqlite3/build` 複製過去即可;mdb 依 `path.resolve()`(cwd)找 `src/connMDB.exe` 或 `node_modules/w-orm-mdb/src/`,故探測要以 cwd = 安裝夾執行(`quiet-run --cwd`)。
- 外審:`codex`(sol)於 22:05 左右回 `You've hit your usage limit`(約 22:41 恢復)→ 依規改派 Gemini 4 Argon(`gemini-4-argon-high`,`skipPermissions:true`,`addDirs:[repo]`);探測 27 秒通過。審查者有執行權限時,提示詞須禁 docker/`npm install`/git 改動,並在派工前後各存 repo 檔案 md5 比對(`tmp/review78/hash-before.json`)。

## 第 94/87 項審計(2026-10-21,IR 採用之第二個 PoC 與浮動時間;產物在 `tmp/poc94/`,報告 `C:\opensrcOper\dnow\20261021080241\agent-out\run01-審計與方案.md`)

- **以 `lowerFind` 切換 `cvFind` 之結果集等價(兩方言 1940 + 9000 個 find 差異 0),但碼量不減(走訪與發射段 114 → 約 152 行)、CPU +40–120%**;故 IR 採用之價值只在系列契約對齊。結果集等價不等於 where/SQL 等價:同欄 `$in` 與比較之次序、單項展開、同型攤平、`$eq:true` 物件形狀皆變;唯一紅的既有測試是數 where 樹邏輯層數者。
- **where 頂層恆 `Op.and` 是承重的隱含性質**:sequelize `_mergeFunction`(`model.js:626-648`)對 scope 與傳入 where 皆為 plain object 時 `Object.assign`,頂層同名鍵(單葉同欄、`Op.or`)被覆寫而越出 `defaultScope`;scope.where 為 `Sequelize.literal`/`Sequelize.where` 時(非 plain)scope 直接被丟掉(現行即如此,`chkScopeForDelAll` 不擋)。**單一結構修法**:Sequelize 實例 `define` 層級 `whereMergeStrategy:'and'`(5 種 scope × 4 種 find 零越界)。測 scope 要驗**實際被刪主鍵集合**,不只比筆數。
- **負偏移與夏令時區之 DATE 條件**:記憶體 sqlite 以 UTC 文字存 DATE,Jet 牆上 `9999-12-31 23:59:59` 於負偏移時區換算為 UTC 年 10000,字典序小於 `2026-…`,被 `$lt` 誤中而 `delAll` 刪掉;有夏令之 UTC+ 時區(柏林、Lord Howe)於夏令跳過之牆上時刻亦錯。浮動時間(牆上分量作為 UTC 分量,`Date`/epoch/帶時區字串取主機本地分量)解之,且**不依賴 IR**。mdb 現行全套測試於 `TZ=PST8PDT` 亦全綠(對此缺陷零偵測力),須另設時區矩陣測試。
- **時區切換**:Windows 上啟動時 `TZ=<IANA 名>` 不生效但 POSIX 名(`PST8PDT`、`EST5EDT`)可;執行期 `process.env.TZ = '<IANA 名>'` 可即時生效。預言機取牆上分量用 `Intl.DateTimeFormat(timeZone: 名稱)`(ICU),獨立於本地 getter 實作。
- **以副本跑下游套件測試而不動其 repo**:把 mdb 之 `src/`、`test/`、`models/`、`package.json` 複製到 `tmp/poc94/mdb*/`,另建 `node_modules/w-orm-reladb/{package.json,src}` 接現行或試作版,其餘相依由祖先目錄之 repo `node_modules` 解析(單一 sequelize);cwd 設為副本夾,`connMDB.exe` 與真 Jet 可跑(全套約 8 分鐘)。mdb 實際安裝佈局為單一 hoisted sequelize,「兩份 sequelize」只在 npm link/pnpm/並排 repo 出現。
- **差分程式自身須有自測**:外審以注入故障證明早期版本漏檢 delAll 拋錯、只比筆數、兩臂同被拒收、離開碼恆 0;強化後以 `--selftest none-match|delerr|del-other` 驗證會報異常且離開碼非 0。觀測量要含完整列、實際被刪主鍵集合、錯誤類別。
- **外審發現之派工事實**:minimax(opencode)第 1 次派工 8 分多後 exit 0 而無 `findings.md`、stderr 無任何限流字樣,重派時改提示詞「開工 10 分鐘內先建檔、每完成一項即追加」即完成(8 分鐘 13 條);sol 24 分鐘 16 條,擅長以注入故障驗證驗證程式本身。審查者之嚴重度常偏重,須自行重現。
- 發射器 fail-closed 不只擋未知節點型別,也要擋既有節點之未知 `op`(`mOp[op]` 為 undefined 時 sequelize 退回等值並依欄型 stringify,DATE 欄成查詢當日)、旗標非布林、`in` 之 `not=true` 且空 `vs`(契約為不產生,不得靜默發為恆假)。`lowerFind` 對 `$nin:[]` 其實會產生該節點(檔頭「不產生」指上游已拒收)。

## 第 94/87 項實作輪 B1+B2+B5(2026-10-21,浮動時間、`_lowerFindCases` 契約表、`whereMergeStrategy`;產物在 `tmp/pre/`、`tmp/mut/`、`tmp/review/`、`tmp/mutate.mjs`)

- **mocha 同層 `it` 先於子 `describe` 執行**:累計型斷言(如[格數 = 1460])若與被計數的 `it` 巢狀不同層,會在計數前先跑而得 `{}`。把被計數的 `it` 與統計 `it` 放同一層(時區改為 `it` 標題前綴,不開巢狀 `describe`)。
- **修前紅要有資訊量**:新測試 import 了尚不存在的匯出時,整個檔案載入即 `SyntaxError`(紅,但無資訊,且連累同檔其他群組)。作法:複製 `src test models` 到 `tmp/pre/`,於副本 `cvFind.mjs` 末加 `export const toFloating = () => null` 樁,以 `tmp/run-in.mjs tmp/pre <測試檔…>` 跑——得 115 紅:浮動時間全部、literal 與 `Sequelize.where` 兩種 scope 越界(`select({})` 亦回全部列、`selectByPk`/`del` 亦越界)。
- **sequelize `whereMergeStrategy` 可被 model 自身選項蓋過**(`Utils.merge(define 預設, model options)`):只在 `define` 層設 `'and'` 擋不住 model 自己寫 `'overwrite'`;匯入後對 `md.options.whereMergeStrategy` 一律設 `'and'`(sequelize 於查詢時才讀,事後設定即生效)。外審 sol 實證。
- **V8 `Date.parse` 接受曆法不存在之帶時區 ISO**:`Date.parse('2026-02-30T00:00:00Z')` 得 3 月 2 日(不是 NaN),所以帶時區字串必須先 `isCalendarDate` 驗曆法;無時區字串分支另以欄位回驗,兩分支的非法日期都要有測例(首輪變異存活即因測例只走無時區分支)。小數秒需有「截斷與四捨五入結果不同」之值(`.1239`、`.9999`)才抓得到進位變異。
- **測試時區矩陣 ≠ 輸入形式矩陣**:時區是主機維度,輸入字串之偏移(`-08:00`、`+0530`)是輸入維度,兩者要分開交叉;只把主機時區做滿,刪掉負偏移輸入分支仍全綠(sol F3 實證)。
- **`toFloating` 讀 `Date`**:用內建 `Date.prototype.getTime.call(v)` 讀內部槽(跨 realm 之 `Date` 可、非 Date 拋 TypeError 由外層 `try/catch` 轉 `null`),建普通 `Date` 再取本地分量;`v instanceof Date` 會把 `vm` 跨 realm 之 Date 誤判為非 Date,物件自有 `getTime`/`getFullYear` 之覆寫也會改變結果。
- `del()` 回傳**陣列**(單筆也是 `[{n,nDeleted,ok}]`);`save()` 單筆亦回陣列。測試 `r.nDeleted` 會得 `undefined`。
- npm 安裝依賴會把 `package.json` 末尾補換行(原檔無尾端換行),`git diff` 多一行雜訊;改後以腳本去掉。
- Windows `process.env.TZ` 執行期切換:12 個 IANA 時區(含 `Pacific/Chatham`、`Asia/Kathmandu`、`Australia/Lord_Howe`、`Etc/GMT+12`)在 Node 24 皆即時生效,`tzSelfCheck` 以 `getTimezoneOffset` 對 Intl(ICU)偏移自證;api 層 mssql 之 DATE 參數以 sequelize `timezone`(+00:00)格式化,與主機時區無關,故同一矩陣可在 mssql 跑滿。
- **變異驅動補測**:`tmp/mutate.mjs`(21+ 變異,3 並行,每個約 1 分鐘)首輪存活 2 個(毫秒四捨五入、帶時區字串略過曆法驗證),sol 外審另找出 5 個存活(負偏移、無冒號偏移、scope 內 `del`/`save` 空轉),補測後全數轉紅。變異腳本之錨點用 `from`/`to` 字串(`apply` 函數處理同樣的錨點出現多處者,如 save/del 的 `let md = …`)。
- **外審派工事實(本輪)**:sol(`gpt-6.1-sol`/max/`workspace-write`,cwd = 其輸出夾,`work/` 放倉庫副本,Node 依祖先目錄解析 repo 之 node_modules,免 junction)約 31 分出 8 條且自帶還原雜湊、獨立 witness,額度未用盡;其強項是對測試做變異並以獨立 witness 證明存活變異確可觀測。minimax(opencode,`--variant xhigh --print-logs --log-level ERROR`,匿名)第 1 次 exit 0 但無任何發現:模型把工作夾絕對路徑拼錯(`w-orm-reldap`),觸發 `external_directory` 自動拒絕後整個工作階段中止、`findings.md` 只剩標題;**審查包須全部放進其 cwd(brief、diff、帳本、README、倉庫副本),提示詞要求一律用相對路徑、工具被拒時改相對路徑重試、每項完成即追加**;第 2 次同設定約 34 分完成 8 條,其中 F8 為誤讀(案例表該案 `id` 為字串 `'undefined'`)。兩者皆未偵測到的類別:`save` 行為變更由 minimax 提出(sol 的探測列為「未發現越界更新」),sol 的 F2(model 層級覆蓋)則 minimax 的變異恰證實(M9)。
- 派工中途修改 repo 時,審查者讀的是派出當下之副本;其「存活變異」可能已被我之後補的測試殺死(minimax M10 即 define 層策略,我在其快照後才加策略斷言),收回後須以最新程式重跑其變異再核對,不可直接採信。

## reladb-run01(2026-10-28,診斷輸出之單一出口 R17;Gitea issue #12 同型;產物 `tmp/reladb-run01/` 已清除,證據在 `C:\opensrcOper\dnow\20261028054319\agent-out\reladb-run01-evidence\`)

- **盤點站點要連「sequelize 之 `logging` 選項」一起看**:`opt.logging = (opt.logging === true)` 傳給 sequelize 後,sequelize 以 `console.log` 輸出 SQL 全文(另有 SEQUELIZE0002 deprecation 警告);實測(sqlite)`SELECT/DELETE` 之 where 值為**內嵌**(含主鍵與欄位值),`INSERT/UPDATE` 為 `$n` 綁定不含值(`logQueryParameters` 預設 false)。傳函數給 `logging` 時,sequelize 以 `(sql, 查詢選項)` 呼叫,**第二引數含綁定參數值,不可取用**;傳 `true` 且 `benchmark` 為真時另有行為。
- **console 站點與錯誤文字之來源**:`emitChange`/`emitError` 之 catch 印的是**使用端訂閱函數拋的錯誤**(訊息常含資料);`initSequelize` 之 `console.log(r)` 印 model 檔載入錯誤(含絕對路徑)或驅動連線錯誤(含主機、登入名)。`genModelsByTabs.mjs` 之 TEXT 主鍵提示為不可達死碼(`o.type` 恆為 `DataTypes.xxx`)。
- **dist 打包不可引用 Node 內建模組**:`toolg/gDistRollup.mjs` 之 `external` 只列 fs/path/module,故 `getDiag.mjs` 不 import `util`(不能用 `util.types.isProxy/isNativeError`);改用 `instanceof Error`、描述子與自身內建 getter 比對。
- **不要用 `Object.prototype.toString.call(e)` 判 Error**:會執行 `Symbol.toStringTag` getter(使用端程式);`e.stack` 於 Node 24 為自有內建存取器,只在 `d.get === STACK_GETTER`(同 realm 新建 Error 之描述子 getter)時讀取;`instanceof Error` 不執行 getter。
- **遮罩拷貝不可沿用原型**:`Object.create(Object.getPrototypeOf(v))` 之副本會帶出繼承屬性,且繼承之 `util.inspect.custom` 於 `console.log` 格式化時執行並可印出未遮罩資料(外審 F8);副本一律普通物件/內建 `Error`(`name` 取原型鏈上之資料屬性)。
- **遮罩順序與細節(外審逐條實證)**:先辨識 `PRAGMA key` 語法再取代已知秘密(帳密恰為 `key` 時,先取代會破壞語法);`scheme://帳密@` 之帳密含 `@` 取至最後一個 `@`;屬性鍵與 Symbol 描述亦可含憑證;數字密碼在 `parameters`/`errCode` 為數值型別(只比字串會漏);帳號單獨遮罩須至少 3 字元(單元測試實測 `u` 會把 `users` 變 `***sers`、`count` 變 `co***nt`);`sqlite://:` 無帳密仍列為秘密(外審認定連線字串一律不得出現)。
- **回傳契約測試要有固定預期值**:同一份程式之各設定互比會把「所有設定共同之回歸」當成相等(外審 F13,變異 `nDeleted + 999` 存活);改為以**修改前 git HEAD** 程式跑同一情境產生 golden(`test/tools/diagGolden.json`)。產生法:複製 `src`/`models`,用 `git show HEAD:<檔>` 覆蓋被改之兩檔、刪 `getDiag.mjs`,以 `test/tools/diagScenario.mjs` 執行(腳本隨 `./tmp/` 清除,作法即本條)。
- **既有測試以 console 擷取偵測 SQL 時**:`test/api-find-whitelist.mjs:155` 用 `logging:true` 且斷言輸出含 `Executing`;R17 後需加 `logDetail:true`(此為唯一被動修改之既有測試)。
- **mssql 巢狀大條件案偶發逾時(15s)**:全套首輪 `巢狀 × 清單長度: $and 32層 × 每層99項`、`$and 4層 × 每層999項` 兩案逾時;未改碼第 2、3 輪全過,但這兩案在通過時仍耗 13.1~20.5 s(一案含 select 與 delAll 兩個請求,單請求逾時 15 s,sqlite 同案僅 1.4~4.9 s),本就貼近臨界,機器負載(全套 parallel、其他套件並行任務)一高即偶發逾時(推測,未證實根除;3 輪中 1 輪出現)。與診斷輸出無關。
- **外審派工事實**:terra(`gpt-6.1-terra`/`model_reasoning_effort="max"`/`workspace-write`,cwd = 審查包夾,`work/` 放倉庫副本、`base/` 放 HEAD 之兩檔、`out/` 放產出)約 15 分完成 20 條(審查者自評高 5、中 15;我核對後皆屬實或部分屬實,其中 F4 之百分比解碼半條為誤報〔本套件不解碼 `opt.url`〕、F17 為範圍外之 sequelize 固定警告,採納修正 16 條);先做讀寫探測(以 `rg` 讀中文檔第 1 行並寫檔)通過再正式派;其強項是以獨立探測腳本證實遮罩漏洞(PRAGMA 順序、鍵名、繼承屬性、`toStringTag` getter、未捕獲例外之 stderr)與 5 個存活變異。**提示詞以功能正確性措辭、明寫探測限在 `work/` 或自建夾具**,未遇內容審查。
- **變異腳本之錨點**:CRLF 檔(`WOrmReladb.mjs`)之多行錨點須把 `\n` 換成 `\r\n`;相同縮排之重複行(`nDeleted: nDel,` 出現 2 次)要加前導換行區別;改過原碼後,舊錨點會「出現 0 次」被略過,**須檢查「未套用」數為 0**,否則以為全殺實為沒施加。

## reladb-run02(2026-10-28,`throwUrlErr` 不回顯帳密 R17-6;證據在 `C:\opensrcOper\dnow\20261028054319\agent-out\reladb-run02-evidence\`)

- **`opt.url` 的解析語意決定可回顯什麼**:`split(opt.url, '://')` 取第 0、1 段(第二個 `://` 之後被丟棄);`split(u, '@')` 取**第一個** `@` 前為帳密、第二段為 host(多個 `@` 時第二段被當 host);無 `@` 時整段(如 `host:1433`)被當成 `帳號:密碼`,host 為空。故例外回顯不能照「解析結果」挑欄位(無 `@` 時 host:port 其實是帳密),要用獨立的純函數 `maskUrl` 依字面結構遮罩:最後一個 `@` 之前一律 `***`。
- **7 個呼叫點用「探測腳本」先確認每個測試 URL 真的落在宣告的呼叫點**(`tmp/reladb-run02/sites.mjs`,證據目錄 `sites-probe.mjs`):如 `mssql://host:1433` 落在 `invalid host`(不是 `invalid username or password`),`user:pass@host`(無 `://`)落在 `invalid dialect`(因 dialect 取整串),`://u:p@h` 落在 `no dialect`。測試表若憑直覺標呼叫點會標錯。
- **建構階段沒有 `diag`/`getSecrets`**:`throwUrlErr` 在 `diag` 建立之前呼叫(帳密尚未解析),所以遮罩函式必須是不依賴物件的純函數(`maskUrl`),不能用 `maskText(…, getSecrets(…))`。
- **主機段要用樣式白名單而非「@ 之後原樣照回」**:反向筆誤 `host:port@user:pass` 時 `@` 之後是帳密;`^(?:host|[IPv6])?(?::\d{0,5})?$` 擋掉非數字密碼,但 ≤5 位純數字密碼仍合 `主機:port` 樣式而被回顯(已文件化,待裁示是否連 host 也不回顯)。
- **未捕獲例外的 stderr 要用子行程實測**:`test/tools/urlerrWorker.mjs` 以 `execFile(process.execPath, …, { windowsHide: true })` 建構且不捕獲,斷言 stderr 含新訊息、不含帳密標記;只測 `try/catch` 取得的 `err.message` 不能證明 Node 實際印出的內容(堆疊首行含訊息)。
- **清理 `./tmp/` 前先以 lstat 遞迴列連結**(不跟進):`readdirSync(withFileTypes)` + `lstatSync().isSymbolicLink()`(Windows 連接點亦回 true),遇連結只記錄不下探;列出結果見報告。刪除用 `rm -rf`(對連結本身刪除、不跟進)前須確認無連結,或先以 `cmd //c rmdir` 拆連結並回驗目標。

## reladb-run03(2026-10-28,`genModelsByDB` 診斷輸出接上單一出口 R17-7;w-auto-sequelize 1.0.51;證據在 `C:\opensrcOper\dnow\20261028054319\agent-out\reladb-run03-evidence\`)

- **只升依賴不改碼並不會讓建構設定生效**:w-auto-sequelize 1.0.51 預設 `logging:false`、無 console,所以升版後 `genModelsByDB` 的預設輸出已靜默(「預設無輸出」案修前也是綠,屬回歸守則);但建構時的 `logging`/`logDetail`/`funLog` 完全不被承接(探測:建構 `logging:true` 無任何輸出)、失敗摘要沒有 `genModelsByDB ` 前綴、`opt.url` 不遮罩。修前紅的是「承接」「前綴」「遮罩 opt.url」這幾類案,不是「預設靜默」。
- **`genModelsByDB` 的 `directory`/`database` 取建構時的 `opt.fdModels`/`opt.db`,不是 `option.fdModels`/`option.db`**(`WOrmReladb.mjs` `option.directory = opt.fdModels`、`option.database = opt.db`;既有行為,未動):測試若建構時 `fdModels: './models'`,`genModelsByDB` 會把產出的 model 檔寫回專案 `models/`、覆寫版控中的檔。測試一律把建構時 `fdModels` 指到 `test/_tmp/<案名>/` 內夾。
- **w-auto-sequelize 的 `funLog` 只要給了函數,其 `logDetail` 就不被使用**(`getDiag` 在 `funLog !== null` 時先 return):故 `genModelsByDB` 的 `logDetail` 實際生效處是本套件 `diagCall`(以合併後的 `optLogCall` 建立),傳給 w-auto-sequelize 的 `logDetail` 只是語意一致(變異 W13 預期為等價存活)。
- **單次覆寫要能分辨「未給」與「給 false」**:`getOptLog` 回傳預設值(`logDetail:false`),無法分辨,所以另寫 `mergeOptLog(base, opt)`:型別正確才覆寫,型別錯誤沿用 base(不放寬也不關閉)。`funLog` 無法於單次呼叫改回無(`null` 視同未給),README 已寫。
- **兩層 `cpMask` 的顯示差異**:w-auto-sequelize 的錯誤副本保留建構子名稱(`ConnectionError [SequelizeConnectionError]`),本套件 `cpMask` 再複製一次後變成 `Error [SequelizeConnectionError]`;訊息、堆疊、`parent`/`original` 欄位內容不變。測試用 `/SQLITE_CANTOPEN: unable to open database file/` 判斷,不比類別前綴。
- **外鍵查詢失敗的注入法**:`import Sequelize from 'sequelize'`(與 w-auto-sequelize 同一份模組實例,`node_modules/w-auto-sequelize/node_modules` 不存在),暫換 `Sequelize.prototype.query`,遇 `foreign_key_list` 回 reject(帶 `code:'SQLITE_ERROR'` 與夾帶憑證的訊息),`finally` 還原;建表清單失敗則把 `storage` 指到資料夾(真實 `SQLITE_CANTOPEN`)。
- **`npm i <套件>@<版本>` 會在 `package.json` 檔尾補換行**(原檔無結尾換行),`git diff package.json` 多出 `\ No newline at end of file` 差異:裝完用 Edit 去掉,只留 `w-auto-sequelize` 版本號一行與 lock 的版本欄位。
- **測試鎖被他套件長時間占用時**:`quiet-run --lock` 會排隊(最多 3 小時),排隊期間指令尚未讀 `src/`,故不能同時改 src;做法是把修前 `src/` 與新測試複製到 `./tmp/<輪>/pre/`(inside repo,`node_modules` 向上解析仍可用),用一支腳本在**一次取鎖內**依序跑「修前快照(紅)」與「現行(綠)」。
- **殘留警示**:`import * as G from '../src/getDiag.mjs'` 取命名空間可讓「修前不存在的新匯出」的測試個別失敗(TypeError)而非整檔 import 失敗,修前紅的統計才有意義。

## 第 209/208 項(2026-10-31,連線空檔中斷查證 R18;`genModelsByDB` 失敗改 reject R17-7f;證據在 `C:\opensrcOper\dnow\20261031075230\agent-out\reladb-evidence\`)

- **「`src` 無 `.on('error'` 故會崩潰」要先問連線物件是誰建的**:本套件不自建驅動連線,全經 sequelize;sequelize 6 於 mssql(tedious)、mysql(mysql2)、mariadb、postgres(pg)之連線管理在連線建立後即永久 `connection.on('error')`(`lib/dialects/<方言>/connection-manager.js`)。同型缺陷(w-orm-postgresql 第 162 項)之前提是自建 `pg.Client`,此處不成立。四方言皆以真後端實測:空檔 `KILL`/`pg_terminate_backend` 後驅動確實發 `error` 事件,但監聽者數 n=1(sequelize 自掛),行程離開碼 0,其後 select 成功。結論不屬實,**不改 `src` 行為**。
- **「驅動確實發了 error」才算打到空檔路徑**:探測以包裝 `EventEmitter.prototype.emit` 記錄每次 `error` 發出時 `listenerCount('error')`(僅觀察,於呼叫原 `emit` 之前先記錄,崩潰前以 `fs.writeSync(1, …)` 同步寫出);`errSeen` 為真且 n≥1 才證明「事件發出且有人接」,只看離開碼 0 可能是根本沒觸發事件。測試以此事件為同步點(不用 `sleep(N)`)。
- **語句進行中與空檔不同**:mysql2 於語句進行中被終止時**無** `error` 事件(語句 reject);pg、mssql、mariadb 兩種情形皆發事件。故守則之「對照組」只斷言「語句 reject、行程存活、n≥1(若有事件)」,不假設各方言皆發事件。
- **負向對照比「還原修正之變異」更直接**:本次無修正可還原,改在情境內以 `connectionManager.getConnection()` 取出池內唯一連線、`removeAllListeners('error')` 後歸還(`strip`),再中斷 → 子行程必崩潰(stderr `Unhandled 'error' event`、n=0)。它證明測試情境確能造成終止,不是空轉;另以暫改 `node_modules/sequelize/.../mssql/connection-manager.js`(`connection.on("error"` 改名)之變異驗證(11 案 5 紅),事後還原並比對雜湊。
- **子行程崩潰時之收尾順序**:負向對照中,KILL 一生效子行程即死,`close` 事件可能早於「KILL 之 sqlcmd 回傳」,父行程取 `killed`(被終止之連線數)須先 `await` 終止之 promise 再 resolve,否則得 `null`。
- **以 `host_process_id` 精準終止**:tedious 登入時回報之 client pid 出現在 `sys.dm_exec_sessions.host_process_id`,子行程於 `READY` 印出 `process.pid`,父行程只 `KILL` 該 pid 之連線,不波及同容器其他套組之連線;語句進行中以 `sys.dm_exec_requests.wait_type = 'WAITFOR'` 輪詢(可觀察條件)確認語句已進伺服器再終止。
- **postgres、mysql、mariadb 之驅動不是本套件依賴**:一次性探測把 `pg`、`mysql2`、`mariadb` 裝在 `./tmp/reladb/drv`(`npm --prefix`),子行程以 `NODE_PATH` 令 sequelize 之 `require('pg')` 解析到它;映像 `postgres:17-alpine`、`mysql:8.4`(本輪新拉,1.12 GB)、`mariadb:11`(本輪新拉)。mysql 之 root 以 `MYSQL_ROOT_PASSWORD` 建,`MYSQL_USER` 需另 `grant`。真後端不入庫(非依賴),入庫者為 mssql 之 `api-connerr` 與讀碼盤點 `unit-connerr`。
- **sqlite 之無 callback 呼叫**:sequelize sqlite `connection-manager.js` 之 `connection.run("PRAGMA KEY=…")`、`connection.run("PRAGMA FOREIGN_KEYS=ON")`、`releaseConnection` 之 `connection.close()` 皆無 callback,sqlite3 於無 callback 時把錯誤以 `error` 事件發給 `Statement`/`Database`(無監聽即崩潰);實測純檔、帶密碼、非資料庫檔(`SQLITE_NOTADB`)均不觸發,故判定未發現路徑,但 `close()` 失敗(SQLITE_BUSY)未能重現,記為讀碼推測。
- **範圍外發現(未修,待裁示)**:sqlite 之 storage 無法開啟(資料夾、無權限)時,sequelize 6.37.1 留下開啟失敗之 `Database`,`sequelize.close()` 永不 settle,本套件各函數於 `finally` 之 `closeSequelize` 卡住,**reject 送不出**(純 sequelize 可重現)。探測 `dirProbe2.mjs`、`closeHang.mjs`。探測時須以保活計時器(`setInterval`)與 `Promise.race` 逾時,否則事件迴圈清空行程靜默結束(離開碼 13,`Detected unsettled top-level await`)而看不出是懸置。`api-diaglog-gen` 之 `storage: dir` 案不受影響(w-auto-sequelize 不等待 close)。
- **w-auto-sequelize 1.0.53 之 reject 對舊測試之影響**:升版後 `api-diaglog-gen`(12 案)原以 `captureConsole(() => genModelsByDB(...))` 取得 resolve 值,reject 時 `captureConsole` 之 `finally` 還原 console 但丟失已擷取輸出;改以 `genByDBRej` 於 `captureConsole` 內 `try/catch` 回傳 `{ rej, out, err, all }`。**`assert.ok(cond, \`…${JSON.stringify(x.ok).slice()}\`)` 之訊息樣板會在條件為真時也先求值**(`ok` 為 undefined 時 `.slice` 拋 TypeError),須改 `if (!cond) assert.fail(...)`。
- **w-auto-sequelize reject 值內憑證之邊界**:`genModelsByDB` 以單次呼叫之帳密連線,w-auto-sequelize 只遮罩單次憑證;建構時之帳密(opt.url)不傳給它,故若測試把建構時之密碼夾進注入之錯誤訊息,reject 值內不會被遮(此為契約:實際連線不用建構時之帳密)。reject 斷言只驗單次憑證已遮。
- **wsemi 1.9.33 語料新增 wire 案 C14、U22、A11**:`api-diaglog-wire` 之「wire 案皆已分類」斷言於升版後失敗,須分類(C14 適用:pg 形態 DatabaseError 之 `errType` 為 `Error` 因本套件 `types` 固定為 sequelize 之 name 系列;U22 不適用:不用 `conns` 來源;A11 不適用:不呼叫 `genDiagFunLog`)。先以 `wireIds.mjs` 列出語料 wire 案全集再比對,避免逐次失敗逐個補。
- **`npm i <套件>@latest` 重寫 `package.json`**:不只補檔尾換行,還把 `author` 改寫、補 `description`、`directories`、`type`、`bugs`、`homepage`(本輪實見);裝完以 Edit 還原為只剩兩個依賴版本號之差異(`git diff package.json`),`package-lock.json` 之 `version` 欄位隨 `package.json` 之 `version`(1.1.18)同步,屬 npm 衍生。單純 `npm i` 不會升已安裝版本(`^` 範圍已滿足),須 `npm i <套件>@latest`。
- **暫換 `node_modules` 做修前紅/變異**:腳本 `mutate.mjs` 先備份(`rename`/`copy`)、套用、跑測試、還原並比對雜湊(`was-apply`/`was-restore`、`seq-apply`/`seq-restore`);w-auto-sequelize 1.0.52 以 `npm pack … --pack-destination` + `tar -C` 取得,不裝進 repo。

## 第 210 項(2026-10-31,sqlite storage 無法開啟時各函數永不 settle 之修正 R19;探測與變異腳本在 `./tmp/reladb/` 結案時清除,證據在 `C:\opensrcOper\dnow\20261031101856\agent-out\reladb-evidence\`)

- **懸置之偵測用事件,不用牆鐘**:懸置之 Promise 不持有事件迴圈,其後迴圈排空而觸發 `beforeExit`(結束碼 13);子行程情境於 `beforeExit` 仍有未 settle 之步驟即回報 `pending`(`test/tools/sqliteOpenScenario.mjs`),修前每案約 0.5 秒即得結果。與第 209 項之探測法相反(那裡以保活計時器加 `Promise.race` 逾時才看得出懸置):二者不衝突,但**含保活計時器者看不到 `beforeExit`**,擇一即可;父行程另設 90 秒外層逾時只防「迴圈被他物撐住」之懸置,不表達規格。
- **一個懸置會拖垮同行程所有實例**:模組層級 `pmq = pmQueue(1)`(`WOrmReladb.mjs:54`)全域共用,第一個永不 settle 之 `select` 占住佇列,其後**任何實例**(含正常檔)之 `useStable` 操作都排在其後而永不執行(`createStorage`、`init` 不經佇列,故不受影響)。同一探測於同一行程連跑各形態會得到「正常檔也 PENDING」之假象,**探測須每形態、每函數各自獨立行程**(測試亦然),否則前一個懸置污染後一個。驗 R19-2 須以 `bg`(只啟動不等待)啟動開啟失敗者,否則依序 `await` 之情境在第一步即停,看不出擋住後續。
- **探測對照組共用同一 storage 檔會互相污染**:首版對照組(正常檔、父資料夾可建立)各函數共用同一檔,並行之子行程之 `insert` 與 `insertBulk` 撞唯一鍵(`Validation error`),誤判為修正無效;各函數各用獨立 storage 路徑(並行子行程之通則)。
- **`:memory:` 在本套件不是記憶體資料庫**:`opt.storage` 經 `path.resolve`(`WOrmReladb.mjs` 建構段),win32 得 `C:\…\:memory:`(非法路徑,`SQLITE_CANTOPEN`,修前懸置),POSIX 得 cwd 下名為 `:memory:` 之檔案。測試之 `:memory:` 案依平台斷言(win32 reject、POSIX resolve),子行程 cwd 設在 `test/_tmp/…` 內以免在 repo 根留下 `:memory:` 檔。
- **無權限之造法**:win32 以 `icacls <檔> /deny <網域\使用者>:(R,W)`(`execFileSync`,不經 shell),測試之 `after` 以 `/remove:d` 還原再刪檔(否則含 deny 之檔刪不掉);POSIX 非 root 以 `chmod 000`,root 略過(root 不受檔案權限拘束)。探測腳本若因懸置而未走到 `finally`(結束碼 13)會**遺留 deny 之檔**,須手動 `icacls /remove:d` 再刪(本輪探測 `probe-perm.mjs` 即遇,已還原並回驗)。**寫探測時還原動作須放在父行程或另一道指令,不可只放在可能懸置之同一行程之 `finally`**。
- **修正之判準選 `Database.open === false`,不選逾時、不選預先檢查**:逾時會把慢速之合法關閉當失敗,對寫入函數更會在已提交後 reject;預先檢查(`stat`/`access`)只涵蓋已知形態,`CANTOPEN` 之成因(超長檔名、路徑非法、權限、裝置)無法窮盡(探測 `probe-odd.mjs` 之 10 種古怪形態修後皆 settle,其中含 `<>`、深路徑兩種 `CANTOPEN` 為預先檢查不易預料者)。sqlite3 之 `open` 為 `InstanceAccessor`(`database.cc:28`),缺該屬性時不動(`unit-sqlite-open` R19-5 鎖定);sequelize 之 `connections` 為其連線管理物件之公開欄位(無文件),故以 `unit-sqlite-open` R19-6 盤點為升級哨。
- **CRLF**:`src/WOrmReladb.mjs` 與 `README.md` 之工作樹為 CRLF(索引為 LF,`core.autocrlf=true`),`Edit` 工具保留之;以腳本批次替換時須先正規化為 LF 再套用、寫回時還原 CRLF(變異腳本首版因 `from` 含 `\n` 而 4 個「未套用」,即此)。新檔(LF)與既有 `src/getSqlStmt.mjs`、`test/*` 一致。
- **`path` 含 NUL 之 storage**(範圍外,未修):`chkOrmStr(..., { nul: false })` 刻意不檢 NUL,sqlite3 把 `a\0b.sqlite` 截為檔名 `a`(探測 `probe-nul.mjs` 實測於工作夾得 `["a"]`),與 R13 同類之別名風險,待裁示。

## mig-reladb(2026-10-29,遷移至 wsemi 共用診斷模組 R17-8;排程第 161 項第 2 波;腳本與輸出之證據在 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-reladb-evidence\`)

- **固定詞彙與外來值同一個 catch**:七函數之整批 catch 同時攔得本套件之檢核錯誤(`invalid find`、`invalid data`、`instance is closed`、`can not import model`)與後端錯誤,依內容判斷會誤分(後端訊息也可能以 invalid 開頭);改以**來源登記**:`src/ownErr.mjs` 之 WeakSet(`ownErr` 產生、`markOwnErr` 登記既有物件),字串之 `si.err` 以身分比對。wsemi `cvOrmFind` 之 catch 一律重建 `invalid find: <固定原因>`(實讀其原始碼),故可整批登記;本套件其他會進 catch 之 `new Error` 都要換 `ownErr`,`unit-diaglog` 以「`throw new Error(` 只剩建構期 2 處」鎖住。
- **驗固定詞彙原樣的方式**:以密碼恰為訊息子字串建實例(`invalid`、`import`、`closed`,皆 ≥4 字元才進 reject 清單),並在同一實例上放一個含該字的外來錯誤作對照(仍被遮),才能證明原樣是分流所致而非遮罩沒作用。
- **外來錯誤之注入**:sqlite 測試用 model 檔之 hook(`beforeFind`、`beforeCreate`、`beforeBulkCreate`、`beforeBulkDestroy`)經 `globalThis.__wormWire` 拋出任意值——hook 於取連線前執行,不留 sqlite 檔案控制代碼;save/del 要觸發整批 reject 須拋 `Sequelize.ConnectionError`(`isBatchLevelError`),其他錯誤會變逐筆 err。`initSequelize` 之加密設定路徑:sqlcipher 未安裝,以 `Module._resolveFilename` 把 `@journeyapps/sqlcipher` 暫解析為 sqlite3,並在 `Sequelize.prototype.query` 層讓 `PRAGMA` 失敗(不開連線);`closeSequelize` 以先呼叫原 `close` 再拋錯之方式注入,避免檔案鎖使 `after` 刪不掉 `test/_tmp`。
- **wsemi 之動態秘密**:`maskDiagCopy`/`maskDiagErr` 把錯誤自帶之 `path` 併入該次細節清單,故 `genModelsByTabs` 寫檔失敗之 `logDetail` 輸出不再見到檔名(`open '***'`);舊測試斷言「logDetail 還原路徑」者須改。
- **原始碼盤點測試之註解剝除**:行內 `//` 註解裡出現 `://***` 會含 `/*`,若先以 `/\*[\s\S]*?\*/` 剝區塊註解會從該處吃到下一個 JSDoc 結尾,把中間的程式碼(如 `throwUrlErr`)整段當註解;改為只認行首之 `/*`。
- **變異時原始碼盤點不計**:`unit-diaglog` 讀 cwd 之 `./src`,變異副本在 `./tmp/mig-reladb/mut/src`,故變異結果之「殺死」皆來自行為測試(`api-diaglog-wire` 等),盤點測試另行鎖站點。
- **測試鎖**:同時有 2 套件跑全套且佇列 4～6 筆時,排隊可超過 20 分;背景指令(10 分鐘後即被收)會失去佇列位置,改以 `nohup node quiet-run --lock -- node tmp/<輪>/run-all.mjs` 啟動,一次取鎖內依序跑「受影響測試 → 全綠才跑修前紅與變異」。

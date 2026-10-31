# 現況(state)

本檔記當前已開發功能之最新狀態(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本),只記現況、不寫過程(過程見 `sgud/exp/experience.md`)。藍圖(規則)見 `sgud/rule/rulebook.md`。

- 套件版本:`package.json` 1.1.20(第 208/209/210/213 項〔2026-10-31〕未動 `version`;發布由使用者/主控負責)。依賴 `wsemi` `^1.9.33`、`w-auto-sequelize` `^1.0.53`、devDependency `w-package-tools` `^1.1.21`(第 213 項再查證:自有相依皆已最新,`npm-check-updates` 僅列非自有之 `tedious` 19→20 major,不動)。
- 本檔於 2026-10-28(reladb-run01)首次建立;更早之功能現況請以 `sgud/rule/rulebook.md` 之 R1–R16 與〈破壞性變更紀錄〉為準。

## 功能現況

| 功能 | 規則帳本 | 測試檔 | 現況 |
|---|---|---|---|
| 條件(find)系列白名單、值檢核、主鍵正規化、scope 合併 | R1–R11、R16 | `unit-cvfind`、`api-find-whitelist`、`api-suite`、`api-scope`、`api-lower-cases` | 完成 |
| 寫入側 DATE 範圍、字串良構、浮動時間 | R12–R14 | `unit-date-write`、`api-date-write`、`unit-wellformed`、`api-wellformed`、`unit-float`、`api-float` | 完成 |
| model 檔載入與發布產物 | R9、R10 | `api-models`、`api-dist`、`api-init` | 完成 |
| **診斷輸出之單一出口與預設安全(reladb-run01)、建構函式 opt.url 例外不回顯帳密(reladb-run02)、`genModelsByDB` 診斷輸出接上單一出口(reladb-run03)、遷移至 wsemi 共用模組(mig-reladb)** | R17(含 R17-6、R17-7、R17-8、R17-9) | `unit-diaglog`、`api-diaglog`、`api-diaglog-gen`、`api-diaglog-wire`、`unit-urlerr` | 完成(見下;驗證結果見 R17-8 段;R17-9 見〈reladb2〉段) |
| **連線空檔被中斷不使行程終止(第 209 項,2026-10-31)** | R18 | `api-connerr`(經 `api-mssql.test.mjs`)、`unit-connerr`;情境 `test/tools/connErrScenario.mjs` | 完成:查證不屬實(sequelize 6 於四個網路方言之連線已永久掛 `error` 監聽),未改 `src` 行為;守則測試入庫(見下) |
| **`genModelsByDB` 失敗改 reject(第 208 項,2026-10-31)** | R17-7f(更正) | `api-diaglog-gen`、`api-diaglog-wire` | 完成:README/JSDoc/帳本已更正,測試已改並補 reject 案(見下) |
| **sqlite storage 無法開啟時各函數須 settle(第 210 項,2026-10-31)** | R19 | `api-sqlite-open`(104 案,含第 213 項增 31 案)、`unit-sqlite-open`(11 案);情境 `test/tools/sqliteOpenScenario.mjs` | 完成:屬實並已修(`src/dropUnopenedConn.mjs`、`closeSequelize` 呼叫);見下 |
| **sqlite 之 opt.storage 含 NUL 或恰為 `:memory:` 於建構時拒收(第 213 項,2026-10-31)** | R20(R13、R19 相關句已更正) | `unit-storage`(51 案)、`api-sqlite-open`(R20-9、R20-10;104 案)、`unit-wellformed`(盤點案)、`unit-diaglog`(站點全集案) | 完成:屬實並已修(`src/WOrmReladb.mjs` 建構段);見下 |

### reladb2:api-diaglog R17-1 註解去除之盲點(2026-10-31;R17-9;只動測試與文件,`src/` 未動)

- 結論:**屬實,已修**。`test/api-diaglog.test.mjs` R17-1 之註解去除正則原為不限位置之 `/\/\*[\s\S]*?\*\//g`,被 `src/WOrmReladb.mjs` 第 161 行**行註解**內之 `<scheme>://***`(含 `/*`)誤當區塊註解起點,吃到第 268 行 JSDoc 之 `*/`,第 162–256 行(68 行程式碼:`throwUrlErr`、dialect 與帳密/host/port 解析、R20 之 sqlite 拒收、`optLog`/`cfg`/`diag`/`logSql`)對 `console` 掃描隱形。改為與 `unit-diaglog.test.mjs` 之 `src()` 同一寫法(只認行首之區塊註解),並於該案加 canary:去註解後之文字須仍含 `let throwUrlErr = (msg) =>` 與 `let diag = getDiag(optLog, cfg)`,否則以「掃描已失明」失敗。
- 同型站點全表(4 處程式碼,`rg -nF "[\s\S]*?\*\/" test/`):`api-diaglog.test.mjs:108`(本輪修)、`unit-diaglog.test.mjs:19`(本即行首錨定)、`unit-wellformed.test.mjs:285`(第 213 項修)、`unit-storage.test.mjs:240`(第 213 項新增,行首錨定);已無不限位置者。
- 變異(src 暫植 `console.log(1)`,還原後驗雜湊):修前 R17-1 於隱形區段 8 個位置全數存活(可見區段對照位置被擊殺);修後 8 個位置全數擊殺且各標出所植之行號;測試端變異(把正則改回不限位置)由 canary 擊殺。受影響 4 檔(`api-diaglog`、`unit-diaglog`、`unit-wellformed`、`unit-storage`)539 passing / 0 failing;eslint `api-diaglog.test.mjs` 0 error。全套由主控跑(本輪未跑)。
- 已知缺口/待辦:無新增。canary 所指之兩段程式碼若被重構改名,須更新(見 R17-9)。

### 第 213 項:sqlite 之 opt.storage 含 NUL 或恰為 `:memory:`(2026-10-31;R20)

- 結論:**屬實,已修**(主控依專案原則 3 裁定收嚴)。①`a\0b.sqlite`、`a\0c.sqlite` 兩實例建構皆成功,sqlite3 於 NUL 截斷而皆開出檔 `a`,經前者寫入、後者讀得(別名);②`:memory:` 經 `path.resolve` 後為 `<cwd>/:memory:`(POSIX 為該名之檔、win32 為非法路徑),各函數每次 init+close,記憶體庫語意上不可行。修正:`src/WOrmReladb.mjs` 於 dialect 驗證之後對 sqlite 檢 `chkOrmStr(storageRaw)`(NUL)與 `storageRaw === ':memory:'`,throw `invalid opt.storage: string contains NUL`、`invalid opt.storage: must be a file path, an in-memory database is not supported`(固定詞彙、不回顯值);`path.resolve(opt.storage)` 移到判斷之後;其他方言與形似名稱(`./:memory:`、`x:memory:`、`:MEMORY:`、`file::memory:` 等)不拒。
- 文件:README〈Breaking changes: `opt.storage` of sqlite: a `NUL` or the literal `':memory:'` is refused by the constructor〉、〈Well formed strings〉表增列、移除〈…cannot be opened…〉內之 `:memory:` 說明;JSDoc 類別註與 `opt.storage` 之 `@param`;帳本 R20、〈破壞性變更紀錄(第 213 項)〉、R13/R19 相關句更正。
- 測試:`unit-storage`(51 案:NUL 9 形態 + 別名、`:memory:`、固定詞彙與 useEncryption、邊界 19 形態、他方言 8、順序、不改動不建檔、接線站點掃描);`api-sqlite-open` 之 `memory` 形態改為建構拒收、增 `nul` 形態、R20-9 無副作用(各 10 函數)、R20-10 回歸守則(`path.resolve` 仍於建構時定位);`unit-wellformed` 盤點案 `chkOrmStr(` 改 2 處且註解去除正則改為只認行首區塊註解;`unit-diaglog` 站點全集案之建構期 `throw new Error` 由 2 處改 4 處。修前紅 51(`unit-storage` 20、`api-sqlite-open` 30、`unit-wellformed` 1);變異 15 個全數殺死(`tmp/reladb/mutate.mjs`,結案時隨 `./tmp/` 清除,結果記於報告)。
- 驗證(2026-10-31,`quiet-run --lock`):全套 `npm test` **6893 passing / 1280 pending / 0 failing,exit 0**(6m58s;較第 210 項之 6811 增 82 案 = `unit-storage` 51 + `api-sqlite-open` 31);eslint 改動 5 檔 0 error。首輪全套 1 紅(`unit-diaglog` 站點全集案之建構期 `throw new Error` 計數,見上),修測試後重跑全綠。
- 已知缺口/待辦:①POSIX 平台實跑未做(本機 win32;判斷為純字串比對與平台無關);②(已修,reladb2,見上段與 R17-9)`test/api-diaglog.test.mjs` 之註解去除正則為不限位置之區塊註解寫法,會被 `WOrmReladb.mjs` 第 161 行行註解內之 `://***` 誤觸發而略過其後 68 行程式碼;③`@journeyapps/sqlcipher` 之 `useEncryption` 路徑僅測建構拒收(不載入該套件)。

### 第 210 項:sqlite storage 無法開啟時各函數永不 settle(2026-10-31;R19)

- 結論:**屬實,已修**。sequelize 6.37.1 之 sqlite connection-manager 把開啟失敗之 `Database` 留在 `connectionManager.connections`,`sequelize.close()` 對它呼叫 `close(callback)` 永不回呼(sqlite3 於未開啟之 Database 把 close 排入佇列),本套件各函數於 `finally` 之 `closeSequelize` 卡住;模組層級 `pmq` 全域共用,一個懸置另使同行程其他實例之 `useStable` 操作全部懸置。修正:`src/dropUnopenedConn.mjs`(新,純函數)於 `closeSequelize`(`WOrmReladb.mjs:681-685`)對 sqlite 在 `sequelize.close()` 前移除 `open` 嚴格為 `false` 之 Database;不採逾時、不採預先檢查(理由見 R19)。
- 文件:README〈Breaking changes: an sqlite storage that cannot be opened rejects instead of never settling〉;JSDoc 類別註與 `closeSequelize`;帳本 R19、〈破壞性變更紀錄(第 210 項)〉、已知限制首條改「已修」。
- 測試:`api-sqlite-open`(7 形態〔資料夾、檔名超長、無權限、父路徑為檔案、`:memory:`、正常檔、父資料夾可建立〕× 10 函數、R19-2 不擋同行程他實例、R19-2b 同實例再呼叫、R19-4 不含帳密)、`unit-sqlite-open`(`dropUnopenedConn` 嚴格判準、依賴盤點、真實 sequelize)。修前紅 41(72 案時);變異 13 個全數殺死(`tmp/reladb/mutate.mjs`,結案時隨 `./tmp/` 清除,結果記於報告)。
- 已知缺口/待辦:①`@journeyapps/sqlcipher` 未測(假設為 sqlite3 分叉而有同一 `open` 存取器;缺該屬性者不動);②(已修,第 213 項,見 R20)路徑含 NUL 字元之 `opt.storage` 被 sqlite3 截斷(實測 `a\0b.sqlite` 得檔名 `a`),現於建構時拒收;`:memory:` 亦同(原為依平台之形態,現不屬開啟失敗,`api-sqlite-open` 之 `memory` 形態改為建構拒收);③其他方言之連線失敗未重測。

### 第 209 項:連線於空檔被中斷(2026-10-31;R18)

- 結論:**不屬實,不改 `src` 行為**。本套件不自建驅動連線(僅 `initSequelize` 之 `new Sequelize`),sequelize 6.37.1 於 mssql、mysql、mariadb、postgres 之 `connection-manager.js` 連線建立後即永久 `connection.on('error')`(並 `pool.destroy`)。真後端實測(空檔 `KILL`/`pg_terminate_backend`、交易閒置、語句進行中):mssql(SQL Server 2022,入庫)、postgres 17、mysql 8.4、mariadb 11(探測)皆驅動確發 `error` 事件(語句進行中之 mysql 除外)且監聽者 n=1、行程離開碼 0、其後操作成功;sqlite 讀碼 + 實測(純檔、帶密碼、`SQLITE_NOTADB`)無路徑,`close()` 失敗未能重現(讀碼推測)。細節與證據見 R18、`sgud/exp/experience.md`。
- 新增測試:`test/api-connerr.mjs`(5 案:R18-0 對照、R18-1 空檔、R18-2 交易閒置、R18-3 語句進行中、R18-4 負向對照〔移除連線監聽 → 崩潰〕;子行程情境 `test/tools/connErrScenario.mjs`;自 `api-mssql.test.mjs` 以其容器呼叫,`killSessions` 以 `host_process_id` 精準終止)、`test/unit-connerr.test.mjs`(6 案:四方言 connection-manager 之永久監聽盤點、sequelize 主版本 6、判定式負向對照)。變異(暫移除 sequelize mssql 之永久監聽):11 案 5 紅(R18-5 mssql、R18-6、R18-1、R18-2、R18-3),已還原並驗雜湊。
- 已知缺口/待辦:①(已修,第 210 項,見 R19)sqlite storage 無法開啟時各函數永不 settle;②sequelize 於回滾失敗時之 `console.warn` 不經本出口(同 R17 已知限制③);③postgres/mysql/mariadb 之驅動非本套件依賴,其真後端測試不入庫(以 `unit-connerr` 之讀碼盤點為升級哨)。

### 第 208 項:`genModelsByDB` 失敗改 reject(2026-10-31;R17-7f 更正)

- 來源:w-auto-sequelize 1.0.53 起建表清單、描述表、外鍵查詢、連線、建資料夾與寫檔失敗皆 reject;`genModelsByDB`(`WOrmReladb.mjs`)直接回傳其 promise,行為隨之改變。README 新增〈Breaking changes: `genModelsByDB` rejects on failure〉並更正〈Breaking changes: diagnostic output〉之一句;JSDoc `genModelsByDB`(reject 條件、`@returns`)與類別註(連線被中斷);帳本 R17-7f、依賴行、破壞性變更紀錄(第 208 項)、R18。
- 測試:`api-diaglog-gen` 12 案改為先斷言 reject(新輔助 `genByDBRej`),R17-7f 區塊改為「失敗路徑 reject」並補 4 案(建表清單失敗各診斷設定、外鍵查詢失敗、連線失敗〔目標埠無服務〕、無表 resolve〕;`api-diaglog-wire` 因 wsemi 1.9.33 語料新增 wire 案 C14、U22、A11 補分類(C14 適用並補一案;U22、A11 不適用附理由)。修前紅:以 w-auto-sequelize 1.0.52 換入,`api-diaglog-gen` 30 案中 14 紅(無表 resolve 之對照案與其餘回歸案綠)。
- 驗證(2026-10-31,`quiet-run --lock`):全套 `npm test` **6727 passing / 1280 pending / 0 failing,exit 0**(7m34s;較 mig-reladb 之 6712 增 15 案:`api-connerr` 5、`unit-connerr` 6、`api-diaglog-gen` 淨增 3、`api-diaglog-wire` 1);eslint 改動 7 檔 0 error。

### R17-8 遷移至 wsemi 共用診斷模組(2026-10-29,mig-reladb;排程第 161 項,第 2 波)

- 實作:刪 `src/getDiag.mjs`;新增 `src/getSqlStmt.mjs`、`src/mergeOptLog.mjs`、`src/ownErr.mjs`;`src/WOrmReladb.mjs` 以 wsemi `getDiag(optLog, cfg)`(cfg:secrets〔url、帳密、sqlite 路徑〕、patterns `pragmaKey`、codes、types 24 名、nested、safeKeys)為出口,整批 7 站 `outErr`、逐筆 2 站 `diag.mask`、`initSequelize`/`closeSequelize`/`genTransaction`/`snap` 經 `diag.err`,固定詞彙以 `ownErr`/`markOwnErr`/`si.err` 辨識不包;`throwUrlErr` 改 `maskDiagUrl`(`<scheme>://***`);`genModelsByDB` 用 `getDiag(optLogCall, cfg).with(單次帳密與 sqlite 路徑)`,其 reject 原樣交出;`src/genModelsByTabs.mjs` 第 4 參數契約(wsemi getDiag 實例,不合者用預設出口);`src/cvFind.mjs` 之拋錯改 `ownErr`、`chkFindShape` 以 `markOwnErr` 登記。規則見 rulebook R17-8。
- 文件:README〈Diagnostic output〉改指 wsemi、增「Errors handed back to you」,〈Breaking changes: shared diagnostic module (wsemi)〉;JSDoc(`WOrmReladb` 之 opt.url/logDetail/funLog 與類別註、`genModelsByDB`、`genModelsByTabs`)。
- 驗證(2026-10-29,單次 `quiet-run --lock` 內依序執行;證據 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-reladb-evidence\`):受影響 5 檔 141 passing / 0 failing(`unit-diaglog` 12、`unit-urlerr` 35、`api-diaglog` 25、`api-diaglog-gen` 27、`api-diaglog-wire` 42);全套 `npm test` 6712 passing / 1280 pending / 0 failing(exit 0,7 分);修前(git HEAD 之 `src/` + 新測試)129 案中 63 紅 66 綠(綠者為回歸守則與修前自寫遮罩已涵蓋之形態);變異 39 個全數殺死(皆由行為測試,未套用 0)。`diagGolden.json` 0 改變(未重產)。
- 已知限制/待辦:①`getErrMsg` 讀取逐筆錯誤之 `message` 時仍可能執行使用端之 getter(修前即如此;取得後才經 `diag.mask`);②預設 url(`username:password`)時字詞 `password` 於對外錯誤值被遮(fail-closed,README 已寫);③mssql/mysql/postgres 之對外錯誤值未實連驗證(遮罩與方言無關;sqlite 以 hook 注入外來錯誤驗證);④w-orm-mdb(第 3 波)須傳 wsemi getDiag 實例為 `genModelsByTabs` 第 4 參數,其 safeKeys 須含 `name`、`type`,並提高對本套件之依賴下限。

### R17-7 `genModelsByDB` 診斷輸出(2026-10-28,reladb-run03;第 156 項)

- 實作:`src/getDiag.mjs`——`diag` 新增第 5 參數 `method`(預設 `'log'`,其餘站點行為不變)、新匯出 `mergeOptLog(base, opt)`(單次呼叫覆寫建構設定:`logging`/`logDetail` 須布林、`funLog` 須函數,型別錯誤沿用 base);`src/WOrmReladb.mjs`——建構時 `optLog`、`secrets` 具名(`diag` 共用),`genModelsByDB` 以 `mergeOptLog({ ...optLog, logging: opt.logging }, option)` 得 `optLogCall`,建 `diagCall = getDiag(optLogCall, secrets)`,對 `WAutoSequelize` 一律給 `funLog: funLogForAuto`(標籤加前綴 `genModelsByDB `,`bare=true`,`sql` 走 stdout、兩個錯誤標籤走 stderr);JSDoc 補 `option.logging`、`option.logDetail`、`option.funLog`;README 〈Diagnostic output〉增 `genModelsByDB` 列與段落,〈Breaking changes〉改寫,刪〈Not covered〉之 `genModelsByDB` 段。規則見 rulebook R17-7。
- 依賴:`w-auto-sequelize` `^1.0.50` → `^1.0.51`(僅 `npm i` 更新該行與 lock 版本欄位;`version` 未動)。
- 驗證:新測試 `api-diaglog-gen`(25 案,sqlite、不動 docker)、`unit-diaglog` 增 `getDiag 之 method`(5)與 `mergeOptLog`(4)共 9 案;修前(修前 `src/` 快照 + 新測試,補「成功路徑只開 logDetail/funLog 無輸出」1 案前)41 passing / **25 failing**(紅者皆為新行為:承接、單次覆寫、前綴、stderr 串流、`mergeOptLog`、`method`;綠者為回歸守則,如預設無輸出、回傳契約);修後同組 + `api-diaglog`、`unit-urlerr` 共 125 passing / 0 failing;變異 31 個套用、30 殺死、1 存活(W13:`logDetail` 不傳給 w-auto-sequelize——`funLog` 給予時其 `getDiag` 先 return,等價變異)。全套 `npm test` 結果見下方〈最近一次驗證〉。
- 既有測試之被動修改:`test/api-diaglog.test.mjs` 之 `capture` 改包輔助 `test/tools/captureConsole.mjs`(行為相同)。
- 已知差異/限制(文件化):①`logDetail` 之錯誤副本經兩層複製,類別顯示 `Error [SequelizeConnectionError]`(舊版 `ConnectionError […]`);②單次呼叫無法把建構時的 `funLog` 改回無;③`genModelsByDB` 之 `directory`/`database` 取建構時 `opt.fdModels`/`opt.db`(既有行為,未動);④mssql/mysql/postgres 方言未實連(以 sqlite 驗證,診斷邏輯與方言無關);⑤建表清單/外鍵查詢失敗仍「只記錄不 reject」(w-auto-sequelize 契約)。

### R17-6 建構函式 `throwUrlErr`(2026-10-28,reladb-run02)

- 實作:`src/getDiag.mjs` 新增純函數 `maskUrl`(匯出);`src/WOrmReladb.mjs:131` `opt.url[${maskUrl(opt.url)}]`(7 個呼叫點 `:140 :143 :156 :162 :165 :178 :181` 共用 `throwUrlErr`,前綴與 `Error` 型態不變)。回顯規則見 rulebook R17-6(`<scheme>://***@<host[:port]>`;無 `@` 只回 `<scheme>://***`;無 `://` 整段 `***`)。
- 驗證:新測試 `unit-urlerr`(33 案:7 呼叫點共 29 案 + 呼叫點涵蓋 + 合格 url + 孤立代理碼元 + 未捕獲之 stderr)與 `unit-diaglog` 之 `maskUrl` 5 案;修前 `unit-urlerr` 33 案中 30 紅 3 綠(綠者為回歸守則);變異 21/21 殺死、存活 0、未套用 0;全套 `npm test` 6662 passing / 1280 pending / 0 failing。
- 裁示落實:①`throwUrlErr` 已修;②`logging:true` 單獨不印 SQL 全文維持,README 補 before/after 片段;③w-auto-sequelize 由主控另立項目;④`CLAUDE.md` 補句由主控。
- 殘留邊界(文件化):反向筆誤 `host:port@帳號:≤5 位純數字密碼` 的 `@` 後合於主機樣式而被回顯。

### R17 診斷輸出(2026-10-28,reladb-run01)

- 實作:`src/getDiag.mjs`(新;`getOptLog`、`getSecrets`、`maskText`、`cpMask`、`getDiag`、`getBriefErr`、`getSqlStmt`);`src/WOrmReladb.mjs`(`diag`/`logSql` 定義於 URL 解析之後、`emitChange` 之前;13 處 console 站點中 `WOrmReladb.mjs` 10 處、`genModelsByTabs.mjs` 3 處皆改經 `diag`;`logging` 改傳函數,`logQueryParameters:false`);`src/genModelsByTabs.mjs`(第 4 參數 `diag`,由 `WOrmReladb` 之 `genModelsByTabs` 包裝傳入,獨立呼叫時為預設安全出口)。選項 `opt.logDetail`、`opt.funLog`、`opt.logging` 之 JSDoc 在 `WOrmReladb.mjs` 開頭,README 新增〈Diagnostic output〉與〈Breaking changes: diagnostic output〉。
- 驗證:新測試 `unit-diaglog`(28 案)、`api-diaglog`(25 案)修後綠(53/53);修前(`api-diaglog` 首版 20 案對修前 src)16 紅 4 綠(綠者為本就應成立之回歸守則:sqlcipher 提示仍輸出、未開 logging 無輸出、回傳契約、funLog 未被呼叫之空轉案已補計數斷言);變異 55 個全數殺死(含外審 terra 找到之 5 個存活變異,腳本 `tmp/reladb-run01/mutate.mjs` 結案時隨 `./tmp/` 清除,結果見 `C:\opensrcOper\dnow\20261028054319\agent-out\reladb-run01-evidence\`)。全套 `npm test`:第 1 輪 4 紅(2 為 `api-find-whitelist` 之 `logging:true` 預期被刻意改變而修測試、2 為 mssql 巢狀大條件案逾時 15s)、第 2 輪未改碼 6613 綠,最終輪結果見報告。外審 terra(`gpt-6.1-terra`/max)20 條,採納修正者見報告〈外審評分表〉。
- 回傳契約之固定預期值 `test/tools/diagGolden.json` 由**修改前之 git HEAD** 程式執行 `test/tools/diagScenario.mjs` 產生,不得以現行程式重產。
- 既有測試之被動修改:`test/api-find-whitelist.mjs:155`(`logging:true` 單獨不再印 SQL 全文,加 `logDetail:true`)。
- 已知缺口/待辦:
  1. (已修,reladb-run02)`throwUrlErr`(`WOrmReladb.mjs:130-132`)之例外訊息原回顯完整 `opt.url`(含密碼),現經 `maskUrl`(`getDiag.mjs`)回顯 `<scheme>://***@<host[:port]>`;前綴與 `Error` 型態不變;見 R17-6。殘留邊界:反向筆誤 `host:port@帳號:≤5位純數字密碼` 仍被回顯(文件化)。
  2. (已修,reladb-run03)`genModelsByDB`(w-auto-sequelize)之 `console.error(err)` 與預設 SQL logger:w-auto-sequelize 1.0.51 起改單一出口並接受 `logging`/`logDetail`/`funLog`,本套件於 `genModelsByDB` 轉入自身 `diag`;見 R17-7。
  3. `genModelsByTabs.mjs` 之 TEXT 主鍵提示(`getField` 內 `o.type === 'TEXT'`)現況不可達(既有死碼,未動)。
  4. mssql 之 `insert`/`save` 綁定形式與 SQL 全文是否含值,未實測(診斷邏輯與資料庫種類無關;sqlite 已測)。
  5. `CLAUDE.md`〈除錯要點〉補句(`can not import model` 之原錯誤需 `logDetail:true` 才見)**由主控補**(主控裁示 4;本套件不改 `CLAUDE.md`)。
- 最近一次驗證:**2026-10-31 第 213 項,全套 `npm test`(`quiet-run --lock`)6893 passing / 1280 pending / 0 failing,exit 0**(見上〈第 213 項〉段;未發布;其後 reladb2 只動測試與文件,跑受影響 4 檔 539 passing / 0 failing,全套待主控)。前次:2026-10-31 第 210 項,6811 passing / 1280 pending / 0 failing(見〈第 210 項〉段);更前:2026-10-31 第 208/209 項,6727 passing / 1280 pending / 0 failing(見〈第 208 項〉段)。再前:2026-10-29 mig-reladb,6712 passing / 1280 pending / 0 failing,exit 0(見 R17-8 段)。更前:2026-10-28 reladb-run03,全套 `npm test`(`quiet-run --lock`)6695 passing / 1280 pending / 0 failing,exit 0(= reladb-run02 之 6662 + 當時新增 33 案);其後僅於 `test/api-diaglog-gen.test.mjs` 補 1 案(無 src 改動),相關 4 檔(`unit-diaglog`、`api-diaglog-gen`、`api-diaglog`、`unit-urlerr`)重跑 125 passing / 0 failing(未發布;發布版本由主控決定)。

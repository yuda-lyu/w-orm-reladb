# 現況(state)

本檔記當前已開發功能之最新狀態(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本),只記現況、不寫過程(過程見 `sgud/exp/experience.md`)。藍圖(規則)見 `sgud/rule/rulebook.md`。

- 套件版本:`package.json` 1.1.16(reladb-run03〔2026-10-28〕未動 `version`;發布由使用者/主控負責)。依賴 `w-auto-sequelize` `^1.0.51`。
- 本檔於 2026-10-28(reladb-run01)首次建立;更早之功能現況請以 `sgud/rule/rulebook.md` 之 R1–R16 與〈破壞性變更紀錄〉為準。

## 功能現況

| 功能 | 規則帳本 | 測試檔 | 現況 |
|---|---|---|---|
| 條件(find)系列白名單、值檢核、主鍵正規化、scope 合併 | R1–R11、R16 | `unit-cvfind`、`api-find-whitelist`、`api-suite`、`api-scope`、`api-lower-cases` | 完成 |
| 寫入側 DATE 範圍、字串良構、浮動時間 | R12–R14 | `unit-date-write`、`api-date-write`、`unit-wellformed`、`api-wellformed`、`unit-float`、`api-float` | 完成 |
| model 檔載入與發布產物 | R9、R10 | `api-models`、`api-dist`、`api-init` | 完成 |
| **診斷輸出之單一出口與預設安全(reladb-run01)、建構函式 opt.url 例外不回顯帳密(reladb-run02)、`genModelsByDB` 診斷輸出接上單一出口(reladb-run03)** | R17(含 R17-6、R17-7) | `unit-diaglog`、`api-diaglog`、`api-diaglog-gen`、`unit-urlerr` | 完成(見下) |

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
- 最近一次驗證:2026-10-28 reladb-run03,全套 `npm test`(`quiet-run --lock`)6695 passing / 1280 pending / 0 failing,exit 0(= reladb-run02 之 6662 + 當時新增 33 案);其後僅於 `test/api-diaglog-gen.test.mjs` 補 1 案(無 src 改動),相關 4 檔(`unit-diaglog`、`api-diaglog-gen`、`api-diaglog`、`unit-urlerr`)重跑 125 passing / 0 failing(未發布;發布版本由主控決定)。

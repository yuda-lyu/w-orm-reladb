# 回饋(feedback)

任務中發現之自有套件、全域技能、全域設定之調整與抽提提案(全域設定 §12.2)。只增不改;處置結果另記一列。僅為紀錄與提案,不等於已修改他套件。

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-09 | 自有套件 | wsemi(`src/_diagCodes.mjs` 之 `mssql` 錯誤碼清單) | 清單缺 tedious 之 `EENCRYPT`(20.3.7 起伺服器不協商加密時之連線錯誤碼)、`EFEDAUTH`、`ECLOSE`,致 `getDiag` 之診斷摘要對此類連線失敗不含 `errCode`(只有 `errType`),使用端只靠摘要無從區分「伺服器不協商加密」與其他連線失敗。建議補入該清單(碼為固定識別字,不含個資) | `node_modules/wsemi/src/_diagCodes.mjs:73-74`(清單);`node_modules/tedious/lib` 內 `ConnectionError(…, 'EENCRYPT'/'EFEDAUTH'/'ECLOSE')`;`funLog` 實測:tedious 19.2.2 之 ESOCKET 摘要為 `{ cl, errType, errCode: 'ESOCKET' }`,tedious 20.3.8 之 EENCRYPT 摘要為 `{ cl, errType }`(R21 已知限制②) |

# M2b 審查(M2c)

- 審查人:vault keeper
- 日期:2026-11-21
- 範圍:`src/main/vault/*`、`src/shared/heat.ts`、`src/shared/types.ts`、`src/shared/ipc.ts`、`src/main/ipc-handlers.ts`、`src/main/index.ts`、`src/preload/index.ts`、`tests/vault.contract.test.ts`、`frontmatter.test.ts`、`heat.test.ts`、`fixtures/`
- 驗證:`npm run typecheck` 通過;`vitest run` 6 檔 23 項全過(本人重跑)
- 對照:主控台 `vault-stats.ts`(`buildVaultStats`)、`vault-sidecar.ts`(熱度格式)、`memory-archive.ts`(`attachArchive`)、`memory-write.ts`(`## 主控台補充(時間)`)、`cases.ts`(`節點ID`、`參與節點ID`)

## 結論:需修正(1 項必修)

完成條件逐項都有測試覆蓋,資料格式與主控台實際輸出一致(`協作.最後`、`專案` 字串陣列、`session.可接回`、熱度 `召回次數/最後召回`)。IPC 邊界沒有越權:介面傳入的路徑只在索引裡查詢,不直接開檔;呼叫來源有驗證;圖片協定目前一律 404。

必修項修完後只需重審該項,不必全面重審。

## 必修

### R1 統計檔:單一節點或單筆連線不合格,就整份作廢

- 位置:`sidecars.ts` 的 `decodeStats`、`decodeStatsNode`、`decodeActivity`
- 問題:任何一個節點的欄位不合格(例如 `任務數` 不是整數、`完成率` 大於 1),或一筆 `協作` 少了欄位,就整份回傳 `undefined`。沒有上一份可用時,所有水晶都失去統計與「可喚醒」。
- 會發生:主控台封存節點的統計數字是從封存檔的屬性讀回來的(`readArchives` 的 `num()`),使用者在這個 App(M4)或一般編輯器裡改了封存檔的 `任務數: 3.5`、`完成率: 75`,下一輪的 `.nexus-stats.json` 就會帶著這個值,整份統計從此讀不到。
- 要求:
  1. 只有「JSON 解析失敗」或「最外層結構不對」(`節點` 不是物件、`協作`/`同席` 不是陣列、`更新時間` 不是時間)才算損毀、保留上一份。
  2. 單一節點不合格:略過該節點(或把不合格的數字欄位當 0、`完成率` 當 null),其他節點照常採用。
  3. 單筆 `協作`/`同席` 不合格:略過該筆。
  4. 補測試:一份統計檔裡一個節點 `完成率: 75`、一筆協作缺 `次數`,其餘節點與連線仍被採用,且 `stats` 不是上一份。

## 建議(可以排進 M3/M4,不擋 M2 驗收)

| # | 位置 | 建議 |
|---|---|---|
| S1 | `sidecars.ts` `decodeHeat` | 同 R1 的原則:單筆不合格略過,不要整份作廢。主控台寫入時會清理,所以風險低,一起改比較一致。 |
| S2 | `index.ts` `VaultReader` | 每一次 IPC(含 `readEntry`)都重新掃描、解析整個記憶庫。M3 介面會頻繁呼叫,請在 M3 前改成「快取快照,收到資料夾監看通知才失效」(`watch.ts`)。 |
| S3 | `scan.ts` `readMemoryFile` | 讀取期間 mtime 或大小改變就回傳 null,這筆記憶在這一輪會「消失」,介面可能誤以為被刪除。建議短暫重試一次,仍不穩定才略過。 |
| S4 | `frontmatter.ts`(M4 前提) | 解析是有損的(註解、縮排的巢狀行、引號樣式不保留)。M4 寫回時**不可**用 `attributes` 重新序列化整個檔頭;改狀態要直接改原始文字中 `狀態:` 那一行(沒有就在結尾分隔線前插入),其餘位元組原樣保留。這條會寫進 `docs/架構.md`。 |
| S5 | `index.ts` `entryDetail` | `Object.fromEntries(attributes)` 遇到像數字的鍵(例如 `2026: x`)會被 JS 重新排序。若介面要照檔案順序顯示屬性,改傳 `[鍵, 值][]`。 |
| S6 | `entry.ts` `nodeId` | 沒有 `節點ID` 時退回 `節點`/`承辦節點` 的顯示名稱(例如「Hagemi(Antigravity · …)」),同一欄位混了 ID 與名稱,會讓依節點篩選對不上。建議 `nodeId` 只放 ID,名稱另放 `nodeLabel`。目前主控台的新判例都有 `節點ID`,只影響舊檔。 |
| S7 | `entry.ts` `summary` | 只有判例有 `摘要:` 行。卡片需要摘要時,其他種類建議退回「正文第一個非標題段落的前 80 字」。 |
| S8 | `index.ts` `search` | 搜尋目前只看標題、案號、正文。建議加入 `關鍵字`、`案由` 屬性。 |
| S9 | `ipc-handlers.ts` 來源檢查 | `frame.url !== appUrl` 是完全比對;M3 若用 hash 路由或查詢參數,所有 IPC 都會被拒。建議改比對 origin 與路徑。 |

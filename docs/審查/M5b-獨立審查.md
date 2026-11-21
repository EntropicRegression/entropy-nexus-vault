# M5b 獨立審查(樓層切換與跳轉)

- 審查者:claudia jr(主控台 repo 的實作者;不參與寶庫實作)
- 日期:2026-11-22
- 對象:工作區未提交的變更(HEAD `03b97ee`),共 21 個修改檔與 7 個新檔。
- 方式:唯讀。沒有開視窗,沒有修改任何檔案,只新增本文件。另外做了兩項驗證,都沒有寫進 repo:
  - `npx vitest run src/renderer/app src/renderer/sky src/renderer/library`:7 檔 61 項全部通過,輸出裡沒有任何 `act(...)` 警告。
  - 用 `electron-vite build --outDir <暫存資料夾>` 分別建置正式版與 development 版,檢查產物。建置後暫存資料夾已刪除,`out/` 沒有被動到。

## 結論:通過,沒有必修;有 7 項建議

- **動畫曲線**:完全符合 `DESIGN.md` §8,包括緩動、只模糊 Y 軸、傾斜正負號、視差、45% 換頂列。
- **攝影機驅動器**:清理正確,結束時一定移除 filter 與傾斜。
- **狀態機**:連點跳終態、已在該層不重播,都有測試保護。
- **跳轉請求**:每個請求只執行一次,而且在抵達後才執行。
- **驗收用時鐘**:我實際建置驗證過,正式版不含 `createAcceptanceClock` 與 `__floorClock`,development 版才有(見 V1)。
- **`searchNodes`**:經過 IPC 出口的遮罩,比對範圍與主控台的側寫格式一致。

建議裡最值得處理的是 S1(跳轉後的焦點落點)與 S2(動畫中的點選被跳轉請求蓋掉)。

---

## 一、已驗證沒有問題的部分

| 項目 | 依據 |
|---|---|
| 曲線 | `floor-camera.ts:21-41`:980ms、`4t³ / 1−(−2t+2)³/2`、`blurY = 14·sin(πt)`、`stdDeviation="0 Y"`(只有 Y 軸,`:63`)、傾斜上樓為正、下樓為負、45% 時 `swapped` 為真。端點速度為 0,`t` 有夾在 0–1 之間。測試 `floor-camera.test.ts:17-52` 逐點比對。 |
| 視差 | 樓下背景 `(1 − offset) × 35px`,等於規格的 `(y+100) × 0.35px`,到樓上時 35px。`.libraryBackground` 上下各外擴 40px,不會露邊。星點反向 24px 是規格修訂後的新內容,已寫進 §8。 |
| 終態 | `restingFrame` 把模糊、傾斜、兩層位移都歸零;`applyFloorFrame` 在 `blurY` 為 0 時把 `filter` 設成空字串(`:61`)、背景 `transform` 設成空字串(`:64-65`),不會殘留。 |
| 連點與重入 | `start()` 在執行中、低動態或已停在該層時,一律直接呼叫 `finish(to)`,只套用終態、不留排程(`manual.count()` 為 0 有測試)。`finish` 在還沒換頂列時會補換一次。App 端在已停在該層時根本不會呼叫 `start`(`App.tsx:103`)。 |
| 清理 | 卸載時 `useLayoutEffect` 的 cleanup 會呼叫 `camera.cancel()`。StrictMode 下會先 cancel 再 rest,攝影機物件存在 ref 裡,不會重建。`cancel()` 不還原 DOM,但只在卸載時用,元素已經不在,沒有影響。 |
| rAF 備援 | 沿用 M5a 的 `browserFrameClock`(負數 id 的計時器、取消時清掉)。時鐘可以注入。 |
| 頂列 | 兩條頂列都在世界外、絕對定位;45% 時直接改 DOM(`data-topbar`、`inert`),不經過 React 重繪。隱藏的那條 `inert` 加 `pointer-events: none`。 |
| `transition: all` | `src/renderer` 底下的 CSS 已經沒有任何 `transition: all`。剩下的 `transition` 都明確列出屬性,沒有一條包含 `visibility`;樓層區塊用 `visibility: hidden` 切換,沒有過渡。修正是徹底的。 |
| 閱讀桌在切換開始時關閉 | `go()` 會立刻呼叫 `setFloor`,`Library` 的 `active` 變成 false,effect 就關閉閱讀桌與前版浮層(`Library.tsx` 新增的 effect)。測試 `App.test.tsx`「切換前先關閉閱讀桌」有涵蓋。 |
| 跳轉請求只用一次 | `arrival` ref 每次 `go()` 都會覆寫;沒有帶動作的 `go()` 會清掉它,所以動畫中改按頂列,舊的跳轉不會執行。`Sky` 與 `Library` 端各用 `consumed*` 集合依 `requestId` 去重。 |
| aria-live | `App.tsx:199` 的 polite 播報「前往樓上星象台 / 回到樓下典藏室」,測試有比對。 |
| `searchNodes` 的隱私 | 經過 `register()` 統一的 `redactForRenderer`。回傳只有 `nodeId`、`name`、`role`、`status`、`matchedIn`、`avatarUrl`(`vault-image://` 代號網址),不帶正文。`vault.contract.test.ts` 把 `nodeHits` 放進隱私快照一起掃描。 |
| `searchNodes` 不搜回顧 | `ParsedEntry.body` 本來就已經把 `## 回顧` 切出去(`entry.ts:57-69`),測試有「回顧專屬詞」的反例。 |

---

## 二、驗收用時鐘(安全面)

### V1 正式版不含驗收時鐘:已實際驗證(通過,另有 1 項建議)

- 追蹤到的路徑:
  - `main.tsx:9` 靜態匯入 `createAcceptanceClock`。
  - `main.tsx:15` 用 `if (import.meta.env.MODE === 'development')` 包住建立時鐘和 `window.__floorClock` 的掛載。
  - `accept-clock.ts` 沒有其他匯入者;測試用的是另一支 `test-support/manual-clock.ts`。
- 建置設定:
  - `npm run build` 是 `electron-vite build`,模式為 production。
  - `npm run dist` 先跑 `build` 再跑 `electron-builder`。
  - `npm run dev` 是 `electron-vite build --mode development && electron-vite preview`。
- 實測結果:
  - 正式版建置後,`__floorClock` 和 `createAcceptanceClock` 在整個產物裡出現 **0 次**。Vite 把 `import.meta.env.MODE` 靜態換成字串,整段變成死碼,匯入也被搖樹移除。
  - development 版建置後出現 1 次,符合預期。
- 使用者無法觸發:沒有 URL 參數、沒有 IPC、沒有設定可以打開它。只有 development 建置的視窗,在主世界有一個 `window.__floorClock`,作用只是凍結或設定動畫時間,沒有讀檔或寫檔的能力。
- **S7(建議)**:`dev` 與 `build` 輸出到同一個 `out/`。如果有人先跑 `npm run dev`,再直接執行 `electron-builder`(繞過 `dist`),就會把 development 產物打包進安裝檔,內含 `__floorClock`,主程序也是開發行為。修法擇一:
  - `dev` 改用獨立的 `--outDir`。
  - 在 `electron-builder` 的 `beforeBuild` 或 `dist` 腳本裡,檢查產物不含 `__floorClock`。
  - 或加一支建置後的檢查測試。

---

## 三、建議

### S1 從頭像章、節點名稱、相符節點跳上樓後,焦點應該落在選中的水晶(建議,高優先)

- 位置:`App.tsx:92-98`(先把焦點給 `firstControl` 再執行 `pending.run()`)、`App.tsx:18-23`。
- 情境:鍵盤或螢幕閱讀器使用者在樓下對「節點 X」按 Enter,目的地是 X 的履歷。抵達後焦點卻停在「━ 經驗傳承」連線開關,要再自己找 X 的水晶或履歷欄。這不符合「焦點跟著動作的目標走」(WCAG 2.4.3)。
- 樓下開卷沒有這個問題:閱讀桌會自己取得焦點。
- 我的評估是應該改:
  - 帶有跳轉目標時,`Sky` 處理完 `selectionRequest` 之後,把焦點移到 `button[data-crystal="<id>"]`,或履歷欄的標題。
  - 一般的樓層切換,維持 §8 規定的第一個連線開關。
  - `DESIGN.md` §8 的焦點規則補上這個例外。
  - 補一個測試:從相符節點跳轉後,`document.activeElement` 是那顆水晶的按鈕。

### S2 動畫中在樓上點了別的水晶,抵達時會被跳轉請求蓋掉(建議)

- 位置:`App.tsx:120-122`、`Sky.tsx`(`selectionRequest` 的 effect)。
- 情境:
  1. 從樓下頭像章跳往 A。
  2. 980ms 的平移期間,樓上已經可以操作(`floor` 一開始就是 `sky`,`inert` 已解除),使用者點了水晶 B。
  3. 抵達時 `pending.run()` 送出 A 的請求,選取從 B 跳回 A,使用者的明確操作被覆蓋。
- 修法擇一:
  - 平移期間對兩層都加 `inert`。
  - 或樓上在平移期間收到使用者選取時,清掉 `arrival` 裡的請求。

### S3 跳轉目標找不到時沒有任何回饋(建議)

- 位置:`Sky.tsx`(`selectionRequest` 不在 `data.crystals` 裡時會靜默消耗)、`Library.tsx`(`openRequest` 的路徑不在 `allEntries` 時也一樣)。
- 情境:頭像章指向的節點已經不在統計和封存裡(§5.6.1 規定這種要畫虛線、不可點,但相符節點與關聯卷宗沒有這層保護),或卷宗在跳轉途中被移入回收。使用者到了樓上或樓下什麼都沒發生,也沒有說明。
- 修法建議:找不到時用提示條或 `aria-live` 說「找不到這個節點(或卷宗),可能已被移除」。

### S4 「未退回率」的分子分母混了不同性質的任務(建議)

- 位置:`crystals.ts:41-43`。
- 這是主控台端的事實:`退回數` 計的是所有被標成退回的任務,包含使用者手動把**失敗或中斷**的任務標成退回;`完成數` 只計正常完成的任務。所以 `1 − 退回 ÷ 完成` 會被失敗任務上的退回壓低,極端時會被 `Math.max(0, …)` 夾到 0。
- 修法建議:
  - 懸停說明補一句「退回也包含失敗任務上的退回」。
  - 或請主控台在 stats 另外提供「完成且退回」的數字。後者需要主控台改程式,可以另外排。

### S5 `searchNodes` 每次查詢都重新解析所有側寫(建議)

- 位置:`vault/index.ts` 的 `searchNodes`。
- 情境:每次按鍵(去抖 120ms)都會對每個節點重跑 `profileHighlights`(切章節),再把整份側寫正文轉小寫。目前節點數很少,沒有問題;節點破百、側寫又長時,每次查詢會在主程序做幾 MB 的字串處理。另外 IPC 端每筆命中都會呼叫 `avatarUrl`(多次 `realpath`/`lstat`),最多 50 筆。
- 修法建議:在 `VaultSnapshot` 建立時預先算好每個節點的小寫欄位;`avatarUrl` 的結果依快照快取。

### S6 主控台的「角色」是立繪資料夾名稱,不是職稱(建議,只需文件說明)

- 這是主控台端的事實:`.nexus-stats.json` 的 `角色` 和側寫的 `角色` 屬性,都是主控台的**立繪角色資料夾名稱**(例如 `claude`、`gemini`),沒有角色時是 `null` 或 `(無)`。它不是「研究員」「審查者」這類職稱。
- 影響:搜尋「審查」不會因為職稱命中;`matchedIn: '角色'` 實際上表示「立繪角色名稱符合」。行為本身是對的,但 §6.6.3 的「比對角色」容易讓人以為能搜職稱。
- 修法建議:在 §6.6.3 註明「角色 = 主控台的立繪角色名稱」。
- 補充:特長的擷取規則(`## 特長` 第一段第一句)和主控台的慣例一致,總管守則也只取第一行;使用者改過的側寫,新特長會在「主控台補充」段裡,`searchNodes` 仍然能以「側寫」命中,不會漏。

---

## 四、測試

| # | 項目 | 說明 |
|---|---|---|
| T1 | 斷言強度 | `floor-camera.test.ts` 逐點比對數值、DOM 字串和排程數;`App.test.tsx` 逐步檢查 transform、filter、`stdDeviation`、頂列、`inert`、焦點和播報,斷言具體。連點測試連按 5 次,確認不重播、不留排程。 |
| T2 | act 警告 | 實跑 61 項,沒有任何 `act(...)` 警告。`IS_REACT_ACT_ENVIRONMENT` 只在測試內 stub,沒有被用來隱藏警告。 |
| T3 | 缺少的案例 | • S1:跳轉後的焦點目標。<br>• S2:平移中點選水晶後抵達。<br>• S3:跳轉目標不存在。<br>• 低動態下的跳轉(`go` 走 quiet 分支時,請求仍在抵達後執行)。<br>• 跳上樓時水晶資料還沒載入完:請求要等 `data` 到了才選取,這是程式的現況,但沒有測試保護。 |

---

## 五、對 vault keeper 回報事項的評估

- **焦點落在第一個連線開關**:不合理,應該改,見 S1。
- **`transition: all` 造成 visibility 過渡的修正**:合理,而且已經徹底,沒有剩下同類寫法。
- **`starWarp`(星點拉長下流)沒做,列為選配**:合理。純視覺效果;§8 已經改寫成選配,視差已經提供了兩層速度不同的動感。

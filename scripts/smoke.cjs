const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { readFileSync, realpathSync } = require('node:fs');
const { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const repo = resolve(__dirname, '..');
const entry = join(repo, 'out-dev', 'main', 'index.js');
const prefix = 'entropy-vault-smoke-';
const casePath = 'cases/月汐溫室/2026-0002-日報按採樣日期歸檔.md';
const caseTitle = '日報按採樣日期歸檔';
const card = '[data-entry=' + JSON.stringify(casePath) + ']';
const desk = '[aria-label="閱讀桌"]';
const search = '[aria-label="搜尋卷宗"]';

function verifiedScratch(path) {
  const folder = realpathSync(path);
  assert.equal(dirname(folder), realpathSync(tmpdir()), '驗收目錄必須在系統暫存之下');
  assert.ok(basename(folder).startsWith(prefix), '驗收目錄名稱不正確');
  return folder;
}

async function waitFor(check, description) {
  const deadline = Date.now() + 8_000;
  do {
    const result = await check();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error('等候逾時，未看到' + description);
}

function runElectron(root) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [__filename, root], { cwd: repo, env, stdio: 'inherit' });
    let stopped;
    function stop(reason) {
      if (!child.pid || stopped || child.exitCode !== null || child.signalCode !== null) return;
      stopped = reason;
      if (process.platform === 'win32') {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
          if (error && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        });
      } else child.kill('SIGKILL');
    }
    const interrupt = () => stop('驗收已中斷');
    const timeout = setTimeout(() => stop('Electron 超過 90 秒未結束'), 90_000);
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      if (stopped || signal) reject(new Error(stopped || 'Electron 被中斷：' + signal));
      else resolve(code === 0);
    });
  });
}

async function launch() {
  try {
    await Promise.all([entry, join(repo, 'out-dev', 'preload', 'index.js'), join(repo, 'out-dev', 'renderer', 'index.html')].map((file) => stat(file)));
  } catch {
    throw new Error('開發版尚未建置。先執行 npm run build:dev，再執行 npm run smoke。');
  }
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    const vault = join(root, 'memory-vault');
    const userData = join(root, 'user-data');
    await mkdir(userData);
    await mkdir(join(root, 'empty-app'));
    await cp(join(repo, 'fixtures', 'memory-vault'), vault, { recursive: true });
    await writeFile(join(userData, 'settings.dev.json'), JSON.stringify({ vaultPath: vault, reducedMotion: true }));
    console.log('冒煙驗收開始。將開啟 Electron 視窗並操作合成記憶庫複本。');
    process.exitCode = await runElectron(root) ? 0 : 1;
  } finally {
    await rm(verifiedScratch(root), { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    console.log('已清理暫存記憶庫與使用者設定。');
  }
}

async function exercise(root) {
  const { app, BrowserWindow } = require('electron');
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => {
    errors.push('主程序：' + args.map(String).join(' '));
    previousError(...args);
  };
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', ({ level, message }) => {
      if (level === 'error') errors.push('介面：' + message);
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) errors.push('頁面載入：' + description + ' (' + code + ')');
    });
    contents.on('render-process-gone', (_event, { reason }) => errors.push('介面程序結束：' + reason));
  });
  const recordRejection = (error) => errors.push('主程序：' + String(error));
  process.on('unhandledRejection', recordRejection);

  let step = '啟動 Electron 並確認使用隔離設定';
  async function check(title, action) {
    step = title;
    const result = await action();
    console.log('通過  ' + title);
    return result;
  }

  let success = true;
  try {
    const scratch = verifiedScratch(root);
    const vault = join(scratch, 'memory-vault');
    const userData = join(scratch, 'user-data');
    app.setPath('appData', scratch);
    app.setPath('userData', userData);
    app.setPath('sessionData', userData);
    // If the isolated settings fail to load, the app finds an empty fallback inside the scratch directory.
    app.setAppPath(join(scratch, 'empty-app'));
    assert.equal(app.isPackaged, false, '冒煙只使用開發版');
    const staged = JSON.parse(readFileSync(join(userData, 'settings.dev.json'), 'utf8'));
    assert.equal(realpathSync(staged.vaultPath), realpathSync(vault));
    assert.ok(!staged.brandPortraitPath);
    require(entry);

    const contents = await check(step, async () => {
      const window = await waitFor(() => BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL() === 'vault-app://app/index.html' && !win.webContents.isLoadingMainFrame()), '寶庫視窗載入');
      const info = await window.webContents.executeJavaScript('window.vault.getVaultInfo()');
      assert.equal(info.exists && info.path, '自訂記憶庫', '未使用暫存記憶庫');
      assert.deepEqual(errors, [], '啟動出現錯誤');
      window.focus();
      return window.webContents;
    });

    const js = (expression) => contents.executeJavaScript(expression);
    const exists = (selector) => 'document.querySelector(' + JSON.stringify(selector) + ')';
    const visible = (selector) => 'Boolean(' + exists(selector) + ')';
    const wait = (expression, description) => waitFor(() => js(expression), description);
    const click = (selector) => js('(() => { const button = ' + exists(selector) +
      '; if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error("按鈕無法操作"); button.click(); })()');
    async function clickLabel(scope, label) {
      const selector = scope + ' button';
      const pressed = await js('(() => { const button = [...document.querySelectorAll(' + JSON.stringify(selector) +
        ')].find((item) => item.textContent.trim() === ' + JSON.stringify(label) +
        '); if (!button || button.disabled) return false; button.click(); return true; })()');
      assert.equal(pressed, true, '找不到可操作的按鈕「' + label + '」');
    }
    async function setSearch(value) {
      await js('(() => { const field = ' + exists(search) +
        '; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ' + JSON.stringify(value) +
        '); field.dispatchEvent(new Event("input", { bubbles: true })); })()');
    }
    function escape() {
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    }
    async function openCase() {
      await click(card + ' [data-entry-title]');
      await wait(exists(desk + ' h2') + '?.textContent === ' + JSON.stringify(caseTitle), '指定卷宗的閱讀桌');
    }
    const originalFile = join(vault, casePath);
    const recycledFile = join(vault, '_回收', casePath);
    const tryRead = (file) => readFile(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });

    await check('樓下載入卷宗與待核閱案頭', async () => {
      await wait(visible(card) + ' && ' + visible('#draft-board'), '藏書架與待核閱案頭');
    });
    await check('書籤頁籤與搜尋可用', async () => {
      await clickLabel('[aria-label="卷宗類別"]', '書籤');
      await wait(visible('[data-entry] [data-shelf="bookmark"]') + ' && !' + visible(card), '書籤篩選結果');
      await clickLabel('[aria-label="卷宗類別"]', '全部');
      await wait(visible(card), '全部卷宗');
      const count = 'document.querySelectorAll("[data-entry]").length';
      assert.ok(await js(count) > 1, '搜尋之前應有多份卷宗');
      await setSearch(caseTitle);
      await wait(visible(card) + ' && ' + count + ' === 1', '唯一一份符合標題的卷宗');
      await setSearch('');
      await wait(count + ' > 1', '清除搜尋後的卷宗');
    });
    await check('開啟閱讀桌並以 Esc 關閉', async () => {
      await openCase();
      escape();
      await wait('!' + visible(desk), '閱讀桌關閉');
    });
    let confirmed;
    await check('確認待核閱卷宗，檔案只改狀態行', async () => {
      const before = await readFile(originalFile);
      const draft = before.toString('utf8');
      assert.equal((draft.match(/^狀態: 未確認(?=\r?$)/gm) || []).length, 1);
      confirmed = Buffer.from(draft.replace(/^狀態: 未確認(?=\r?$)/m, '狀態: 已確認'));
      await openCase();
      await click(desk + ' [data-write-action="已確認"]');
      await wait(exists(desk) + '?.textContent.includes("已儲存：已收錄")', '畫面顯示確認成功');
      assert.deepEqual(await readFile(originalFile), confirmed, '寫入後檔案的位元組與預期不同');
    });
    await check('移入回收並撤銷，檔案回到原位', async () => {
      await click(desk + ' [data-write-action="recycle"]');
      const notice = '[data-write-notice]';
      await wait('!' + visible(desk) + ' && ' + exists(notice + ' button') + '?.textContent.trim() === "撤銷"', '回收成功與撤銷按鈕');
      assert.equal(await tryRead(originalFile), null, '原路徑還有卷宗');
      assert.deepEqual(await readFile(recycledFile), confirmed);
      await clickLabel(notice, '撤銷');
      await wait(visible(card), '還原後的卷宗');
      assert.deepEqual(await readFile(originalFile), confirmed);
      assert.equal(await tryRead(recycledFile), null, '回收區仍留有卷宗');
    });
    const sky = '[aria-label="樓上星象召喚盤"][data-shown="true"]';
    const crystal = sky + ' [data-crystal="fixture-node-heron"]';
    const detail = '[data-sky-detail][data-collapsed="false"]';
    await check('切到樓上並載入水晶', async () => {
      await clickLabel('[aria-label="樓層切換"]', '樓上｜星象召喚盤');
      await wait(visible(crystal), '樓上水晶');
    });
    await check('選中水晶並展開節點履歷', async () => {
      await click(crystal);
      await wait(exists(detail) + '?.textContent.includes("紙鷺")', '紙鷺的履歷');
    });
    await check('開啟和關閉節點側寫全文', async () => {
      const reader = '[data-profile-mode="read"]';
      await wait(visible(detail + ' [data-read-full]'), '履歷欄的閱讀全文按鈕');
      await click(detail + ' [data-read-full]');
      await wait(exists(reader + ' [data-profile-body]') + '?.textContent.includes("把按測點整理的讀值")', '完整側寫正文');
      await clickLabel(reader, '關閉(Esc)');
      await wait('!' + visible(reader), '關閉側寫全文');
    });
    await check('回到樓下典藏室', async () => {
      await clickLabel(sky, '▼ 向下俯視，回到大圖書館判例卷宗室 ▼');
      await wait(visible('[aria-label="樓下典藏室"][data-shown="true"] ' + card), '重新顯示樓下卷宗');
    });
  } catch (error) {
    success = false;
    previousError('失敗  ' + step + '：' + error.message);
  } finally {
    if (errors.length) {
      success = false;
      previousError('失敗  檢查主程序與介面錯誤');
      for (const error of errors) previousError('      ' + error);
    } else console.log('通過  全程無主程序或介面錯誤');
    console.error = previousError;
    process.off('unhandledRejection', recordRejection);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    console.log('已關閉驗收視窗，結束 Electron 程序。');
    app.exit(success ? 0 : 1);
  }
}

const running = process.versions.electron ? exercise(process.argv[2]) : launch();
running.catch((error) => {
  console.error('失敗  驗收環境或清理：' + error.message);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});

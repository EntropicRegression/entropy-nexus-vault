import { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeCrystal, VaultInfo, ViewSettings } from '../../shared/types';
import { Library } from '../library/Library';
import { useDelayed } from '../library/use-delayed';
import styles from './App.module.css';

type Floor = 'library' | 'sky';
const defaults: ViewSettings = { deskMode: 'A', reducedMotion: false };

export function App() {
  const [floor, setFloor] = useState<Floor>('library');
  const [node, setNode] = useState<NodeCrystal | null>(null);
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [vaultError, setVaultError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(defaults);
  const [saving, setSaving] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const up = useRef<HTMLButtonElement>(null);
  const showLoading = useDelayed(!vaultInfo && !vaultError ? 'vault' : null);

  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    let current = true;
    void window.vault.getVaultInfo().then(
      (info) => { if (current) { setVaultInfo(info); setVaultError(''); } },
      () => { if (current) setVaultError('無法讀取記憶庫資訊。'); },
    );
    return () => { current = false; };
  }, [attempt]);

  useEffect(() => {
    let current = true;
    void window.vault.getSettings().then(
      (saved) => { if (current) { setSettings(saved); setSettingsReady(true); } },
      () => { if (current) { setSettingsError('無法讀取介面設定。'); setSettingsReady(true); } },
    );
    return () => { current = false; };
  }, []);

  async function chooseVault() {
    setChoosing(true);
    try {
      const info = await window.vault.chooseVault();
      if (info) {
        setQuery('');
        setVaultInfo(info);
        setVaultError('');
      }
    } catch {
      setVaultError('無法開啟記憶庫資料夾。');
    } finally {
      setChoosing(false);
    }
  }

  async function updateSettings(patch: Partial<ViewSettings>) {
    if (!settingsReady || saving) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSettingsError('');
    setSaving(true);
    try {
      setSettings(await window.vault.setSettings(patch));
    } catch {
      setSettings(previous);
      setSettingsError('介面設定未儲存。');
    } finally {
      setSaving(false);
    }
  }

  function toggleDesk() {
    void updateSettings({ deskMode: settings.deskMode === 'A' ? 'B' : 'A' });
  }

  const openNode = useCallback((selected: NodeCrystal) => {
    setNode(selected);
    setFloor('sky');
    up.current?.focus();
  }, []);

  return <div className={styles.shell} data-floor={floor} data-reduced-motion={settings.reducedMotion}>
    <header className={styles.topBar}>
      <h1>記憶寶庫</h1>
      <div role="group" aria-label="樓層切換" className={styles.modeSwitch}>
        <button type="button" aria-pressed={floor === 'library'} onClick={() => setFloor('library')}>樓下｜典藏室</button>
        <button type="button" aria-pressed={floor === 'sky'} ref={up}
          onClick={() => { setNode(null); setFloor('sky'); }}>樓上｜星象召喚盤</button>
      </div>
      <div className={styles.tools}>
        {floor === 'library' && <>
          <input type="search" aria-label="搜尋卷宗" placeholder="檢索案號、題名或節點…" value={query}
            onChange={(event) => setQuery(event.target.value)} disabled={!vaultInfo?.exists} />
          <button type="button" disabled={!settingsReady || saving} onClick={toggleDesk}>
            版式：{settings.deskMode === 'A' ? 'A 寬幅閱讀桌' : 'B 右側 420px 欄'}
          </button>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>重新整理</button>
        </>}
        <button type="button" aria-pressed={settings.reducedMotion} disabled={!settingsReady || saving}
          onClick={() => void updateSettings({ reducedMotion: !settings.reducedMotion })}>低動態：{settings.reducedMotion ? '開' : '關'}</button>
        <button type="button" disabled={choosing} onClick={() => void chooseVault()} title={vaultInfo?.path}>記憶庫位置</button>
      </div>
    </header>
    <main className={styles.stage}>
      {(settingsError || (vaultInfo?.exists && vaultError)) &&
        <p className={styles.settingError} role="alert">{settingsError || vaultError}</p>}
      {floor === 'sky' && <section className={styles.center}>
        <h2>星象召喚盤</h2>
        {node && <p>{node.name}</p>}
        <p>節點星圖將於 M5 開放。</p>
      </section>}
      <div className={styles.downstairs} hidden={floor !== 'library'}>
        {showLoading && <p className={styles.center} role="status">正在翻閱…</p>}
        {!vaultInfo?.exists && (vaultError || vaultInfo) && <section className={styles.center}>
          <div className={styles.recoveryPaper}>
            {vaultError ? <p role="alert">{vaultError}</p> : <h2>找不到記憶庫資料夾</h2>}
            {vaultInfo && <p className={styles.path}>{vaultInfo.path}</p>}
            <div className={styles.recovery}>
              <button type="button" disabled={choosing} onClick={() => void chooseVault()}>選擇資料夾…</button>
              <button type="button" onClick={() => { setVaultError(''); setAttempt((value) => value + 1); }}>重新偵測</button>
            </div>
          </div>
        </section>}
        {vaultInfo?.exists && <Library key={vaultInfo.key} query={query} deskMode={settings.deskMode} refreshToken={attempt}
          onToggleMode={toggleDesk} onNode={openNode} active={floor === 'library'} />}
      </div>
    </main>
  </div>;
}

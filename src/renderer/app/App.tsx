import { useEffect, useState } from 'react';
import type { VaultInfo } from '../../shared/types';
import styles from './App.module.css';

type Mode = 'library' | 'sky';

export function App() {
  const [mode, setMode] = useState<Mode>('library');
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [choosingVault, setChoosingVault] = useState(false);

  useEffect(() => {
    let active = true;
    void window.vault.getVaultInfo().then(
      (info) => { if (active) setVaultInfo(info); },
      () => { if (active) setVaultError('無法讀取記憶庫位置'); },
    );
    return () => { active = false; };
  }, []);

  async function chooseVault(): Promise<void> {
    setChoosingVault(true);
    try {
      const info = await window.vault.chooseVault();
      if (info) {
        setVaultInfo(info);
        setVaultError(null);
      }
    } catch {
      setVaultError('無法開啟選擇的記憶庫');
    } finally {
      setChoosingVault(false);
    }
  }

  const modeTitle = mode === 'library' ? '判例室' : '節點休眠庫';

  return (
    <div className={styles.shell} data-mode={mode}>
      <header className={styles.topBar}>
        <span className={styles.wordmark}>ENTROPY NEXUS · ARCHIVE</span>
        <div role="group" aria-label="切換寶庫樓層" className={styles.modeSwitch}>
          <button type="button" aria-pressed={mode === 'sky'} onClick={() => setMode('sky')}>
            <span aria-hidden="true">✦</span> 仰望星圖 <span className={styles.modeName}>休眠庫</span>
          </button>
          <button type="button" aria-pressed={mode === 'library'} onClick={() => setMode('library')}>
            <span aria-hidden="true">◈</span> 俯瞰圖書館 <span className={styles.modeName}>判例室</span>
          </button>
        </div>
        <div className={styles.tools}>
          <input type="search" aria-label="全文搜尋" placeholder="搜尋標題、內文、案號…" disabled />
          <button
            type="button"
            className={styles.vaultButton}
            disabled={choosingVault || (!vaultInfo && !vaultError)}
            onClick={() => void chooseVault()}
            title={vaultInfo?.path}
          >
            記憶庫位置
          </button>
        </div>
      </header>
      <div className={styles.workspace}>
        <main className={styles.stage} aria-labelledby="mode-heading">
          <h1 id="mode-heading">{modeTitle}</h1>
          {vaultError && <p role="alert">{vaultError}</p>}
          {vaultInfo?.exists === false && (
            <div className={styles.missingVault}>
              <h2>找不到記憶庫資料夾</h2>
              <p className={styles.path}>{vaultInfo.path}</p>
              <button type="button" disabled={choosingVault} onClick={() => void chooseVault()}>
                選擇資料夾
              </button>
            </div>
          )}
          {!vaultInfo && !vaultError && <p role="status">讀取記憶庫位置中…</p>}
        </main>
        <aside className={styles.details} aria-label="詳情" hidden />
      </div>
    </div>
  );
}

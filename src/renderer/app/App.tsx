import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MemoryEntry, VaultInfo, ViewSettings } from '../../shared/types';
import { Library } from '../library/Library';
import { useDelayed } from '../library/use-delayed';
import { browserFrameClock } from '../sky/frame-clock';
import type { FrameClock } from '../sky/frame-clock';
import { Sky } from '../sky/Sky';
import { SkyHud } from '../sky/SkyHud';
import { useSystemMotion } from '../sky/use-system-motion';
import { createFloorCamera } from './floor-camera';
import type { Floor, FloorElements } from './floor-camera';
import styles from './App.module.css';

const defaults: ViewSettings = { deskMode: 'A', reducedMotion: false };
const filterId = 'verticalMotionBlur';
const announcements: Record<Floor, string> = { sky: '前往樓上星象台', library: '回到樓下典藏室' };

/** Where focus lands after arriving: the first link toggle upstairs, the first desk button downstairs (DESIGN.md §8). */
function firstControl(layer: HTMLElement | null, floor: Floor): HTMLElement | null {
  if (!layer) return null;
  const preferred = floor === 'sky' ? 'button[data-kind]' : '[aria-labelledby="draft-board"] button, [data-library-workspace] button';
  return layer.querySelector<HTMLElement>(preferred) ?? layer.querySelector<HTMLElement>('button, input, select, [tabindex="0"]');
}

export function App({ clock = browserFrameClock }: { clock?: FrameClock }) {
  /** The floor the user is on or travelling to. */
  const [floor, setFloor] = useState<Floor>('library');
  /** True while both floors are on screen. */
  const [moving, setMoving] = useState(false);
  const [quietFade, setQuietFade] = useState(0);
  const [arrived, setArrived] = useState<{ floor: Floor; token: number }>();
  const [announcement, setAnnouncement] = useState('');
  const [skyRequest, setSkyRequest] = useState<{ nodeId: string; requestId: number }>();
  const [libraryRequest, setLibraryRequest] = useState<{ path: string; requestId: number }>();
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [vaultError, setVaultError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState(defaults);
  const [saving, setSaving] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const showLoading = useDelayed(!vaultInfo && !vaultError ? 'vault' : null);
  const systemReduced = useSystemMotion();
  const quiet = settings.reducedMotion || systemReduced;

  const shell = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const libraryBackground = useRef<HTMLDivElement>(null);
  const libraryBar = useRef<HTMLElement>(null);
  const skyBar = useRef<HTMLElement>(null);
  const upstairs = useRef<HTMLElement>(null);
  const downstairs = useRef<HTMLElement>(null);
  /** Work to do once the camera reaches a floor (jump requests are delivered only after arrival). */
  const arrival = useRef<{ floor: Floor; run: () => void } | null>(null);
  const requestId = useRef(0);

  const elements = useCallback((): FloorElements => ({
    world: world.current,
    blur: blur.current,
    libraryBackground: libraryBackground.current,
    stars: upstairs.current?.querySelector<HTMLElement>('[data-star-field]') ?? null,
  }), []);

  /** The top bars swap without React so a mid-transition swap costs no render. */
  const swapBars = useCallback((to: Floor) => {
    if (shell.current) shell.current.dataset.topbar = to;
    libraryBar.current?.toggleAttribute('inert', to !== 'library');
    skyBar.current?.toggleAttribute('inert', to !== 'sky');
  }, []);

  const camera = useRef<ReturnType<typeof createFloorCamera>>(null);
  if (!camera.current) {
    camera.current = createFloorCamera({
      clock, elements, filterId, onSwap: swapBars,
      onFinish: (to) => {
        setMoving(false);
        setArrived((previous) => ({ floor: to, token: (previous?.token ?? 0) + 1 }));
      },
    });
  }

  useLayoutEffect(() => {
    camera.current?.rest('library');
    swapBars('library');
    return () => camera.current?.cancel();
  }, [swapBars]);

  // Runs after React has committed the arrival: focus first, then pending jumps (an opened desk may take focus).
  useEffect(() => {
    if (!arrived) return;
    firstControl(arrived.floor === 'sky' ? upstairs.current : downstairs.current, arrived.floor)?.focus({ preventScroll: true });
    const pending = arrival.current;
    arrival.current = null;
    if (pending?.floor === arrived.floor) pending.run();
  }, [arrived]);

  const go = useCallback((to: Floor, then?: () => void) => {
    arrival.current = then ? { floor: to, run: then } : null;
    const cam = camera.current!;
    if (to === floor && !cam.running) {
      arrival.current = null;
      then?.();
      return;
    }
    setAnnouncement(announcements[to]);
    setFloor(to);
    if (quiet) {
      setQuietFade((value) => value + 1);
      cam.start(to, true);
      return;
    }
    // A second press during the pan lands on the requested floor at once (DESIGN.md §8).
    if (!cam.running) setMoving(true);
    cam.start(to, false);
  }, [floor, quiet]);

  const goToNode = useCallback((nodeId: string) => {
    go('sky', () => setSkyRequest({ nodeId, requestId: ++requestId.current }));
  }, [go]);

  const openInLibrary = useCallback((entry: MemoryEntry) => {
    go('library', () => setLibraryRequest({ path: entry.path, requestId: ++requestId.current }));
  }, [go]);

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

  const toggleMotion = () => void updateSettings({ reducedMotion: !settings.reducedMotion });
  const skyShown = floor === 'sky' || moving;
  const libraryShown = floor === 'library' || moving;

  return <div ref={shell} className={styles.shell} data-floor={floor} data-moving={moving}
    data-reduced-motion={settings.reducedMotion} data-quiet-fade={quietFade ? quietFade % 2 ? 'a' : 'b' : undefined}>
    <svg className={styles.filters} aria-hidden="true" width="0" height="0">
      <filter id={filterId} x="-5%" y="-15%" width="110%" height="130%">
        <feGaussianBlur ref={blur} in="SourceGraphic" stdDeviation="0 0" />
      </filter>
    </svg>
    <p className={styles.srOnly} aria-live="polite" data-floor-announcement="">{announcement}</p>
    <header ref={libraryBar} className={styles.topBar} data-library-bar="">
      <h1>記憶寶庫</h1>
      <div role="group" aria-label="樓層切換" className={styles.modeSwitch}>
        <button type="button" aria-pressed={floor === 'library'} onClick={() => go('library')}>樓下｜典藏室</button>
        <button type="button" aria-pressed={floor === 'sky'} onClick={() => go('sky')}>樓上｜星象召喚盤</button>
      </div>
      <div className={styles.tools}>
        <input type="search" aria-label="搜尋卷宗" placeholder="檢索案號、題名或節點…" value={query}
          onChange={(event) => setQuery(event.target.value)} disabled={!vaultInfo?.exists} />
        <button type="button" disabled={!settingsReady || saving} onClick={toggleDesk}>
          版式：{settings.deskMode === 'A' ? 'A 寬幅閱讀桌' : 'B 右側 420px 欄'}
        </button>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>重新整理</button>
        <button type="button" aria-pressed={settings.reducedMotion} disabled={!settingsReady || saving}
          onClick={toggleMotion}>低動態：{settings.reducedMotion ? '開' : '關'}</button>
        <button type="button" disabled={choosing} onClick={() => void chooseVault()} title={vaultInfo?.path}>記憶庫位置</button>
      </div>
    </header>
    <SkyHud barRef={skyBar} reducedMotion={settings.reducedMotion} settingsDisabled={!settingsReady || saving}
      onLibrary={() => go('library')} onToggleMotion={toggleMotion} />
    <main className={styles.stage}>
      {(settingsError || (vaultInfo?.exists && vaultError)) &&
        <p className={styles.settingError} role="alert">{settingsError || vaultError}</p>}
      <div ref={world} className={styles.world} data-floor-world="">
        <section ref={upstairs} className={styles.upstairs} aria-label="樓上星象召喚盤" data-shown={skyShown}
          aria-hidden={!skyShown} inert={floor !== 'sky'}>
          <Sky key={vaultInfo?.key} active={floor === 'sky'} reducedMotion={settings.reducedMotion}
            refreshToken={attempt} vaultExists={vaultInfo?.exists ?? false} selectionRequest={skyRequest}
            onReturn={() => go('library')} onOpenEntry={openInLibrary} />
        </section>
        <section ref={downstairs} className={styles.downstairs} aria-label="樓下典藏室" data-shown={libraryShown}
          aria-hidden={!libraryShown} inert={floor !== 'library'}>
          <div ref={libraryBackground} className={styles.libraryBackground} aria-hidden="true" />
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
            onToggleMode={toggleDesk} active={floor === 'library'} onNode={goToNode} openRequest={libraryRequest} />}
        </section>
      </div>
    </main>
  </div>;
}


// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrystalList, NodeCrystalDetail, ProfileEditResult, ProfileSaveResult, ReadableNodeProfile, RequestWakeResult } from '../../shared/types';
import { manualClock } from '../test-support/manual-clock';
import { Sky } from './Sky';
import { checkPlaceholders, splitPlaceholders } from './profile-placeholders';
import { conflictPlaceholderNote, localDate, placeholderHelp, saveNoticeKey, saveNoticeSessionKey, saveNoticeText } from './ProfileOverlay';
import { wakeSentText } from './DetailPanel';
import { wakeSentMs } from './Sky';

const crystal = (nodeId: string, name: string, status: '線上' | '封存', canWake = false) =>
  ({ nodeId, name, role: null, status, canWake, projectNames: [], position: [0, 0, 0] as [number, number, number] });
const data: CrystalList = { crystals: [crystal('live', '現役甲', '線上'), crystal('old', '封存乙', '封存', true), crystal('memo', '紀念丙', '封存')], links: [] };
const version = { mtime: 1, size: 100, identity: 'id-1', editToken: 'token-1' };
const body = '## 特長\n\n擅長整理。\n\n## 解決問題的流程\n\n先看 ⟦路徑1⟧ 再比對 ⟦路徑2⟧。';
const profile: ReadableNodeProfile = {
  nodeId: 'live', source: { kind: 'live', path: 'nodes/現役甲.md', archivedAt: null },
  body: '## 特長\n\n擅長整理。', review: '下次先寫測試。',
  consoleAppendices: [{ at: '2026-11-22 07:00', localTime: '2026-11-22 15:00（本機時間）', text: '## 特長\n\n主控台補充的特長。', review: '' }],
  consoleAppendixCount: 1,
};
const detail = (id: string): NodeCrystalDetail => ({
  ...data.crystals.find((node) => node.nodeId === id)!, profile: { path: 'nodes/x.md' } as NodeCrystalDetail['profile'], stats: null,
  archives: [], relatedEntries: [], confirmedCaseCount: 0, specialty: '擅長整理。', workflow: '', review: '', notRejectedRate: null,
  consoleAppendixCount: id === 'live' ? 1 : 0,
});

describe('閱讀全文、編輯側寫、喚醒(M5d-b)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let vault: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
    sessionStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vault = {
      listCrystals: vi.fn(async () => data),
      readCrystal: vi.fn(async (id: string) => detail(id)),
      readNodeProfile: vi.fn(async (id: string) => id === 'old'
        ? { ...profile, nodeId: 'old', source: { kind: 'archived', path: 'nodes/封存/封存乙-2026-11-18.md', archivedAt: '2026-11-18' } } : profile),
      readProfileForEdit: vi.fn(async (id: string): Promise<ProfileEditResult> => ({ ok: true, body, version,
        isArchive: id === 'old', archiveNotice: id === 'old' ? '這份是封存檔，修改會在日後接回時帶進新節點。' : null })),
      saveProfileBody: vi.fn(async (): Promise<ProfileSaveResult> => ({ ok: true, version: { ...version, mtime: 2 } })),
      requestWake: vi.fn(async (): Promise<RequestWakeResult> => ({ ok: true })),
    };
    vi.stubGlobal('vault', vault);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const byText = (text: string, scope: ParentNode = host) =>
    [...scope.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement;
  async function open(nodeId: string, refreshToken = 0) {
    await act(async () => root.render(<Sky active reducedMotion={false} vaultExists refreshToken={refreshToken} clock={manualClock().clock}
      onReturn={() => {}} selectionRequest={{ nodeId, requestId: Math.random() }} />));
  }
  const esc = async (target: Element = document.activeElement ?? host) =>
    act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  async function type(value: string) {
    const field = q<HTMLTextAreaElement>('[data-profile-editor]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function startEditing(nodeId = 'live') {
    await open(nodeId);
    await act(async () => q<HTMLButtonElement>('[data-read-full]')!.click());
    await act(async () => q<HTMLButtonElement>('[data-profile-edit]')!.click());
  }

  it('閱讀全文:正文、回顧、主控台補充分節(只顯示本機時間);Esc 只關閱讀紙並把焦點還給按鈕;畫面沒有路徑', async () => {
    await open('live');
    expect(q('[data-sky-detail]')!.textContent).toContain('另有主控台補充 1 段');
    const button = q<HTMLButtonElement>('[data-read-full]')!;
    await act(async () => button.click());
    const overlay = q('[data-profile-overlay]')!;
    expect(overlay.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('閱讀全文:現役甲');
    expect(overlay.textContent).toContain('現役側寫');
    expect(q('[data-profile-review]')!.textContent).toBe('回顧下次先寫測試。');
    const appendix = q('[data-appendix]')!;
    expect(appendix.querySelector('h3')!.textContent).toBe('主控台補充 · 2026-11-22 15:00（本機時間）');
    expect(appendix.textContent).toContain('主控台補充的特長。');
    expect(overlay.textContent).not.toContain('07:00');
    // Drive letters only at a word start and not as part of a URL scheme (SVG data URIs contain http://).
    expect(host.innerHTML).not.toMatch(/nodes\/|\b[a-z]:[\\/](?!\/)|p_[a-f0-9]{24}/i);
    await esc();
    expect(q('[data-profile-overlay]')).toBeNull();
    expect(q('[data-crystal="live"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(q('[data-read-full]'));
  });

  it('編輯:佔位符畫成標籤並說明;第一次儲存先提示(可不再提示);成功後關閉並重讀履歷', async () => {
    await startEditing();
    expect(q<HTMLTextAreaElement>('[data-profile-editor]')!.value).toBe(body);
    expect(document.activeElement).toBe(q('[data-profile-editor]'));
    expect(q('[data-placeholders]')!.textContent).toContain(placeholderHelp);
    expect(host.querySelectorAll('mark[data-token="ok"]')).toHaveLength(2);
    expect(q('[data-archive-notice]')).toBeNull();
    await type(body.replace('擅長整理。', '擅長整理與校對。'));
    const reads = vault.readCrystal.mock.calls.length;
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    const first = q('[data-sky-dialog="first-save"]')!;
    expect(first.textContent).toContain(saveNoticeText);
    expect(saveNoticeText).toMatch(/一直把這份側寫視為你改過[\s\S]*只會把有變動的章節附加在文末/);
    expect(vault.saveProfileBody).not.toHaveBeenCalled();
    await act(async () => first.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await act(async () => byText('儲存', first).click());
    expect(vault.saveProfileBody).toHaveBeenCalledWith('live', body.replace('擅長整理。', '擅長整理與校對。'), version, undefined);
    expect(q('[data-profile-overlay]')).toBeNull();
    expect(vault.readCrystal.mock.calls.length).toBeGreaterThan(reads);
    expect(localStorage.getItem(saveNoticeKey)).toBe('1');
    // The next save goes straight through.
    await act(async () => q<HTMLButtonElement>('[data-read-full]')!.click());
    await act(async () => q<HTMLButtonElement>('[data-profile-edit]')!.click());
    await type(body + '\n補一句。');
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(q('[data-sky-dialog="first-save"]')).toBeNull();
    expect(vault.saveProfileBody).toHaveBeenCalledTimes(2);
  });

  it('首次提示沒勾「不再提示」:同一次開 App 只提示一次,下次開 App 再提示', async () => {
    await startEditing();
    await type(body + '\n一。');
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    await act(async () => byText('儲存', q('[data-sky-dialog="first-save"]')!).click());
    expect(localStorage.getItem(saveNoticeKey)).toBeNull();
    expect(sessionStorage.getItem(saveNoticeSessionKey)).toBe('1');
    await act(async () => q<HTMLButtonElement>('[data-read-full]')!.click());
    await act(async () => q<HTMLButtonElement>('[data-profile-edit]')!.click());
    await type(body + '\n二。');
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(q('[data-sky-dialog="first-save"]')).toBeNull();
    expect(vault.saveProfileBody).toHaveBeenCalledTimes(2);
    sessionStorage.clear();
    await act(async () => q<HTMLButtonElement>('[data-read-full]')!.click());
    await act(async () => q<HTMLButtonElement>('[data-profile-edit]')!.click());
    await type(body + '\n三。');
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(q('[data-sky-dialog="first-save"]')).not.toBeNull();
  });

  it('刪掉佔位符:列出並可復原;儲存時後端要求確認 → 確認後帶 acknowledgedRemovals 重送', async () => {
    localStorage.setItem(saveNoticeKey, '1');
    await startEditing();
    await type(body.replace(' ⟦路徑2⟧', ''));
    expect(q('[data-placeholder="2"]')!.dataset.state).toBe('missing');
    expect(q('[data-placeholder="2"]')!.textContent).toContain('已刪除');
    vault.saveProfileBody.mockResolvedValueOnce({ ok: false, reason: 'invalid-placeholders', issue: 'missing', missingPlaceholders: [2],
      message: '這些佔位符已被刪除：#2。確認刪除後，對應的路徑原文會從側寫永久移除。' });
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    const dialog = q('[data-sky-dialog="removal"]')!;
    expect(dialog.textContent).toContain('對應的路徑原文會從側寫永久移除');
    await act(async () => byText('確認刪除並儲存', dialog).click());
    expect(vault.saveProfileBody).toHaveBeenLastCalledWith('live', body.replace(' ⟦路徑2⟧', ''), version, { acknowledgedRemovals: [2] });
    expect(q('[data-profile-overlay]')).toBeNull();
  });

  it('重複、改動、未知或殘缺的佔位符:顯示原因且不能儲存;復原按鈕放回佔位符', async () => {
    localStorage.setItem(saveNoticeKey, '1');
    await startEditing();
    const save = () => q<HTMLButtonElement>('[data-profile-save]')!;
    await type(body + ' ⟦路徑1⟧');
    expect(q('[data-warning="duplicate"]')!.textContent).toContain('#1');
    expect(save().disabled).toBe(true);
    await type(body.replace('⟦路徑2⟧', '⟦路徑7⟧'));
    expect(q('[data-warning="unknown"]')!.textContent).toContain('#7');
    expect(save().disabled).toBe(true);
    await type(body.replace('⟦路徑2⟧', '⟦路徑2'));
    expect(q('[data-warning="damaged"]')).not.toBeNull();
    expect(save().disabled).toBe(true);
    await type(body.replace(' ⟦路徑2⟧', ''));
    await act(async () => q('[data-placeholder="2"] button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(checkPlaceholders(body, q<HTMLTextAreaElement>('[data-profile-editor]')!.value).missing).toEqual([]);
    expect(save().disabled).toBe(false);
    expect(vault.saveProfileBody).not.toHaveBeenCalled();
  });

  it('衝突:顯示「檔案已被修改」與重新載入,保留剛才輸入的文字;重新載入後換成新版正文', async () => {
    localStorage.setItem(saveNoticeKey, '1');
    await startEditing();
    await type(body + '\n我的修改。');
    vault.saveProfileBody.mockResolvedValueOnce({ ok: false, reason: 'conflict' });
    // A real click focuses the button, which the conflict state replaces.
    await act(async () => { q<HTMLButtonElement>('[data-profile-save]')!.focus(); q<HTMLButtonElement>('[data-profile-save]')!.click(); });
    expect(q('[role="alert"]')!.textContent).toMatch(/^未儲存 · 檔案已被修改/);
    expect(q<HTMLTextAreaElement>('[data-conflict] textarea')!.value).toBe(body + '\n我的修改。');
    expect(q('[data-profile-save]')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.activeElement!.textContent).toBe('重新載入');
    vault.readProfileForEdit.mockResolvedValueOnce({ ok: true, body: body + '\n主控台剛改的。', version: { ...version, mtime: 9 }, isArchive: false, archiveNotice: null });
    await act(async () => byText('重新載入').click());
    expect(q<HTMLTextAreaElement>('[data-profile-editor]')!.value).toBe(body + '\n主控台剛改的。');
    expect(q<HTMLTextAreaElement>('[data-conflict] textarea')!.value).toBe(body + '\n我的修改。');
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(vault.saveProfileBody).toHaveBeenLastCalledWith('live', body + '\n主控台剛改的。', { ...version, mtime: 9 }, undefined);
  });

  it('寫入失敗:未儲存與重試;封存檔顯示提示;刪掉特長或貼上金鑰時提醒', async () => {
    localStorage.setItem(saveNoticeKey, '1');
    await startEditing('old');
    expect(q('[data-archive-notice]')!.textContent).toBe('這份是封存檔，修改會在日後接回時帶進新節點。');
    expect(host.innerHTML).not.toMatch(/nodes\/|封存乙-2026-11-18|token-1|id-1/);
    await type(body.replace('## 特長', '特長') + '\napi_key=abcdef123456');
    expect(q('[data-warning="specialty"]')).not.toBeNull();
    expect(q('[data-warning="secret"]')).not.toBeNull();
    vault.saveProfileBody.mockResolvedValueOnce({ ok: false, reason: 'io' });
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(q('[role="alert"]')!.textContent).toBe('未儲存 · 寫入失敗,檔案可能正被其他程式使用。');
    expect(q('[data-profile-save]')!.textContent).toBe('重試');
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(vault.saveProfileBody).toHaveBeenCalledTimes(2);
    expect(q('[data-profile-overlay]')).toBeNull();
  });

  it('Esc 層級:有未存修改先問;繼續編輯留下;放棄回到閱讀;再 Esc 關閱讀紙;履歷欄不受影響', async () => {
    await startEditing();
    await type(body + '\n未存。');
    await esc();
    expect(q('[data-sky-dialog="discard"]')).not.toBeNull();
    await esc(q('[data-sky-dialog="discard"] button')!);
    await act(async () => {});
    expect(document.activeElement).toBe(q('[data-profile-editor]'));
    expect(q('[data-sky-dialog="discard"]')).toBeNull();
    expect(q('[data-profile-mode]')!.getAttribute('data-profile-mode')).toBe('edit');
    await esc(q('[data-profile-editor]')!);
    await act(async () => byText('放棄修改').click());
    expect(q('[data-profile-mode]')!.getAttribute('data-profile-mode')).toBe('read');
    await esc(q('[data-profile-mode]')!);
    expect(q('[data-profile-overlay]')).toBeNull();
    expect(q('[data-crystal="live"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('「已送出」不會一直留著:一分鐘後淡出;下一份統計快照到來時也淡出', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await open('old');
      await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
      await act(async () => byText('確認接回舊 Session').click());
      expect(q('[data-wake-result="sent"]')).not.toBeNull();
      await act(async () => { vi.advanceTimersByTime(wakeSentMs - 1000); });
      expect(q('[data-wake-result="sent"]')!.hasAttribute('data-fading')).toBe(false);
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(q('[data-wake-result="sent"]')!.hasAttribute('data-fading')).toBe(true);
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(q('[data-wake-result]')).toBeNull();
      expect(q('[data-wake-action]')).not.toBeNull();

      await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
      await act(async () => byText('確認接回舊 Session').click());
      expect(q('[data-wake-result="sent"]')).not.toBeNull();
      // A new stats snapshot (the star list is read again) ends the notice.
      vault.listCrystals.mockResolvedValueOnce({ ...data });
      await open('old', 1);
      expect(q('[data-wake-result="sent"]')?.hasAttribute('data-fading') ?? true).toBe(true);
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(q('[data-wake-result]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('正文出現 ⟦ ⟧ 括號:指出是哪一段並建議改用【】(後端也會拒絕);殘缺的 ⟦路徑 片段仍擋下', async () => {
    localStorage.setItem(saveNoticeKey, '1');
    await startEditing();
    const save = () => q<HTMLButtonElement>('[data-profile-save]')!;
    await type(body + '\n⟦注意⟧ 與單獨的 ⟧');
    const warning = q('[data-warning="reserved"]')!;
    expect([...warning.querySelectorAll('code')].map((code) => code.textContent)).toEqual(['⟦注意⟧', '⟧']);
    expect(warning.textContent).toContain('【】');
    expect(q('[data-warning="damaged"]')).toBeNull();
    expect(save().disabled).toBe(true);
    await type(body.replace('⟦路徑2⟧', '⟦路徑2'));
    expect(q('[data-warning="damaged"]')).not.toBeNull();
    expect(q('[data-warning="reserved"]')).toBeNull();
    expect(save().disabled).toBe(true);
    await type(body + '\n改用【注意】就可以。');
    expect(q('[data-warning]')).toBeNull();
    await act(async () => save().click());
    expect(vault.saveProfileBody).toHaveBeenCalledTimes(1);
  });

  it('確認刪除後寫入失敗:重試沿用確認不再問;改了正文就重新問;衝突後確認失效', async () => {
    localStorage.setItem(saveNoticeKey, '1');
    await startEditing();
    const edited = body.replace(' ⟦路徑2⟧', '');
    await type(edited);
    const missing = { ok: false as const, reason: 'invalid-placeholders' as const, issue: 'missing' as const, missingPlaceholders: [2],
      message: '這些佔位符已被刪除：#2。確認刪除後，對應的路徑原文會從側寫永久移除。' };
    vault.saveProfileBody.mockResolvedValueOnce(missing).mockResolvedValueOnce({ ok: false, reason: 'io' });
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    await act(async () => byText('確認刪除並儲存').click());
    expect(q('[data-profile-save]')!.textContent).toBe('重試');
    vault.saveProfileBody.mockResolvedValueOnce({ ok: false, reason: 'occupied' });
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(q('[data-sky-dialog="removal"]')).toBeNull();
    expect(vault.saveProfileBody).toHaveBeenLastCalledWith('live', edited, version, { acknowledgedRemovals: [2] });
    // Changed text: the old confirmation no longer applies.
    await type(edited + '\n再補一句。');
    vault.saveProfileBody.mockResolvedValueOnce(missing);
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(vault.saveProfileBody).toHaveBeenLastCalledWith('live', edited + '\n再補一句。', version, undefined);
    expect(q('[data-sky-dialog="removal"]')).not.toBeNull();
    // Confirm, then a conflict: after reloading, saving asks again.
    vault.saveProfileBody.mockResolvedValueOnce({ ok: false, reason: 'conflict' });
    await act(async () => byText('確認刪除並儲存').click());
    expect(q('[data-conflict-note]')!.textContent).toBe(conflictPlaceholderNote);
    vault.readProfileForEdit.mockResolvedValueOnce({ ok: true, body, version: { ...version, mtime: 5 }, isArchive: false, archiveNotice: null });
    await act(async () => byText('重新載入').click());
    await type(edited);
    await act(async () => q<HTMLButtonElement>('[data-profile-save]')!.click());
    expect(vault.saveProfileBody).toHaveBeenLastCalledWith('live', edited, { ...version, mtime: 5 }, undefined);
  });

  it('喚醒:只給可接回的封存節點;先確認;送出中不能重複;成功只說已送出;失敗給退路與 sessionId', async () => {
    await open('live');
    expect(q('[data-wake-action]')).toBeNull();
    await open('memo');
    expect(q('[data-wake-action]')).toBeNull();
    await open('old');
    await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
    expect(q('[data-sky-dialog="wake"]')!.textContent).toContain('會請主控台接回〈封存乙〉的舊對話,主控台會再請你確認。');
    let finish!: (value: RequestWakeResult) => void;
    vault.requestWake.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await act(async () => byText('確認接回舊 Session').click());
    expect(q<HTMLButtonElement>('[data-wake-action]')!.disabled).toBe(true);
    await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
    expect(q('[data-sky-dialog="wake"]')).toBeNull();
    await act(async () => finish({ ok: true }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(document.activeElement).toBe(q('[data-wake-action]'));
    expect(vault.requestWake).toHaveBeenCalledTimes(1);
    expect(q('[data-wake-result="sent"]')!.textContent).toBe(wakeSentText);
    expect(wakeSentText).toContain('若你取消了就不會接回');
    expect(q('[data-crystal="old"]')!.textContent).toContain('封存');

    vault.requestWake.mockResolvedValueOnce({ ok: false, reason: 'unregistered', nodeName: '封存乙', sessionId: 'sess-42' });
    await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
    await act(async () => byText('確認接回舊 Session').click());
    expect(q('[data-wake-result="failed"]')!.textContent).toBe('沒有送出:找不到主控台的喚醒網址。請在主控台用「開啟舊 session」接回〈封存乙〉。 sessionId:sess-42');
    vault.requestWake.mockResolvedValueOnce({ ok: false, reason: 'rejected', nodeName: '封存乙', sessionId: 'sess-42' });
    await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
    await act(async () => byText('確認接回舊 Session').click());
    expect(q('[data-wake-result="failed"]')!.textContent).toBe('無法聯絡主控台,請確認主控台已開啟;也可以請在主控台用「開啟舊 session」接回〈封存乙〉。 sessionId:sess-42');
    vault.requestWake.mockRejectedValueOnce(new Error('ipc'));
    await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
    await act(async () => byText('確認接回舊 Session').click());
    expect(q('[data-wake-result="failed"]')!.textContent).toBe('請求沒有成功送出,請確認主控台已開啟。');
    vault.requestWake.mockResolvedValueOnce({ ok: false, reason: 'not-wakeable', nodeName: null, sessionId: null });
    await act(async () => q<HTMLButtonElement>('[data-wake-action]')!.click());
    await act(async () => byText('確認接回舊 Session').click());
    expect(q('[data-wake-result="failed"]')!.textContent).toBe('這個節點目前無法喚醒。');
  });
});

describe('封存日期', () => {
  it('封存時間顯示成本機日期', () => {
    const iso = new Date(2026, 10, 18, 23, 30).toISOString();
    expect(localDate(iso)).toBe('2026-11-18');
    expect(localDate(iso, true)).toBe('2026-11-18 23:30');
    expect(localDate('2026-11-21 08:00', true)).toBe('2026-11-21 08:00');
    expect(localDate('2026-11-18')).toBe('2026-11-18');
    expect(localDate('不是日期')).toBe('不是日期');
  });
});

describe('佔位符檢查(純函式)', () => {
  it('缺少、重複、未知、殘缺', () => {
    const original = 'a ⟦路徑1⟧ b ⟦路徑2⟧';
    expect(checkPlaceholders(original, original)).toEqual({ missing: [], duplicate: [], unknown: [], damaged: false, reserved: [] });
    expect(checkPlaceholders(original, 'a ⟦路徑1⟧ b')).toMatchObject({ missing: [2] });
    expect(checkPlaceholders(original, original + '⟦路徑1⟧')).toMatchObject({ duplicate: [1] });
    expect(checkPlaceholders(original, 'a ⟦路徑1⟧ b ⟦路徑3⟧')).toMatchObject({ missing: [2], unknown: [3] });
    expect(checkPlaceholders(original, 'a ⟦路徑1⟧ b ⟦路徑⟧ ⟦路徑2⟧').damaged).toBe(true);
    expect(checkPlaceholders(original, original + ' ⟦路徑2').damaged).toBe(true);
    // Other white-bracket text is not a damaged placeholder, but it is listed (the main process reserves it).
    expect(checkPlaceholders(original, original + ' ⟦注意⟧ ⟧ ⟦')).toMatchObject({ damaged: false, reserved: ['⟦注意⟧', '⟧', '⟦'] });
    expect(splitPlaceholders('x⟦路徑1⟧y')).toEqual([{ text: 'x' }, { text: '⟦路徑1⟧', number: 1 }, { text: 'y' }]);
  });
});

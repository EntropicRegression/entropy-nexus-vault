import { useEffect, useRef, useState } from 'react';
import type { NodePortraitResult } from '../../shared/types';
import { setNodePortraitOverride, useNodeCustomPortrait } from './brand-portrait';

const failures: Record<Exclude<NodePortraitResult, { ok: true }>['reason'], string> = {
  'invalid-node': '這個節點目前不在星圖上,無法指定圖片。',
  unsupported: '只接受 PNG、WebP 或 JPEG 圖片。',
  'too-large': '圖片超過 20 MB,請換一張較小的圖。',
  'not-image': '這個檔案不是有效的圖片。',
  io: '圖片沒有存好,請再試一次。',
};

/**
 * 「指定圖片 / 更換 / 清除」for one node (DESIGN.md §6.5.2). The main process opens the system file dialog, checks and
 * copies the picture into the app's own userData; this view only learns whether a picture is assigned.
 */
export function NodePortraitControl({ node, className }: {
  node: { nodeId: string; customPortraitUrl?: string | null };
  className?: string;
}) {
  const assigned = Boolean(useNodeCustomPortrait(node));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const available = Boolean(window.vault.chooseNodePortrait && window.vault.clearNodePortrait);

  // The buttons are disabled while the main process works; give focus back afterwards so the keyboard user stays here.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (!busy && hadFocus.current) {
      hadFocus.current = false;
      box.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
    }
  }, [busy]);

  async function run(action: 'choose' | 'clear') {
    if (busy || !available) return;
    hadFocus.current = Boolean(box.current?.contains(document.activeElement));
    setBusy(true);
    setMessage(null);
    try {
      const result = action === 'choose'
        ? await window.vault.chooseNodePortrait!(node.nodeId)
        : await window.vault.clearNodePortrait!(node.nodeId);
      if (result === null) return; // cancelled in the file dialog
      if (result.ok) {
        setNodePortraitOverride(node.nodeId, result.customPortraitUrl);
        setMessage({ text: result.customPortraitUrl ? '已指定,這張圖會優先顯示。' : '已清除,改回預設圖片。', error: false });
      } else {
        setMessage({ text: failures[result.reason] ?? failures.io, error: true });
      }
    } catch {
      setMessage({ text: failures.io, error: true });
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;
  return <div ref={box} className={className} data-node-portrait="">
    <span data-node-portrait-status={assigned ? 'assigned' : 'none'}>節點圖片:{assigned ? '已指定(優先顯示)' : '未指定'}</span>
    <button type="button" disabled={busy} onClick={() => void run('choose')}>{busy ? '處理中…' : assigned ? '更換圖片' : '指定圖片'}</button>
    {assigned && <button type="button" disabled={busy} onClick={() => void run('clear')}>清除</button>}
    {message && <p role={message.error ? 'alert' : 'status'} data-node-portrait-message={message.error ? 'error' : 'ok'}>{message.text}</p>}
  </div>;
}

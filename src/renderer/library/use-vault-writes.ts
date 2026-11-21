import { useCallback, useRef, useState } from 'react';
import type { FileVersion, MemoryEntry, RecycledEntry, RecycledVersion, VaultRecycleResult, VaultStatusUpdate, VaultWriteFailure, VaultWriteResult } from '../../shared/types';

export type WriteRequest =
  | { kind: 'status'; entry: MemoryEntry; status: VaultStatusUpdate }
  | { kind: 'recycle'; entry: MemoryEntry }
  | { kind: 'restore'; entry: MemoryEntry; recycledPath: string; version: RecycledVersion; noticeId: number };

export type Feedback =
  | { phase: 'pending' | 'reloading'; request: WriteRequest }
  | ({ phase: 'failure'; request: WriteRequest } & VaultWriteFailure)
  | { phase: 'saved'; request: WriteRequest; text: string };

export interface Notice {
  id: number;
  text: string;
  expiresAt: number;
  undo?: Extract<WriteRequest, { kind: 'restore' }>;
  preview?: RecycledEntry;
}

type Success = Extract<VaultRecycleResult | VaultWriteResult, { ok: true }>;
type Commit = (request: WriteRequest, version: FileVersion) => void;
export const legacyWriteMessage = '此檔為舊格式，尚不支援寫入';

export function reasonText(reason: VaultWriteFailure['reason'], action: WriteRequest['kind']) {
  if (reason === 'conflict') return '檔案已被修改。請重新載入此卷宗後再操作。';
  if (reason === 'occupied') return action === 'restore'
    ? '原位置已有同名卷宗，未還原。回收區的那份仍保留。'
    : '回收區的同名檔及編號已用完。原卷宗仍保留。';
  if (reason === 'missing') return '找不到卷宗，請重新載入此卷宗。';
  if (reason === 'legacy') return legacyWriteMessage;
  if (reason === 'readonly') return '檔案為唯讀，請解除唯讀後重試。';
  if (reason === 'recycle-io') return '無法在此磁碟安全搬移卷宗，請用檔案總管檢查來源與回收區。';
  return '無法寫入記憶庫。';
}

export function savedText(request: WriteRequest) {
  if (request.kind === 'recycle') return '已移入回收區';
  if (request.kind === 'restore') return '已還原卷宗';
  return { 已確認: '已收錄', 已完成: '已完成', 退回: '已退回' }[request.status];
}

function invoke(request: WriteRequest): Promise<VaultRecycleResult | VaultWriteResult> {
  const { entry } = request;
  const expected = { mtime: entry.mtime, size: entry.size };
  if (request.kind === 'restore') return window.vault.restoreFromRecycle(request.recycledPath, request.version);
  if (request.kind === 'recycle') return window.vault.moveToRecycle(entry.path, expected);
  return window.vault.setStatus(entry.path, request.status, expected);
}

export function useVaultWrites(onCommit: Commit) {
  const [feedback, setFeedback] = useState<ReadonlyMap<string, Feedback>>(new Map());
  const [notices, setNotices] = useState<Notice[]>([]);
  const active = useRef(new Set<string>());
  const noticeId = useRef(0);

  function update(path: string, value: Feedback) {
    setFeedback((previous) => new Map(previous).set(path, value));
  }

  function clearFeedback(path: string) {
    setFeedback((previous) => {
      const next = new Map(previous);
      next.delete(path);
      return next;
    });
  }

  function notify(request: WriteRequest, result: Success) {
    const id = ++noticeId.current;
    const notice: Notice = { id, text: savedText(request) + '：' + request.entry.title, expiresAt: Date.now() + 3600 };
    if (request.kind === 'recycle' && 'recycledPath' in result) {
      notice.undo = {
        kind: 'restore', entry: request.entry, recycledPath: result.recycledPath,
        version: { mtime: result.mtime, size: result.size, originalPath: result.originalPath }, noticeId: id,
      };
    }
    setNotices((previous) => [...previous.filter((item) => request.kind !== 'restore' || item.id !== request.noticeId), notice]);
  }

  async function run(request: WriteRequest): Promise<void> {
    const { path } = request.entry;
    if (active.current.has(path)) return;
    active.current.add(path);
    update(path, { phase: 'pending', request });
    try {
      const result = await invoke(request);
      if (!result.ok) {
        update(path, { ...result, phase: 'failure', request });
        return;
      }
      onCommit(request, { mtime: result.mtime, size: result.size });
      update(path, { phase: 'saved', request, text: savedText(request) });
      notify(request, result);
    } catch {
      update(path, { ok: false, phase: 'failure', request, reason: 'io' });
    } finally {
      active.current.delete(path);
    }
  }

  async function reloadUndo(request: Extract<WriteRequest, { kind: 'restore' }>) {
    const { path } = request.entry;
    if (active.current.has(path)) return;
    active.current.add(path);
    update(path, { phase: 'reloading', request });
    try {
      const fresh = await window.vault.readRecycledEntry(request.recycledPath, request.version.originalPath);
      if (!fresh) {
        update(path, { ok: false, phase: 'failure', request, reason: 'missing' });
        return;
      }
      setNotices((previous) => previous.map((notice) => notice.id === request.noticeId
        ? {
            ...notice, preview: fresh,
            undo: { ...request, entry: { ...request.entry, title: fresh.title },
              version: { ...request.version, mtime: fresh.mtime, size: fresh.size } },
          }
        : notice));
      clearFeedback(path);
    } catch {
      update(path, { ok: false, phase: 'failure', request, reason: 'missing' });
    } finally {
      active.current.delete(path);
    }
  }

  const dismiss = useCallback((id: number) => setNotices((previous) => previous.filter((item) => item.id !== id)), []);
  return { feedback, notices, run, dismiss, clearFeedback, reloadUndo };
}

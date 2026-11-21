import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canSetStatus } from '../../shared/vault-actions';
import type { FileVersion, RecycledEntry, VaultRecycleResult, VaultStatusUpdate, VaultWriteFailure, VaultWriteResult } from '../../shared/types';
import { entryFromFile } from './entry';
import { memoryPath, sameVaultVersion } from './scan';
import { editStatusLine, hasWritableHeader } from './status-line';

const recyclePrefix = '_回收/';
const renameDelays = [25, 50, 100, 200];
const shelfFolder = /^(?:cases|knowledge|preferences)\//i;

function failed(reason: VaultWriteFailure['reason'], current?: FileVersion): VaultWriteFailure {
  return current ? { ok: false, reason, current } : { ok: false, reason };
}

function hasCode(error: unknown, ...codes: string[]) {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && codes.includes(error.code);
}

function fileVersion(stat: Stats): FileVersion {
  return { mtime: stat.mtimeMs, size: stat.size };
}

function validExpected(expected: unknown): expected is FileVersion {
  return expected !== null && typeof expected === 'object' && 'mtime' in expected && 'size' in expected &&
    Number.isFinite(expected.mtime) && typeof expected.size === 'number' && Number.isSafeInteger(expected.size) && expected.size >= 0;
}

async function statPath(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT', 'ENOTDIR')) return null;
    throw error;
  }
}

async function safePath(root: string, key: string, createParents = false): Promise<string | null> {
  const parts = key.split('/');
  const filename = parts.pop()!;
  let folder = root;
  for (const part of parts) {
    folder = join(folder, part);
    let stat = await statPath(folder);
    if (!stat && createParents) {
      try {
        await mkdir(folder);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
      }
      stat = await statPath(folder);
    }
    if (!stat?.isDirectory() || relative(folder, await realpath(folder)) !== '') return null;
  }
  return join(folder, filename);
}

async function checkedVersion(path: string, expected: FileVersion, original?: Stats): Promise<Stats | VaultWriteFailure> {
  const stat = await statPath(path);
  if (!stat?.isFile()) return failed(stat ? 'io' : 'missing');
  if (stat.mtimeMs !== expected.mtime || stat.size !== expected.size ||
      (original && !sameVaultVersion(original, stat))) return failed('conflict', fileVersion(stat));
  return stat;
}

function sameFile(before: Stats, after: Stats | null): after is Stats {
  return Boolean(after?.isFile() && before.dev === after.dev && before.ino === after.ino);
}

function sameFileData(before: Stats, after: Stats | null): after is Stats {
  // A hard link may change ctime without changing the file contents.
  return sameFile(before, after) && before.mtimeMs === after.mtimeMs && before.size === after.size;
}

async function readStable(path: string, original: Stats): Promise<Buffer | null> {
  const source = await open(path, 'r');
  try {
    if (!sameVaultVersion(original, await source.stat())) return null;
    const bytes = await source.readFile();
    return sameVaultVersion(original, await source.stat()) ? bytes : null;
  } finally {
    await source.close();
  }
}

/** Clean up only the filename that still names our own temporary inode. */
async function removeOwnedFile(path: string, identity: Stats, mayChmod: boolean): Promise<boolean> {
  try {
    let stat = await statPath(path);
    if (!sameFile(identity, stat)) return true;
    try {
      await unlink(path);
    } catch (error) {
      if (!mayChmod || !hasCode(error, 'EPERM', 'EACCES', 'EBUSY')) throw error;
      stat = await statPath(path);
      if (!sameFile(identity, stat)) return true;
      await chmod(path, stat.mode | 0o200);
      await unlink(path);
    }
    return true;
  } catch (error) {
    return hasCode(error, 'ENOENT', 'ENOTDIR');
  }
}

function recycledKey(key: string, index: number): string {
  const ext = posix.extname(key);
  return recyclePrefix + (index === 1 ? key : key.slice(0, -ext.length) + ' (' + index + ')' + ext);
}

function shelfKey(path: unknown): string | null {
  const key = memoryPath(path);
  return key && shelfFolder.test(key) ? key : null;
}

function recyclePair(path: unknown, originalPath: unknown): { source: string; original: string } | null {
  const original = shelfKey(originalPath);
  if (!original || typeof path !== 'string' || !path.startsWith(recyclePrefix)) return null;
  const key = shelfKey(path.slice(recyclePrefix.length));
  if (!key) return null;
  const source = recyclePrefix + key;
  if (source === recycledKey(original, 1)) return { source, original };
  const suffix = / \(([2-9]|[1-9]\d)\)\.md$/i.exec(source);
  return suffix && source === recycledKey(original, Number(suffix[1])) ? { source, original } : null;
}

interface MoveSource {
  root: string;
  key: string;
  path: string;
  stat: Stats;
  expected: FileVersion;
}

async function prepareSource(rootPath: string, key: string, expected: FileVersion): Promise<MoveSource | VaultWriteFailure> {
  const root = await realpath(rootPath);
  const path = await safePath(root, key);
  if (!path) return failed('missing');
  const stat = await checkedVersion(path, expected);
  return 'ok' in stat ? stat : { root, key, path, expected, stat };
}

async function lastCheck(source: MoveSource): Promise<VaultWriteFailure | null> {
  if (await safePath(source.root, source.key) !== source.path) return failed('conflict');
  const result = await checkedVersion(source.path, source.expected, source.stat);
  return 'ok' in result ? (result.reason === 'missing' ? failed('conflict') : result) : null;
}

export class VaultWriter {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly recycleOrigins = new Map<string, string>();

  constructor(private readonly root: string, private readonly onWrite: () => void = () => {}) {}

  setStatus(path: unknown, status: VaultStatusUpdate, expected: unknown): Promise<VaultWriteResult> {
    return this.run(async () => {
      const key = shelfKey(path);
      if (!key || !validExpected(expected)) return failed('io');
      const source = await prepareSource(this.root, key, expected);
      if ('ok' in source) return source;
      const bytes = await readStable(source.path, source.stat);
      if (!bytes) return failed('conflict');
      const entry = entryFromFile({ path: key, text: bytes.toString('utf8'), ...fileVersion(source.stat) }, undefined, Date.now()).entry;
      if (!entry.writable) return failed('legacy');
      if (!canSetStatus(entry, status)) return failed('io');
      const edited = editStatusLine(bytes, status);
      if (!edited) return failed('legacy');
      if (!(source.stat.mode & 0o222)) return failed('readonly');

      return this.replaceStatus(source, edited);
    });
  }

  moveToRecycle(path: unknown, expected: unknown): Promise<VaultRecycleResult> {
    return this.run(async () => {
      const key = shelfKey(path);
      if (!key || !validExpected(expected)) return failed('io');
      const source = await prepareSource(this.root, key, expected);
      if ('ok' in source) return source;
      const bytes = await readStable(source.path, source.stat);
      if (!bytes) return failed('conflict');
      if (!hasWritableHeader(bytes.toString('utf8'))) return failed('legacy');
      for (let index = 1; index <= 99; index++) {
        const recycledPath = recycledKey(key, index);
        const result = await this.move(source, recycledPath);
        if (result.ok) {
          this.recycleOrigins.set(recycledPath, key);
          return { ...result, recycledPath, originalPath: key };
        }
        if (result.reason !== 'occupied') return result;
      }
      return failed('occupied');
    });
  }

  restoreFromRecycle(path: unknown, expected: unknown): Promise<VaultWriteResult> {
    return this.run(async () => {
      const pair = validExpected(expected) && 'originalPath' in expected ? recyclePair(path, expected.originalPath) : null;
      if (!pair || !validExpected(expected) || this.recycleOrigins.get(pair.source) !== pair.original) return failed('io');
      const source = await prepareSource(this.root, pair.source, expected);
      if ('ok' in source) return source;
      const result = await this.move(source, pair.original);
      if (result.ok) this.recycleOrigins.delete(pair.source);
      return result;
    });
  }

  /** Reload the one file in a current undo prompt; this is not a recycle-bin listing. */
  async readRecycledEntry(path: unknown, originalPath: unknown): Promise<RecycledEntry | null> {
    const pair = recyclePair(path, originalPath);
    if (!pair || this.recycleOrigins.get(pair.source) !== pair.original) return null;
    try {
      const root = await realpath(this.root);
      const source = await safePath(root, pair.source);
      if (!source) return null;
      const stat = await statPath(source);
      if (!stat?.isFile()) return null;
      const bytes = await readStable(source, stat);
      if (!bytes || !sameVaultVersion(stat, await statPath(source))) return null;
      const version = fileVersion(stat);
      const parsed = entryFromFile({ path: pair.original, text: bytes.toString('utf8'), ...version }, undefined, Date.now());
      return { title: parsed.entry.title, body: parsed.body, review: parsed.review, ...version };
    } catch {
      return null;
    }
  }

  private run<T extends VaultWriteResult>(operation: () => Promise<T>): Promise<T | VaultWriteFailure> {
    const next = this.tail.then(operation).catch((error: unknown) => failed(hasCode(error, 'ENOENT', 'ENOTDIR') ? 'missing' : 'io'));
    this.tail = next;
    return next;
  }

  private async replaceStatus(source: MoveSource, bytes: Buffer): Promise<VaultWriteResult> {
    const temporary = join(dirname(source.path), '.vault-write-' + randomUUID() + '.tmp');
    const staged = await open(temporary, 'wx', (source.stat.mode & 0o777) | 0o200);
    let identity: Stats | undefined;
    let result: VaultWriteResult;
    try {
      try {
        identity = await staged.stat();
        await staged.writeFile(bytes);
        await staged.sync();
        identity = await staged.stat();
      } finally {
        await staged.close();
      }
      result = await this.commitStatus(source, temporary, identity);
    } catch {
      result = failed('io');
    }
    if (!result.ok) {
      const cleaned = identity ? await removeOwnedFile(temporary, identity, true) : await statPath(temporary).then((file) => !file, () => false);
      if (!cleaned) return { ...result, residualPath: relative(source.root, temporary).replace(/\\/g, '/') };
    }
    return result;
  }

  private async commitStatus(source: MoveSource, temporary: string, staged: Stats): Promise<VaultWriteResult> {
    for (let attempt = 0; ; attempt++) {
      const invalid = await lastCheck(source);
      if (invalid) return invalid;
      try {
        // There is no shared lock: the console can append between this check and rename.
        // Conversely its own check and replace can race this app's status change.
        await rename(temporary, source.path);
      } catch (error) {
        if (!hasCode(error, 'EPERM', 'EBUSY', 'EACCES') || attempt >= renameDelays.length) return failed('io');
        await delay(renameDelays[attempt]);
        continue;
      }
      this.onWrite();
      const published = await statPath(source.path);
      return sameFile(staged, published) && published.size === staged.size
        ? { ok: true, ...fileVersion(published) }
        : failed('conflict', published?.isFile() ? fileVersion(published) : undefined);
    }
  }

  private async move(source: MoveSource, key: string): Promise<VaultWriteResult> {
    const target = await safePath(source.root, key, true);
    if (!target) return failed('io');
    if (await statPath(target)) return failed('occupied');
    const invalid = await lastCheck(source);
    if (invalid) return invalid;
    if (await safePath(source.root, key) !== target) return failed('io');
    try {
      await link(source.path, target);
    } catch (error) {
      if (hasCode(error, 'EEXIST') || await statPath(target)) return failed('occupied');
      if (hasCode(error, 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'EXDEV', 'ENOSYS')) {
        return this.copyAndRemove(source, key, target);
      }
      throw error;
    }
    const current = await statPath(source.path);
    const published = await statPath(target);
    let failure = !sameFileData(source.stat, current) || !sameFileData(source.stat, published) ? failed('conflict') : null;
    if (!failure) {
      try {
        await unlink(source.path);
      } catch {
        failure = failed('io');
      }
    }
    if (failure) {
      if (published && sameFile(published, await statPath(source.path)) && !await removeOwnedFile(target, published, false)) {
        return { ...failure, residualPath: key };
      }
      return failure;
    }
    this.onWrite();
    return { ok: true, ...fileVersion(published!) };
  }

  private async copyAndRemove(source: MoveSource, key: string, target: string): Promise<VaultWriteResult> {
    let created: Stats | undefined;
    let version: FileVersion;
    try {
      const invalid = await lastCheck(source);
      if (invalid) return invalid;
      if (await safePath(source.root, key) !== target) return failed('recycle-io');
      const bytes = await readStable(source.path, source.stat);
      if (!bytes || bytes.length !== source.stat.size) return failed('conflict');
      const out = await open(target, 'wx+', (source.stat.mode & 0o777) | 0o200);
      let published: Stats;
      try {
        created = await out.stat();
        await out.writeFile(bytes);
        await out.sync();
        const readback = Buffer.alloc(bytes.length);
        let offset = 0;
        while (offset < readback.length) {
          const { bytesRead } = await out.read(readback, offset, readback.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        published = await out.stat();
        if (offset !== bytes.length || published.size !== bytes.length || !bytes.equals(readback)) throw new Error('Copy verification failed');
      } finally {
        await out.close();
      }
      const rechecked = await lastCheck(source);
      if (rechecked || await safePath(source.root, key) !== target || !sameVaultVersion(published, await statPath(target))) {
        const failure = rechecked ?? failed('conflict');
        if (!(await statPath(source.path))?.isFile()) return { ...failure, residualPath: key };
        if (!await removeOwnedFile(target, created, true)) return { ...failure, residualPath: key };
        return failure;
      }
      await unlink(source.path);
      version = fileVersion(published);
    } catch (error) {
      if (created) {
        if (!await statPath(source.path).then((file) => file?.isFile(), () => false)) {
          return { ...failed('recycle-io'), residualPath: key };
        }
        if (!await removeOwnedFile(target, created, true)) return { ...failed('recycle-io'), residualPath: key };
      } else if (hasCode(error, 'EEXIST')) return failed('occupied');
      return failed('recycle-io');
    }
    this.onWrite();
    return { ok: true, ...version };
  }
}

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { canSetStatus } from '../../shared/vault-actions';
import type { FileVersion, RecycledEntry, VaultRecycleResult, VaultStatusUpdate, VaultWriteFailure, VaultWriteResult } from '../../shared/types';
import type { ProfileEditResult, ProfileEditVersion, ProfileSaveResult } from '../../shared/types';
import { entryFromFile } from './entry';
import { memoryPath, sameVaultVersion } from './scan';
import { editStatusLine } from './status-line';
import { buildProfileBytes, editPlaceholders, profilePath, restorePlaceholders, splitProfileBytes } from './profile-content';

const recyclePrefix = '_回收/';
const renameDelays = [25, 50, 100, 200];
const shelfFolder = /^(?:cases|knowledge|preferences|meetings)\//i;

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

function profileVersion(stat: Stats, editToken: string): ProfileEditVersion {
  const identity = createHash('sha256').update([stat.dev, stat.ino, stat.ctimeMs, stat.mode].join(':')).digest('hex');
  return { ...fileVersion(stat), identity, editToken };
}

function validProfileVersion(value: unknown): value is ProfileEditVersion {
  return validExpected(value) && 'identity' in value && typeof value.identity === 'string' && /^[a-f0-9]{64}$/.test(value.identity) &&
    'editToken' in value && typeof value.editToken === 'string' && /^[a-f0-9-]{36}$/.test(value.editToken);
}

function removalsFromOptions(options: unknown): number[] | null {
  if (options === undefined) return [];
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  if (!('acknowledgedRemovals' in options) || options.acknowledgedRemovals === undefined) return [];
  const removals = options.acknowledgedRemovals;
  if (!Array.isArray(removals)) return null;
  const unique = new Set(removals);
  return unique.size === removals.length && [...unique].every((value) => Number.isSafeInteger(value) && value > 0)
    ? removals : null;
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

interface ProfileDraft {
  key: string;
  paths: Map<string, string>;
  appendixSize: number;
  stat: Stats;
  version: ProfileEditVersion;
}

type FindProfile = (nodeId: string) => Promise<string | undefined>;

async function lastCheck(source: MoveSource): Promise<VaultWriteFailure | null> {
  if (await safePath(source.root, source.key) !== source.path) return failed('conflict');
  const result = await checkedVersion(source.path, source.expected, source.stat);
  return 'ok' in result ? (result.reason === 'missing' ? failed('conflict') : result) : null;
}

export class VaultWriter {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly recycleOrigins = new Map<string, string>();
  private readonly profileDrafts = new Map<string, ProfileDraft>();

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

      const result = await this.replaceFile(source, edited);
      return 'ok' in result ? result : { ok: true, ...fileVersion(result) };
    });
  }

  readProfileForEdit(nodeId: unknown, findProfile: FindProfile): Promise<ProfileEditResult> {
    return this.run<ProfileEditResult>(async () => {
      if (typeof nodeId !== 'string' || !nodeId) return { ok: false, reason: 'invalid-input' };
      const key = profilePath(await findProfile(nodeId));
      if (!key) return failed('missing');
      const root = await realpath(this.root);
      const path = await safePath(root, key);
      const stat = path && await statPath(path);
      if (!path || !stat || !stat.isFile()) return failed('missing');
      const bytes = await readStable(path, stat);
      if (!bytes || !sameVaultVersion(stat, await statPath(path))) return failed('conflict');
      const parts = splitProfileBytes(bytes);
      if (!parts) return failed('legacy');
      if ((parts.nodeId || 'legacy:' + key) !== nodeId) return failed('conflict');
      if (parts.ambiguous) return { ok: false, reason: 'appendix-marker' };
      if (!parts.utf8) return { ok: false, reason: 'encoding' };

      const version = profileVersion(stat, randomUUID());
      const { body, paths } = editPlaceholders(parts.user.toString('utf8').replace(/\r\n/g, '\n'));
      this.profileDrafts.set(nodeId, { key, paths, appendixSize: parts.appendix.length, stat, version });
      const isArchive = key.split('/').length === 3;
      return { ok: true, body, version, isArchive,
        archiveNotice: isArchive ? '這份是封存檔，修改會在日後接回時帶進新節點。' : null };
    });
  }

  saveProfileBody(nodeId: unknown, edit: unknown, expected: unknown, findProfile: FindProfile, options?: unknown): Promise<ProfileSaveResult> {
    return this.run<ProfileSaveResult>(async () => {
      const removals = removalsFromOptions(options);
      if (typeof nodeId !== 'string' || typeof edit !== 'string' || !validProfileVersion(expected) || !removals) {
        return { ok: false, reason: 'invalid-input' };
      }
      if (/\p{Surrogate}/u.test(edit)) return { ok: false, reason: 'encoding' };
      const draft = this.profileDrafts.get(nodeId);
      if (!draft || expected.editToken !== draft.version.editToken) return { ok: false, reason: 'edit-session' };
      const stillCurrent = async () => profilePath(await findProfile(nodeId)) === draft.key;
      if (!await stillCurrent()) return failed('conflict');
      if (expected.mtime !== draft.version.mtime || expected.size !== draft.version.size || expected.identity !== draft.version.identity) {
        return failed('conflict');
      }
      const source = await prepareSource(this.root, draft.key, expected);
      if ('ok' in source) return source;
      if (!sameVaultVersion(draft.stat, source.stat)) return failed('conflict', fileVersion(source.stat));
      const original = await readStable(source.path, source.stat);
      if (!original) return failed('conflict');
      const parts = splitProfileBytes(original, draft.appendixSize);
      if (!parts) return failed('legacy');
      if ((parts.nodeId || 'legacy:' + draft.key) !== nodeId) return failed('conflict');
      if (parts.ambiguous) return { ok: false, reason: 'appendix-marker' };
      if (!parts.utf8) return { ok: false, reason: 'encoding' };
      if (!(source.stat.mode & 0o222)) return failed('readonly');
      const restored = restorePlaceholders(edit, draft.paths, removals);
      if (!restored.ok) return restored;
      const bytes = buildProfileBytes(parts, restored.body);
      if (!bytes) return { ok: false, reason: 'appendix-marker' };
      const result = await this.replaceFile(source, bytes, stillCurrent);
      if ('ok' in result) return result;

      const version = profileVersion(result, expected.editToken);
      for (const token of restored.removedTokens) draft.paths.delete(token);
      this.profileDrafts.set(nodeId, { ...draft, stat: result, version });
      return { ok: true, version };
    });
  }

  moveToRecycle(path: unknown, expected: unknown): Promise<VaultRecycleResult> {
    return this.run(async () => {
      const key = shelfKey(path);
      if (!key || !validExpected(expected)) return failed('io');
      const source = await prepareSource(this.root, key, expected);
      if ('ok' in source) return source;
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

  private run<T extends { ok: boolean }>(operation: () => Promise<T>): Promise<T | VaultWriteFailure> {
    const next = this.tail.then(operation).catch((error: unknown) => failed(hasCode(error, 'ENOENT', 'ENOTDIR') ? 'missing' : 'io'));
    this.tail = next;
    return next;
  }

  private async replaceFile(source: MoveSource, bytes: Buffer, stillCurrent?: () => Promise<boolean>): Promise<Stats | VaultWriteFailure> {
    const temporary = join(dirname(source.path), '.vault-write-' + randomUUID() + '.tmp');
    const staged = await open(temporary, 'wx', (source.stat.mode & 0o777) | 0o200);
    let identity: Stats | undefined;
    let result: Stats | VaultWriteFailure;
    try {
      try {
        identity = await staged.stat();
        await staged.writeFile(bytes);
        await staged.sync();
        identity = await staged.stat();
      } finally {
        await staged.close();
      }
      result = await this.commitFile(source, temporary, identity, stillCurrent);
    } catch {
      result = failed('io');
    }
    if ('ok' in result) {
      let cleaned = identity ? await removeOwnedFile(temporary, identity, true) : await statPath(temporary).then((file) => !file, () => false);
      if (!cleaned && identity && stillCurrent) {
        for (const wait of renameDelays) {
          await delay(wait);
          cleaned = await removeOwnedFile(temporary, identity, true);
          if (cleaned) break;
        }
      }
      if (!cleaned) return { ...result, residualPath: relative(source.root, temporary).replace(/\\/g, '/') };
    }
    return result;
  }

  private async commitFile(source: MoveSource, temporary: string, staged: Stats,
    stillCurrent?: () => Promise<boolean>): Promise<Stats | VaultWriteFailure> {
    for (let attempt = 0; ; attempt++) {
      if (stillCurrent && !await stillCurrent()) return failed('conflict');
      const invalid = await lastCheck(source);
      if (invalid) return invalid;
      try {
        // No shared lock: a console rename after lastCheck and before ours can lose a just-appended section.
        // Conversely its own check and replace can race this app's write.
        await rename(temporary, source.path);
      } catch (error) {
        if (!hasCode(error, 'EPERM', 'EBUSY', 'EACCES') || attempt >= renameDelays.length) return failed('io');
        await delay(renameDelays[attempt]);
        continue;
      }
      this.onWrite();
      const published = await statPath(source.path);
      return sameFile(staged, published) && published.size === staged.size
        ? published
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

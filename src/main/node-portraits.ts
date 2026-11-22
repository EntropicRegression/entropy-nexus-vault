import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Pictures the user assigned to a node by hand (docs/架構.md §4.2, DESIGN.md §6.5.2). They live only in the vault
 * app's own userData: the chosen file is copied into node-portraits/ under an opaque random name, so moving or
 * deleting the original does not break it, and nothing is written to the console's memory vault or its stats file.
 *
 * Index (userData/node-portraits.json): { 版本: 1, 記憶庫: { <vault key v_…>: { <node ID>: { 檔案, 版次, 指定時間 } } } }.
 * 版次 grows with every assignment and is the ?v=N of the image URL, so a new picture is fetched afresh.
 */

export const maxNodePortraitBytes = 20 * 1024 * 1024;
const extensions = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const fileName = /^[a-f0-9]{32}\.(?:png|webp|jpg|jpeg)$/;
const vaultKey = /^v_[a-f0-9]{24}$/;

export type NodePortraitFailure = 'unsupported' | 'too-large' | 'not-image' | 'io';
export interface NodePortraitEntry { file: string; revision: number }

interface StoredEntry { 檔案: string; 版次: number; 指定時間: string }
type Index = Map<string, Map<string, StoredEntry>>;

export function validPortraitNodeId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id &&
    !id.endsWith('.') && !/[/\\:*?"<>|\u0000-\u001f]/.test(id);
}

/** PNG, JPEG and WebP file signatures (the extension alone is not trusted). */
export function imageSignatureMatches(bytes: Buffer, extension: string): boolean {
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(value: unknown): Index {
  const index: Index = new Map();
  if (!isRecord(value) || value.版本 !== 1 || !isRecord(value.記憶庫)) return index;
  for (const [key, nodes] of Object.entries(value.記憶庫)) {
    if (!vaultKey.test(key) || !isRecord(nodes)) continue;
    const entries = new Map<string, StoredEntry>();
    for (const [id, entry] of Object.entries(nodes)) {
      if (!validPortraitNodeId(id) || !isRecord(entry) || typeof entry.檔案 !== 'string' || !fileName.test(entry.檔案) ||
        !Number.isSafeInteger(entry.版次) || (entry.版次 as number) < 1 || typeof entry.指定時間 !== 'string') continue;
      entries.set(id, { 檔案: entry.檔案, 版次: entry.版次 as number, 指定時間: entry.指定時間 });
    }
    if (entries.size) index.set(key, entries);
  }
  return index;
}

export class NodePortraitStore {
  private index: Index | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly userData: string) {}

  /** The folder of copied pictures (only files listed in the index are ever served). */
  get folder(): string { return join(this.userData, 'node-portraits'); }
  private get indexFile(): string { return join(this.userData, 'node-portraits.json'); }

  private async load(): Promise<Index> {
    if (this.index) return this.index;
    try {
      this.index = decode(JSON.parse(await readFile(this.indexFile, 'utf8')));
    } catch {
      this.index = new Map();
    }
    return this.index;
  }

  private async save(index: Index): Promise<void> {
    const json = { 版本: 1, 記憶庫: Object.fromEntries([...index].map(([key, nodes]) => [key, Object.fromEntries(nodes)])) };
    const temporary = this.indexFile + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(json, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, this.indexFile);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  /** Serialises changes so two quick assignments cannot lose one another. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }

  async lookup(vault: string, nodeId: string): Promise<NodePortraitEntry | null> {
    const entry = (await this.load()).get(vault)?.get(nodeId);
    return entry ? { file: join(this.folder, entry.檔案), revision: entry.版次 } : null;
  }

  /** Every node with a picture in this vault, with its revision (for building image URLs in lists). */
  async revisions(vault: string): Promise<Map<string, number>> {
    return new Map([...((await this.load()).get(vault) ?? new Map<string, StoredEntry>())].map(([id, entry]) => [id, entry.版次]));
  }

  /**
   * Copies `source` (a file the user chose in the system dialog) into the store for this node. The extension must be
   * png/webp/jpg/jpeg, the file at most 20 MiB and its signature must match; anything else is refused unchanged.
   */
  assign(vault: string, nodeId: string, source: string): Promise<{ ok: true; revision: number } | { ok: false; reason: NodePortraitFailure }> {
    return this.exclusive(async () => {
      if (!vaultKey.test(vault) || !validPortraitNodeId(nodeId)) return { ok: false, reason: 'io' } as const;
      const extension = extname(source).toLowerCase();
      if (!extensions.has(extension)) return { ok: false, reason: 'unsupported' } as const;
      let bytes: Buffer;
      try {
        const info = await lstat(source);
        if (!info.isFile()) return { ok: false, reason: 'not-image' } as const;
        if (info.size > maxNodePortraitBytes) return { ok: false, reason: 'too-large' } as const;
        const handle = await open(source, 'r');
        try {
          const size = (await handle.stat()).size;
          if (size > maxNodePortraitBytes) return { ok: false, reason: 'too-large' } as const;
          bytes = Buffer.alloc(size);
          let offset = 0;
          while (offset < size) {
            const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
          }
          bytes = bytes.subarray(0, offset);
        } finally {
          await handle.close();
        }
      } catch {
        return { ok: false, reason: 'io' } as const;
      }
      if (!bytes.length || !imageSignatureMatches(bytes, extension)) return { ok: false, reason: 'not-image' } as const;

      const index = await this.load();
      const name = randomBytes(16).toString('hex') + (extension === '.jpeg' ? '.jpg' : extension);
      try {
        await mkdir(this.folder, { recursive: true });
        await writeFile(join(this.folder, name), bytes, { flag: 'wx' });
      } catch {
        return { ok: false, reason: 'io' } as const;
      }
      const nodes = index.get(vault) ?? new Map<string, StoredEntry>();
      const previous = nodes.get(nodeId);
      const revision = (previous?.版次 ?? 0) + 1;
      nodes.set(nodeId, { 檔案: name, 版次: revision, 指定時間: new Date().toISOString() });
      index.set(vault, nodes);
      try {
        await this.save(index);
      } catch {
        // Roll back so the index and the folder stay consistent.
        if (previous) nodes.set(nodeId, previous); else nodes.delete(nodeId);
        await rm(join(this.folder, name), { force: true }).catch(() => {});
        return { ok: false, reason: 'io' } as const;
      }
      if (previous) await rm(join(this.folder, previous.檔案), { force: true }).catch(() => {});
      return { ok: true, revision } as const;
    });
  }

  /** Removes the node's picture (index entry and copied file). Clearing a node without a picture is fine. */
  clear(vault: string, nodeId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const index = await this.load();
      const nodes = index.get(vault);
      const previous = nodes?.get(nodeId);
      if (!nodes || !previous) return true;
      nodes.delete(nodeId);
      if (!nodes.size) index.delete(vault);
      try {
        await this.save(index);
      } catch {
        nodes.set(nodeId, previous);
        index.set(vault, nodes);
        return false;
      }
      await rm(join(this.folder, previous.檔案), { force: true }).catch(() => {});
      return true;
    });
  }

  /**
   * Deletes copied files that no index entry refers to (left by a crash between copy and index write). Entries of
   * nodes that are no longer in the vault are kept on purpose: archived or renamed nodes can come back, and an entry
   * for an absent node is simply never shown. The user removes a picture with 清除.
   */
  sweep(): Promise<number> {
    return this.exclusive(async () => {
      const index = await this.load();
      const used = new Set([...index.values()].flatMap((nodes) => [...nodes.values()].map((entry) => entry.檔案)));
      let removed = 0;
      for (const name of await readdir(this.folder).catch(() => [] as string[])) {
        if (used.has(name)) continue;
        await rm(join(this.folder, name), { force: true, recursive: false }).then(() => { removed++; }, () => {});
      }
      return removed;
    });
  }
}

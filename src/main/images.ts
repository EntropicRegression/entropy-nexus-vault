import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import type { VaultSnapshot } from './vault';

export interface VaultImageContext { root: string; snapshot: VaultSnapshot }
type ImageKind = 'avatar' | 'portrait';

const types = {
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
} as const;
const maxImageSize = 20 * 1024 * 1024;

function validNodeId(id: string): boolean {
  return id.length <= 128 && id.trim() === id && Boolean(id) &&
    !id.endsWith('.') && !/[/\\:*?"<>|\u0000-\u001f]/.test(id);
}

async function within(root: string, path: string): Promise<string | null> {
  if (!isAbsolute(root) || !isAbsolute(path) || dirname(root) === root) return null;
  const [actualRoot, actualPath] = await Promise.all([realpath(root), realpath(path)]);
  const child = relative(actualRoot, actualPath);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) return null;
  return actualPath;
}

function formatOf(path: string) {
  const extension = extname(path).toLowerCase() as keyof typeof types;
  return types[extension];
}

async function archiveDirectory(root: string, nodeId: string) {
  try {
    const wanted = join(await realpath(root), 'nodes', '封存', '_圖像', nodeId);
    const actual = await realpath(wanted);
    return relative(wanted, actual) === '' ? actual : null;
  } catch {
    return null;
  }
}

async function verifiedImage(root: string, path: string) {
  if (!formatOf(path)) return null;
  try {
    const canonical = await within(root, path);
    if (!canonical || formatOf(canonical) !== formatOf(path)) return null;
    const stats = await lstat(canonical);
    return stats.isFile() && stats.size > 0 && stats.size <= maxImageSize ? { path: canonical, stats } : null;
  } catch {
    return null;
  }
}

async function* nodeImageCandidates({ root, snapshot }: VaultImageContext, nodeId: string, kind: ImageKind) {
  if (!validNodeId(nodeId)) return;
  const stats = snapshot.sidecars.stats;
  const record = stats?.nodes.get(nodeId);
  if (!record && !snapshot.hasArchivedNode(nodeId)) return;
  const archive = await archiveDirectory(root, nodeId);
  const preferred = kind === 'avatar' ? record?.avatarPath : record?.portraitPath;
  if (preferred) {
    const image = (stats?.portraitsDir ? await verifiedImage(stats.portraitsDir, preferred) : null) ??
      (archive ? await verifiedImage(archive, preferred) : null);
    if (image) yield image;
  }

  if (!archive) return;
  for (const ext of Object.keys(types)) {
    const image = await verifiedImage(archive, join(archive, kind + ext));
    if (image) yield image;
  }
}

export async function avatarUrl(context: VaultImageContext, nodeId: string): Promise<string | null> {
  const first = await nodeImageCandidates(context, nodeId, 'avatar').next();
  return first.done ? null : 'vault-image://node/' + encodeURIComponent(nodeId) + '/avatar';
}

function matchesImageFormat(bytes: Buffer, type: string): boolean {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

type ImageCandidate = NonNullable<Awaited<ReturnType<typeof verifiedImage>>>;

async function readCandidate(image: ImageCandidate): Promise<Response | null> {
  try {
    const handle = await open(image.path, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.dev !== image.stats.dev || stats.ino !== image.stats.ino || stats.size !== image.stats.size) return null;
      const bytes = Buffer.alloc(stats.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) return null;
        offset += bytesRead;
      }
      const after = await handle.stat();
      const type = formatOf(image.path);
      if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs || !matchesImageFormat(bytes, type)) return null;
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      } });
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function serveNodeImage(request: Request, getContext: () => Promise<VaultImageContext>): Promise<Response> {
  const notFound = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return notFound();
  try {
    const url = new URL(request.url);
    const route = /^\/([^/]+)\/(avatar|portrait)$/.exec(url.pathname);
    if (url.protocol !== 'vault-image:' || url.host !== 'node' || url.username || url.password || url.search || url.hash || !route) {
      return notFound();
    }
    const nodeId = decodeURIComponent(route[1]);
    if (!validNodeId(nodeId)) return notFound();
    for await (const candidate of nodeImageCandidates(await getContext(), nodeId, route[2] as ImageKind)) {
      const response = await readCandidate(candidate);
      if (response) return response;
    }
    return notFound();
  } catch {
    return notFound();
  }
}

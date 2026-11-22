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

async function* imageVariants(root: string, stem: string) {
  for (const ext of Object.keys(types)) {
    const image = await verifiedImage(root, stem + ext);
    if (image) yield image;
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

  if (archive) yield* imageVariants(archive, join(archive, kind));
}

async function imageUrl(context: VaultImageContext, nodeId: string, kind: ImageKind): Promise<string | null> {
  for await (const _candidate of nodeImageCandidates(context, nodeId, kind)) {
    return 'vault-image://node/' + encodeURIComponent(nodeId) + '/' + kind;
  }
  return null;
}

export const avatarUrl = (context: VaultImageContext, nodeId: string) => imageUrl(context, nodeId, 'avatar');
export const portraitUrl = (context: VaultImageContext, nodeId: string) => imageUrl(context, nodeId, 'portrait');

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

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function serveNodeImage(request: Request, getContext: () => Promise<VaultImageContext>): Promise<Response> {
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

/**
 * vault-image://manual/<node ID>?v=N: the picture the user assigned to a node (DESIGN.md §6.5.2). The URL carries only
 * the node ID; the main process looks it up in its own index and serves only that copied file from the app's
 * node-portraits folder (no other path can be reached). ?v=N only changes the cache key.
 */
async function serveManualImage(request: Request, nodeIdText: string,
  readManualPortrait: (nodeId: string) => Promise<{ folder: string; file: string } | null>): Promise<Response> {
  let nodeId: string;
  try {
    nodeId = decodeURIComponent(nodeIdText);
  } catch {
    return notFound();
  }
  if (!validNodeId(nodeId)) return notFound();
  const entry = await readManualPortrait(nodeId);
  if (!entry) return notFound();
  const image = await verifiedImage(entry.folder, entry.file);
  return (image && await readCandidate(image)) || notFound();
}

export async function serveVaultImage(
  request: Request,
  { readVaultContext, readBrandPortraitFolder, readManualPortrait }: {
    readVaultContext: () => Promise<VaultImageContext>;
    readBrandPortraitFolder: () => Promise<string | null>;
    readManualPortrait?: (nodeId: string) => Promise<{ folder: string; file: string } | null>;
  },
): Promise<Response> {
  if (request.method !== 'GET') return notFound();
  const manual = /^vault-image:\/\/manual\/([^/?#]+)(?:\?v=[1-9][0-9]*)?$/.exec(request.url);
  if (manual) {
    try {
      return readManualPortrait ? await serveManualImage(request, manual[1], readManualPortrait) : notFound();
    } catch {
      return notFound();
    }
  }
  // Match the whole URL. The optional version changes the image cache key and never enters filesystem resolution.
  const brand = /^vault-image:\/\/brand\/(claude|codex|gemini)\/(active|dormant)(?:\?v=[1-9][0-9]*)?$/.exec(request.url);
  if (!brand) return serveNodeImage(request, readVaultContext);
  try {
    const folder = await readBrandPortraitFolder();
    if (!folder || !isAbsolute(folder)) return notFound();
    const [, vendor, state] = brand;
    for await (const candidate of imageVariants(folder, join(folder, vendor, state))) {
      const response = await readCandidate(candidate);
      if (response) return response;
    }
  } catch {
    return notFound();
  }
  return notFound();
}

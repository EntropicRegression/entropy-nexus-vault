import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const appScheme = 'vault-app';
export const imageScheme = 'vault-image';
export const appUrl = `${appScheme}://app/index.html`;

const assetTypes: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' ${imageScheme}:`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export async function serveAppAsset(request: Request, rendererDir: string): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  const url = new URL(request.url);
  if (url.protocol !== `${appScheme}:` || url.host !== 'app' || url.username || url.password) {
    return new Response(null, { status: 404 });
  }

  let contentType: string | undefined;
  if (url.pathname === '/index.html') {
    contentType = 'text/html; charset=utf-8';
  } else if (/^\/assets\/[a-z0-9][a-z0-9._-]*$/i.test(url.pathname)) {
    contentType = assetTypes[extname(url.pathname)];
  }
  if (!contentType) return new Response(null, { status: 404 });

  try {
    const bytes = await readFile(join(rendererDir, url.pathname.slice(1)));
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': contentType,
        'Content-Security-Policy': contentSecurityPolicy,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appUrl, serveAppAsset } from './app-assets';

const rendererDir = resolve('src/renderer');

describe('本機介面資源協定', () => {
  it('回傳本機文件及限制資源來源的 CSP', async () => {
    const response = await serveAppAsset(new Request(appUrl), rendererDir);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' vault-image:");
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await response.text()).toContain('Entropy Nexus Vault');
  });

  it.each(['vault-app://other/index.html', 'vault-app://app/main.tsx', 'vault-app://app/assets/missing.js'])(
    '找不到或不供應資源時回傳 404 (%s)',
    async (url) => {
      const response = await serveAppAsset(new Request(url), rendererDir);

      expect(response.status).toBe(404);
    },
  );
});

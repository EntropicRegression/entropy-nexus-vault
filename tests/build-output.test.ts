import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { checkProductionBuild } = require('../scripts/verify-production-build.cjs') as {
  checkProductionBuild: (outDir: string) => string[];
};
const { inspectPayload } = require('../scripts/verify-packaged-app.cjs') as {
  inspectPayload: (appDir: string, projectDir: string) => { problems: string[]; graphics: string[]; fonts: Record<string, number> };
};
const { createPackage } = require('@electron/asar') as { createPackage: (source: string, destination: string) => Promise<void> };
const packageJson = require('../package.json') as { scripts: Record<string, string>; main: string };

const scratch: string[] = [];
async function fakeBuild(rendererCode: string) {
  const root = await mkdtemp(join(tmpdir(), 'vault-build-check-'));
  scratch.push(root);
  await mkdir(join(root, 'main'), { recursive: true });
  await mkdir(join(root, 'preload'), { recursive: true });
  await mkdir(join(root, 'renderer', 'assets'), { recursive: true });
  await writeFile(join(root, 'main', 'index.js'), 'module.exports = {};');
  await writeFile(join(root, 'preload', 'index.js'), '');
  await writeFile(join(root, 'renderer', 'index.html'), '<!doctype html>');
  await writeFile(join(root, 'renderer', 'assets', 'index.js'), rendererCode);
  return root;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('打包前的正式建置檢查(M5b 審查 S7)', () => {
  it('正式建置通過', async () => {
    expect(checkProductionBuild(await fakeBuild('console.log(1)'))).toEqual([]);
  });

  it('CSS 內嵌 data: 圖片會被拒絕(App 的 CSP 只允許同源與 vault-image: 圖片;M5g)', async () => {
    const root = await fakeBuild('console.log(1)');
    await writeFile(join(root, 'renderer', 'assets', 'index.css'), ':root{--paper-tex:url("data:image/svg+xml,%3Csvg%3E")}');
    expect(checkProductionBuild(root)).toEqual([join('renderer', 'assets', 'index.css') + ' 含 data: 圖片(會被 CSP 擋下)']);
    await writeFile(join(root, 'renderer', 'assets', 'index.css'), ':root{--paper-tex:url(./paper-grain-abc.svg)}');
    expect(checkProductionBuild(root)).toEqual([]);
  });

  it('含驗收時鐘的開發模式產物被拒絕', async () => {
    const problems = checkProductionBuild(await fakeBuild('window.__floorClock = createAcceptanceClock();'));
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/__floorClock/);
    expect(problems.join('\n')).toMatch(/createAcceptanceClock/);
  });

  it('沒有建置或缺入口檔時拒絕', async () => {
    expect(checkProductionBuild(join(tmpdir(), 'vault-build-check-missing'))[0]).toMatch(/找不到建置輸出/);
    const root = await fakeBuild('');
    await rm(join(root, 'main'), { recursive: true });
    expect(checkProductionBuild(root)).toEqual(['建置輸出缺少 main/index.js']);
    await mkdir(join(root, 'main'), { recursive: true });
    await writeFile(join(root, 'main', 'index.js'), '');
    await rm(join(root, 'preload', 'index.js'));
    expect(checkProductionBuild(root)).toEqual(['建置輸出缺少 preload/index.js']);
  });

  it('開發版輸出到 out-dev,正式版先清空 out,打包前一定檢查', () => {
    expect(packageJson.scripts.dev).toContain('--mode development --outDir out-dev');
    expect(packageJson.scripts.dev).toContain('--entry out-dev/main/index.js');
    expect(packageJson.scripts.build).toMatch(/rmSync\('out'/);
    expect(packageJson.scripts.build).not.toContain('development');
    expect(packageJson.scripts.dist).toMatch(/npm run build && npm run verify:build && electron-builder/);
    expect(packageJson.main).toBe('./out/main/index.js');
  });
});

describe('正式打包的 ASAR 與字型授權', () => {
  const families = ['noto-serif-tc', 'noto-sans-tc', 'jetbrains-mono'];

  async function packed(extra: Record<string, string> = {}, includeLicense = true) {
    const root = await mkdtemp(join(tmpdir(), 'vault-package-check-'));
    scratch.push(root);
    const payload = join(root, 'app-source');
    const packageDir = join(root, 'win-unpacked');
    const resources = join(packageDir, 'resources');
    const project = join(root, 'project');
    const assetDir = 'out/renderer/assets/';
    const folder = {
      'package.json': JSON.stringify({ main: './out/main/index.js', version: '0.1.0' }),
      'out/main/index.js': '',
      'out/preload/index.js': '',
      'out/renderer/index.html': '<link href="./assets/index-x.css"><script src="./assets/index-x.js"></script>',
      [assetDir + 'library-starry-xyz.png']: 'synthetic background',
      [assetDir + 'constellation-abc.svg']: '<svg />',
      [assetDir + 'paper-grain-def.svg']: '<svg>grain</svg>',
      [assetDir + 'crystal-ring-mask-ghi.svg']: '<svg>ring</svg>',
      [assetDir + 'meeting-coil-jkl.svg']: '<svg>coil</svg>',
      [assetDir + 'memoir-binding-mno.svg']: '<svg>binding</svg>',
      [assetDir + 'index-x.css']: 'a{background:url(/assets/library-starry-xyz.png)}b{background:url(/assets/paper-grain-def.svg)}c{mask:url(/assets/crystal-ring-mask-ghi.svg)}d{background:url(/assets/meeting-coil-jkl.svg)}e{background:url(/assets/memoir-binding-mno.svg)}',
      [assetDir + 'index-x.js']: 'const fallback="/assets/constellation-abc.svg";',
      ...Object.fromEntries(families.map((name) => [assetDir + name + '-x.woff2', 'wOF2 synthetic header'])),
      ...extra,
    };
    async function write(base: string, files: Record<string, string>) {
      for (const [key, value] of Object.entries(files)) {
        const target = join(base, key);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, value);
      }
    }
    await write(payload, folder);
    await write(project, {
      'assets/bg/library-starry.png': 'synthetic background',
      'assets/ui/constellation.svg': '<svg />',
      'assets/ui/paper-grain.svg': '<svg>grain</svg>',
      'assets/ui/crystal-ring-mask.svg': '<svg>ring</svg>',
      'assets/ui/meeting-coil.svg': '<svg>coil</svg>',
      'assets/ui/memoir-binding.svg': '<svg>binding</svg>',
      ...Object.fromEntries(families.map((name) => ['node_modules/@fontsource-variable/' + name + '/LICENSE', 'license ' + name])),
    });
    await write(resources, Object.fromEntries(families.filter((name) => includeLicense || name !== families[0])
      .map((name) => ['licenses/' + name + '.txt', 'license ' + name])));
    if (!includeLicense) await writeFile(join(resources, 'default_app.asar'), 'unexpected Electron development shell');
    await createPackage(payload, join(resources, 'app.asar'));
    return inspectPayload(packageDir, project);
  }

  it('確認 ASAR 入口、圖像、三種字型與原始授權', async () => {
    expect(await packed()).toMatchObject({
      problems: [],
      graphics: expect.arrayContaining([expect.stringContaining('library-starry'), expect.stringContaining('constellation'), expect.stringContaining('paper-grain'), expect.stringContaining('crystal-ring-mask'), expect.stringContaining('meeting-coil'), expect.stringContaining('memoir-binding')]),
      fonts: { 'noto-serif-tc': 1, 'noto-sans-tc': 1, 'jetbrains-mono': 1 },
    });
  });

  it('拒絕開發標記、漏資源、改名的圖像與混入的測試或非建置目錄', async () => {
    const result = await packed({
      'out/renderer/assets/index-x.js': 'window.__floorClock = createAcceptanceClock(); const asset = "/assets/missing.png";',
      'out/renderer/assets/constellation-abc.svg': '<svg>unexpected content</svg>',
      'out/renderer/assets/unexpected.png': 'synthetic extra picture',
      'out/main/unsafe.test.js': '',
      'fixtures/memory-vault/extra.md': '',
      'docs/an-extra-file.md': '',
    }, false);
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.stringContaining('__floorClock'),
      expect.stringContaining('createAcceptanceClock'),
      expect.stringContaining('引用缺少的資源 missing.png'),
      expect.stringContaining('圖像與 repo 素材不符'),
      expect.stringContaining('未列入正式介面的圖像'),
      expect.stringContaining('unsafe.test.js'),
      expect.stringContaining('fixtures/memory-vault/extra.md'),
      expect.stringContaining('docs/an-extra-file.md'),
      expect.stringContaining('缺少或改動了字型授權 noto-serif-tc'),
      expect.stringContaining('default_app.asar'),
    ]));
  });
});

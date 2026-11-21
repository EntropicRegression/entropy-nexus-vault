import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { checkProductionBuild } = require('../scripts/verify-production-build.cjs') as {
  checkProductionBuild: (outDir: string) => string[];
};
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

import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readVaultPath, saveVaultPath } from './settings';

describe('記憶庫位置設定', () => {
  let directory: string;
  let settingsFile: string;
  let defaultPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'entropy-vault-settings-'));
    settingsFile = join(directory, 'settings.json');
    defaultPath = join(directory, 'default-vault');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('設定檔不存在或損毀時使用預設位置', async () => {
    expect(await readVaultPath(settingsFile, defaultPath)).toBe(defaultPath);
    await writeFile(settingsFile, '{');
    expect(await readVaultPath(settingsFile, defaultPath)).toBe(defaultPath);
  });

  it('儲存並更新絕對路徑，清理暫存檔', async () => {
    const firstChoice = join(directory, 'vault-one');
    const secondChoice = join(directory, 'vault-two');

    await saveVaultPath(settingsFile, firstChoice);
    expect(await readVaultPath(settingsFile, defaultPath)).toBe(firstChoice);
    await saveVaultPath(settingsFile, secondChoice);

    expect(await readVaultPath(settingsFile, defaultPath)).toBe(secondChoice);
    expect(await readdir(directory)).toEqual(['settings.json']);
  });
});

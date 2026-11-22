import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBrandPortraitPath, readVaultPath, readViewSettings, saveBrandPortraitPath, saveVaultPath, saveViewSettings } from './settings';

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

  it('立繪設定預設停用、隔離開發與正式設定，且不覆蓋記憶庫與介面設定', async () => {
    const devSettings = join(directory, 'settings.dev.json');
    const art = join(directory, 'synthetic-art');
    expect(await readBrandPortraitPath(settingsFile)).toBeNull();
    await writeFile(settingsFile, '{"brandPortraitPath":"relative-path"}');
    expect(await readBrandPortraitPath(settingsFile)).toBeNull();
    await expect(saveBrandPortraitPath(settingsFile, 'relative-path')).rejects.toThrow('資料夾的路徑無效');
    await Promise.all([
      saveVaultPath(settingsFile, defaultPath),
      saveViewSettings(settingsFile, { deskMode: 'B', reducedMotion: true }),
      saveBrandPortraitPath(settingsFile, art),
    ]);
    expect(await readBrandPortraitPath(settingsFile)).toBe(art);
    expect(await readBrandPortraitPath(devSettings)).toBeNull();
    expect(await readVaultPath(settingsFile, 'fallback')).toBe(defaultPath);
    expect(await readViewSettings(settingsFile)).toEqual({ deskMode: 'B', reducedMotion: true });

    expect(await saveBrandPortraitPath(settingsFile, null)).toEqual({ configured: false, label: null });
    expect(await readBrandPortraitPath(settingsFile)).toBeNull();
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      brandPortraitPath: null, vaultPath: defaultPath, deskMode: 'B', reducedMotion: true,
    });
    expect(await readdir(directory)).toEqual(['settings.json']);
  });
});

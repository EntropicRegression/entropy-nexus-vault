import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export async function readVaultPath(settingsFile: string, defaultPath: string): Promise<string> {
  try {
    const settings: unknown = JSON.parse(await readFile(settingsFile, 'utf8'));
    if (settings && typeof settings === 'object' && 'vaultPath' in settings &&
        typeof settings.vaultPath === 'string' && isAbsolute(settings.vaultPath)) {
      return settings.vaultPath;
    }
  } catch {
    // Missing or unreadable settings use the default until the user chooses a folder.
  }
  return defaultPath;
}

export async function saveVaultPath(settingsFile: string, vaultPath: string): Promise<void> {
  const temporaryFile = `${settingsFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify({ vaultPath }, null, 2) + '\n', { flag: 'wx' });
    await rename(temporaryFile, settingsFile);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => {});
  }
}

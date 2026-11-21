import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ViewSettings } from '../shared/types';

const writes = new Map<string, Promise<unknown>>();

async function readSettings(settingsFile: string): Promise<Record<string, unknown>> {
  try {
    const settings: unknown = JSON.parse(await readFile(settingsFile, 'utf8'));
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) return settings as Record<string, unknown>;
  } catch {
    // Missing or unreadable settings use the default until the user chooses a folder.
  }
  return {};
}

export async function readVaultPath(settingsFile: string, defaultPath: string): Promise<string> {
  const { vaultPath } = await readSettings(settingsFile);
  return typeof vaultPath === 'string' && isAbsolute(vaultPath) ? vaultPath : defaultPath;
}

function viewSettings(settings: Record<string, unknown>): ViewSettings {
  return { deskMode: settings.deskMode === 'B' ? 'B' : 'A', reducedMotion: settings.reducedMotion === true };
}

export async function readViewSettings(settingsFile: string): Promise<ViewSettings> {
  return viewSettings(await readSettings(settingsFile));
}

async function writeSettings(settingsFile: string, settings: Record<string, unknown>): Promise<void> {
  const temporaryFile = `${settingsFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx' });
    await rename(temporaryFile, settingsFile);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => {});
  }
}

async function updateSettings(settingsFile: string, patch: Record<string, unknown>) {
  const previous = writes.get(settingsFile);
  const next = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
    const settings = { ...await readSettings(settingsFile), ...patch };
    await writeSettings(settingsFile, settings);
    return settings;
  });
  writes.set(settingsFile, next);
  try {
    return await next;
  } finally {
    if (writes.get(settingsFile) === next) writes.delete(settingsFile);
  }
}

export async function saveVaultPath(settingsFile: string, vaultPath: string): Promise<void> {
  await updateSettings(settingsFile, { vaultPath });
}

export async function saveViewSettings(settingsFile: string, input: unknown): Promise<ViewSettings> {
  const patch: Partial<ViewSettings> = {};
  if (input && typeof input === 'object') {
    if ('deskMode' in input && (input.deskMode === 'A' || input.deskMode === 'B')) patch.deskMode = input.deskMode;
    if ('reducedMotion' in input && typeof input.reducedMotion === 'boolean') patch.reducedMotion = input.reducedMotion;
  }
  if (Object.keys(patch).length === 0) return readViewSettings(settingsFile);
  return viewSettings(await updateSettings(settingsFile, patch));
}

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from './index';

const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const file = (fields: string[], body = '合成內容。') => ['---', ...fields, '---', '', body, ''].join('\n');

describe('典藏回憶:節點寫的典藏卷宗如何判定(DESIGN.md §6.6.4)', () => {
  it('只認結構化欄位:節點ID=撰寫、參與節點ID=參與;來源節點等自由文字不算;只限典藏書架;被取代的舊版不列;新的在前', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nexus-archive-entries-'));
    scratch.push(root);
    await cp(resolve('fixtures/sky-vault'), root, { recursive: true });
    const id = 'fixture-sky-iris';
    const project = (name: string) => join(root, 'knowledge', '合成觀測站', name);
    await mkdir(join(root, 'knowledge', '合成觀測站'), { recursive: true });
    await mkdir(join(root, 'preferences'), { recursive: true });
    await writeFile(project('撰寫的知識.md'), file(['種類: knowledge', '範圍: 專案', '專案: 合成觀測站', '標題: 撰寫的知識', '狀態: 已確認',
      '節點ID: ' + id, '更新時間: 2026-11-20 10:00:00']));
    await writeFile(join(root, 'preferences', '參與的偏好.md'), file(['種類: preference', '標題: 參與的偏好', '節點ID: someone-else',
      '參與節點ID: [' + id + ']', '更新時間: 2026-11-21 10:00:00']));
    // Only free text names the node: not counted (no guessing from 來源節點 or names).
    await writeFile(project('只在來源節點提到.md'), file(['種類: knowledge', '標題: 只在來源節點提到', '狀態: 已確認',
      '來源節點: 稜鏡(Claude Code · synthetic)', '更新時間: 2026-11-22 10:00:00'], '稜鏡寫過這段。'));
    // Not on the archive shelf (decision), and a replaced old version: not listed.
    await writeFile(project('決策.md'), file(['種類: knowledge', '標題: 決策', '子類: 決策', '狀態: 已確認', '節點ID: ' + id]));
    await writeFile(project('舊版.md'), file(['種類: knowledge', '標題: 舊版', '狀態: 已確認', '節點ID: ' + id, '更新時間: 2026-11-01 10:00:00']));
    await writeFile(project('新版.md'), file(['種類: knowledge', '標題: 新版', '狀態: 已確認', '節點ID: ' + id,
      '取代: "[[knowledge/合成觀測站/舊版.md]]"', '更新時間: 2026-11-19 10:00:00']));

    const snapshot = await new VaultReader(root).read();
    const detail = await snapshot.readCrystal(id);
    const listed = detail!.archiveEntries!.map((entry) => [entry.title, entry.nodeId === id ? '撰寫' : '參與']);
    expect(listed).toEqual([['參與的偏好', '參與'], ['撰寫的知識', '撰寫'], ['新版', '撰寫']]);
    expect(detail!.archiveEntries!.every((entry) => entry.shelf === 'archive')).toBe(true);
    // Another node sees only its own.
    expect((await snapshot.readCrystal('fixture-sky-quill'))!.archiveEntries).toEqual([]);
  });
});

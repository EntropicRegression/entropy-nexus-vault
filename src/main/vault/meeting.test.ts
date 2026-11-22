import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from './frontmatter';
import { meetingInfo, parseMeetingTranscript } from './meeting';

const header = (lines: string[]) => parseFrontMatter(['---', ...lines, '---', ''].join('\n')).attributes;

describe('會議紀錄檔頭', () => {
  it('解析欄位、時間與產出連結;參與者與ID等長才按位置配對', () => {
    const info = meetingInfo(header([
      '種類: 會議紀錄', '主題: 合成主題', '輪數: 3', '開始: 2026-11-22T10:00:00.000Z', '結束: 2026-11-22T10:30:00.000Z',
      '主持人: 甲', '參與節點ID:', '  - n1', '  - n2', '參與者:', '  - "甲"', '  - "乙"',
      '結束原因: 逾時', '產出:', '  - "[[knowledge/合成專案/決策一]]"', '  - [[knowledge\\合成專案\\決策二.md|別名]]', '  - [[沒有資料夾]]',
    ]), true, 'fallback');
    expect(info).toEqual({
      topic: '合成主題', rounds: 3, startedAt: Date.parse('2026-11-22T10:00:00.000Z'), endedAt: Date.parse('2026-11-22T10:30:00.000Z'),
      hostName: '甲', participants: [{ nodeId: 'n1', name: '甲' }, { nodeId: 'n2', name: '乙' }], endReason: '逾時', hasConclusion: true,
      outputs: ['knowledge/合成專案/決策一.md', 'knowledge/合成專案/決策二.md'],
    });
  });

  it('清單長度不同時名稱留空,缺欄位給 null', () => {
    const info = meetingInfo(header(['參與節點ID: [n1, n2]', '參與者: ["只有一個"]', '結束原因: 亂寫']), false, '檔名');
    expect(info.participants).toEqual([{ nodeId: 'n1', name: '' }, { nodeId: 'n2', name: '' }]);
    expect(info).toMatchObject({ topic: '檔名', rounds: null, startedAt: null, endedAt: null, endReason: null, outputs: [], hostName: '' });
  });

  it('中止', () => {
    expect(meetingInfo(header(['結束原因: 中止']), false, 'x').endReason).toBe('中止');
  });
});

describe('逐字稿解析', () => {
  const rounds = [
    '## 第 1 輪', '', '### 甲 · n1', '> 你好', '>', '> > 內層引用', '', '### 主控台 · -', '> 開場', '',
    '## 第 2 輪', '### 乙 · n2', '> ## 發言裡的標題', '> ### x · y', '> ```', '> ## 程式碼裡', '> ```', '> | a | b |', '',
  ];
  const full = ['## 結論', '> 第一段結論。', '>', '> 第二段。', '', ...rounds].join('\n');

  it('結論、各輪、發言;只剝一層引用,內層引用與空行保留;主控台沒有節點ID', () => {
    const result = parseMeetingTranscript(full);
    expect(result.problems).toEqual([]);
    expect(result.conclusion).toBe('第一段結論。\n\n第二段。');
    expect(result.rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(result.rounds[0].speeches).toEqual([
      { name: '甲', nodeId: 'n1', text: '你好\n\n> 內層引用' },
      { name: '主控台', nodeId: null, text: '開場' },
    ]);
    expect(result.rounds[1].speeches).toEqual([
      { name: '乙', nodeId: 'n2', text: '## 發言裡的標題\n### x · y\n```\n## 程式碼裡\n```\n| a | b |' },
    ]);
  });

  it('沒有結論、CRLF', () => {
    const result = parseMeetingTranscript(rounds.join('\r\n'));
    expect(result.conclusion).toBeNull();
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0].speeches[0].text).toBe('你好\n\n> 內層引用');
    expect(result.problems).toEqual([]);
  });

  it('結構錯亂時記錄問題而不丟例外', () => {
    const result = parseMeetingTranscript([
      '### 沒有輪次 · n1', '> 先說', '## 神秘章節', '> 孤兒', '## 第 1 輪', '> 沒標題的引用', '### 缺少ID', '> x', '雜訊', '## 結論', '',
    ].join('\n'));
    expect(result.conclusion).toBeNull();
    expect(result.rounds.map((round) => round.round)).toEqual([0, 1]);
    expect(result.problems.length).toBeGreaterThanOrEqual(4);
    expect(parseMeetingTranscript('')).toEqual({ conclusion: null, rounds: [], problems: [] });
  });
});

describe('逐字稿的異常結構(審查補測)', () => {
  it('結論內的發言標題:那則發言整段略過,不併進結論', () => {
    const result = parseMeetingTranscript(['## 結論', '> 結語', '### 甲 · a', '> 不該進結論', '## 第 1 輪', '### 乙 · b', '> 正常'].join('\n'));
    expect(result.conclusion).toBe('結語');
    expect(result.rounds).toEqual([{ round: 1, speeches: [{ name: '乙', nodeId: 'b', text: '正常' }] }]);
    expect(result.problems.join()).toContain('結論章節內出現發言標題');
  });

  it('引用外的 # 與 #### 結束目前的發言,之後的引用不算前一位發言者的', () => {
    const result = parseMeetingTranscript(['## 第 1 輪', '### 甲 · a', '> 甲說', '#### 雜訊', '> 孤兒', '# 標題', '> 又一行'].join('\n'));
    expect(result.rounds[0].speeches[0].text).toBe('甲說');
    expect(result.problems.join()).toContain('2 行引用文字不屬於任何發言');
  });

  it('無法辨認的 ## 底下的發言略過,不誤報「第 N 輪之前」,也不重複開第 0 輪', () => {
    const result = parseMeetingTranscript(['### 甲 · a', '> 一', '### 乙 · b', '> 二', '## 第 1 輪', '### 丙 · c', '> 三', '## 備註', '### 丁 · d', '> 四'].join('\n'));
    expect(result.rounds.map((round) => [round.round, round.speeches.map((speech) => speech.name)])).toEqual([[0, ['甲', '乙']], [1, ['丙']]]);
    expect(result.problems.filter((problem) => problem.includes('第 N 輪」之前'))).toHaveLength(1);
    expect(result.problems.join()).toContain('備註');
  });

  it('參與節點ID 寫成一般字串時,和卡片一樣以逗號拆開', () => {
    const info = meetingInfo(header(['參與節點ID: a, b', '參與者: [甲, 乙]']), false, 'x');
    expect(info.participants).toEqual([{ nodeId: 'a', name: '甲' }, { nodeId: 'b', name: '乙' }]);
  });
});

describe('主控台 dd820f4 格式', () => {
  it('引號內的全形逗號與頓號不切分;沒加引號的全形逗號仍會切分(主控台已一律加引號)', () => {
    const info = meetingInfo(header(['參與節點ID: ["a", "b", "c"]', '參與者: ["甲，副手", "乙、二號", "丙"]']), false, 'x');
    expect(info.participants).toEqual([{ nodeId: 'a', name: '甲，副手' }, { nodeId: 'b', name: '乙、二號' }, { nodeId: 'c', name: '丙' }]);
    expect(meetingInfo(header(['參與節點ID: [a, b]', '參與者: [甲，副手, 乙]']), false, 'x').participants.map((p) => p.name)).toEqual(['', '']);
  });
});

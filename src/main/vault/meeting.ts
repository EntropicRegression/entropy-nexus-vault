import type { FrontMatterValue, MeetingInfo, MeetingParticipant, MeetingSpeech, MeetingTranscript } from '../../shared/types';
import { memoryPath } from './scan';

type Attributes = ReadonlyMap<string, FrontMatterValue>;

const reasons = ['完成', '中止', '逾時'] as const;

/** A list attribute; a plain string is split like entry.ts splits 參與節點ID (so both agree on the IDs). */
function list(value: FrontMatterValue | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : value.split(/[,，、]/)).map((item) => item.trim()).filter(Boolean);
}

function firstText(attributes: Attributes, ...keys: string[]): string {
  for (const key of keys) {
    const value = attributes.get(key);
    const text = Array.isArray(value) ? value.join('、').trim() : value?.trim();
    if (text) return text;
  }
  return '';
}

function time(text: string): number | null {
  const value = Date.parse(text.replace(' ', 'T'));
  return Number.isFinite(value) ? value : null;
}

/** 參與節點ID and 參與者 are paired by position only when both lists have the same length; otherwise names stay ''. */
export function pairParticipants(ids: string[], names: string[]): MeetingParticipant[] {
  const paired = ids.length === names.length;
  return ids.map((nodeId, index) => ({ nodeId, name: paired ? names[index] : '' }));
}

/** `產出` links ([[knowledge/專案/決策]]) as vault-relative `.md` paths; anything that is not a vault path is dropped. */
export function meetingOutputs(value: FrontMatterValue | undefined): string[] {
  const paths = new Set<string>();
  for (const text of list(value)) {
    for (const match of text.matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)) {
      const target = match[1].split('|', 1)[0].trim().replace(/\\/g, '/').replace(/^\.?\//, '');
      const path = memoryPath(/\.md$/i.test(target) ? target : target + '.md');
      if (path) paths.add(path);
    }
  }
  return [...paths];
}

/** Header facts of a meeting transcript (記憶設計討論 第五輪 §2). */
export function meetingInfo(attributes: Attributes, hasConclusion: boolean, fallbackTopic: string): MeetingInfo {
  const rounds = Number(firstText(attributes, '輪數', 'rounds'));
  const reason = firstText(attributes, '結束原因', 'endReason');
  return {
    topic: firstText(attributes, '主題', 'topic') || fallbackTopic,
    rounds: Number.isSafeInteger(rounds) && rounds >= 0 && firstText(attributes, '輪數', 'rounds') ? rounds : null,
    startedAt: time(firstText(attributes, '開始', 'startedAt')),
    endedAt: time(firstText(attributes, '結束', 'endedAt')),
    hostName: firstText(attributes, '主持人', 'host'),
    participants: pairParticipants(list(attributes.get('參與節點ID') ?? attributes.get('participantNodeIds')),
      list(attributes.get('參與者') ?? attributes.get('participants'))),
    endReason: reasons.find((item) => item === reason) ?? null,
    hasConclusion,
    outputs: meetingOutputs(attributes.get('產出')),
  };
}

const quoted = /^ {0,3}>(?: ?)(.*)$/;
const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

function trimBlank(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end).join('\n');
}

/**
 * Parses the transcript body (記憶設計討論 第五輪 §3). Only headings outside `> ` quote blocks are structure; exactly
 * one outer `> ` layer is removed from every quoted line. Never throws: structure it cannot follow is recorded in
 * `problems`. Speeches that appear before any `## 第 N 輪` heading are kept in a round numbered 0.
 */
export function parseMeetingTranscript(markdown: string): MeetingTranscript {
  const problems: string[] = [];
  const result: MeetingTranscript = { conclusion: null, rounds: [], problems };
  const conclusion: string[] = [];
  // skip: under an unrecognised `##` (or a speech heading inside 結論) until the next `##`; quoted lines are dropped.
  let section: 'none' | 'conclusion' | 'round' | 'skip' = 'none';
  let round: MeetingTranscript['rounds'][number] | undefined;
  let speech: { speech: MeetingSpeech; lines: string[] } | undefined;
  let sawConclusion = false;
  let stray = 0;
  let orphanQuotes = 0;

  const closeSpeech = () => {
    if (speech) speech.speech.text = trimBlank(speech.lines);
    speech = undefined;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const quote = quoted.exec(line);
    if (quote) {
      if (section === 'conclusion') conclusion.push(quote[1]);
      else if (speech) speech.lines.push(quote[1]);
      else if (section !== 'skip') orphanQuotes++;
      continue;
    }
    const found = heading.exec(line);
    if (!found) {
      if (line.trim()) stray++;
      continue;
    }
    const level = found[1].length;
    const title = found[2].trim();
    if (level === 2) {
      closeSpeech();
      const roundNumber = /^第\s*(\d+)\s*輪$/.exec(title);
      if (title === '結論') {
        if (sawConclusion) problems.push('出現不只一個「結論」章節,內容已合併。');
        sawConclusion = true;
        section = 'conclusion';
        round = undefined;
      } else if (roundNumber) {
        const number = Number(roundNumber[1]);
        if (result.rounds.some((item) => item.round === number)) problems.push(`第 ${number} 輪重複出現。`);
        round = { round: number, speeches: [] };
        result.rounds.push(round);
        section = 'round';
      } else {
        problems.push(`無法辨認的章節標題「${title.slice(0, 40)}」,其下的內容已略過。`);
        section = 'skip';
        round = undefined;
      }
    } else if (level === 3) {
      closeSpeech();
      if (section === 'skip') continue;
      if (section === 'conclusion') {
        problems.push('結論章節內出現發言標題,這則發言已略過。');
        section = 'skip';
        continue;
      }
      if (section === 'none') {
        problems.push('發言出現在任何「第 N 輪」之前,已歸入第 0 輪。');
        round = result.rounds.find((item) => item.round === 0);
        if (!round) {
          round = { round: 0, speeches: [] };
          result.rounds.push(round);
        }
        section = 'round';
      }
      const separator = title.lastIndexOf(' · ');
      let name = title;
      let nodeId: string | null = null;
      if (separator >= 0) {
        name = title.slice(0, separator).trim();
        const id = title.slice(separator + 3).trim();
        nodeId = id && id !== '-' ? id : null;
      } else {
        problems.push(`發言標題「${title.slice(0, 40)}」缺少「 · 節點ID」。`);
      }
      const item: MeetingSpeech = { name, nodeId, text: '' };
      round!.speeches.push(item);
      speech = { speech: item, lines: [] };
    } else {
      // `#` or `####`+ outside a quote: not part of the format; it ends the current speech so later quotes are not
      // attributed to the previous speaker.
      closeSpeech();
      stray++;
    }
  }
  closeSpeech();

  const text = trimBlank(conclusion);
  result.conclusion = sawConclusion && text ? text : null;
  if (sawConclusion && !text) problems.push('「結論」章節沒有內容。');
  if (orphanQuotes) problems.push(`有 ${orphanQuotes} 行引用文字不屬於任何發言,已略過。`);
  if (stray) problems.push(`有 ${stray} 行文字不在引用區塊內,已略過。`);
  return result;
}

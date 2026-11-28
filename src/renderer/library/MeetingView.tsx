import { memo, useId, useMemo, useState } from 'react';
import type { MeetingSpeech, MemoryEntry, MemoryEntryDetail, NodeCrystal } from '../../shared/types';
import { Markdown } from './Markdown';
import { EndBadge, nodeName } from './Paper';
import styles from './Library.module.css';

/** Seal colours from Hagemi's M6 sketch; a node keeps the same colour everywhere (hash of its ID). */
const sealColors = ['#b57f23', '#6b4a2e', '#2f5e8e', '#6e4a8e', '#1f5b3f', '#8c3a27'];
const systemColor = '#5a4939';

function colorOf(nodeId: string): string {
  let hash = 0;
  for (const char of nodeId) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return sealColors[hash % sealColors.length];
}

const speakerKey = (speech: MeetingSpeech) => speech.nodeId ?? 'name:' + speech.name;

/** Inline SVG elements (not an image URL): a hexagon for nodes, a dashed square for the console (no 節點ID). */
function SpeakerSeal({ nodeId }: { nodeId: string | null }) {
  const color = nodeId ? colorOf(nodeId) : systemColor;
  return <svg className={styles.speakerIcon} viewBox="0 0 28 28" aria-hidden="true">
    {nodeId
      ? <polygon points="14,2 25,8.5 25,19.5 14,26 3,19.5 3,8.5" fill={color} fillOpacity=".16" stroke={color} strokeWidth="1.8" />
      : <rect x="3" y="3" width="22" height="22" rx="2" fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="3 2" />}
    <circle cx="14" cy="14" r={nodeId ? 3.5 : 4} fill={color} />
  </svg>;
}

interface SpeechProps {
  speech: MeetingSpeech;
  node: NodeCrystal | undefined;
  related: ReadonlyMap<string, string>;
  onOpen: (path: string) => void;
  onNode?: (node: NodeCrystal) => void;
}

/** One speech; memoized so filtering or folding does not re-render every speech's Markdown. */
const Speech = memo(function Speech({ speech, node, related, onOpen, onNode }: SpeechProps) {
  return <article className={styles.speech} data-speech={speech.nodeId ?? '-'}>
    <div className={styles.speakerSeal}>
      <SpeakerSeal nodeId={speech.nodeId} />
      <div>
        {node && onNode
          ? <button type="button" className={styles.speakerName} onClick={() => onNode(node)}>{speech.name}</button>
          : <span className={styles.speakerName}>{speech.name}</span>}
        <span className={styles.speakerId}>{speech.nodeId ?? '無節點 ID'}</span>
      </div>
    </div>
    <div className={styles.speechBody}>
      {speech.text ? <Markdown body={speech.text} related={related} onOpen={onOpen} lineBreaks /> : <p data-empty="">(沒有內容)</p>}
    </div>
  </article>;
});

interface Props {
  entry: MemoryEntryDetail;
  entries: ReadonlyMap<string, MemoryEntry>;
  nodes: ReadonlyMap<string, NodeCrystal>;
  related: ReadonlyMap<string, string>;
  onOpen: (path: string) => void;
  onNode?: (node: NodeCrystal) => void;
}

/**
 * M6b meeting reading view (DESIGN.md §5.14, Hagemi M6 sketch): conclusion first, attendees and output drafts, rounds
 * that fold, a speaker filter, and each speech beside its speaker seal. Structure the parser could not follow is
 * announced and the original text can be shown instead.
 */
export function MeetingView({ entry, entries, nodes, related, onOpen, onNode }: Props) {
  const transcript = entry.transcript!;
  const meeting = entry.meeting;
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const [raw, setRaw] = useState(false);
  const conclusionId = useId();

  const speakers = useMemo(() => {
    const seen = new Map<string, MeetingSpeech>();
    for (const round of transcript.rounds) for (const speech of round.speeches) if (!seen.has(speakerKey(speech))) seen.set(speakerKey(speech), speech);
    return [...seen.entries()];
  }, [transcript]);
  const speakerName = (key: string) => speakers.find(([item]) => item === key)?.[1].name ?? '';

  const person = (id: string, host: boolean) => {
    const node = nodes.get(id);
    const label = (host ? '♛ 主持 · ' : '') + nodeName(entry, id, nodes);
    return node && onNode
      ? <button key={id} type="button" className={styles.attendee} data-host={host || undefined} onClick={() => onNode(node)}>{label}</button>
      : <span key={id} className={styles.attendee} data-host={host || undefined}>{label}</span>;
  };

  return <div className={styles.meetingView} data-meeting-view="">
    {/* The console writes a short 標題 since 2026-11-28; the full 主題 stays readable here when it differs. */}
    {meeting?.topic && meeting.topic !== entry.title && <p className={styles.meetingTopic} data-meeting-topic="">完整主題:{meeting.topic}</p>}
    <div className={styles.meetingRoster}>
      {meeting?.endReason && <EndBadge reason={meeting.endReason} />}
      {meeting?.rounds !== null && meeting?.rounds !== undefined && <span>{meeting.rounds} 輪</span>}
      <span className={styles.rosterLabel}>出席:</span>
      {entry.nodeIds.map((id) => person(id, id === entry.nodeId))}
      {!entry.nodeId && entry.nodeLabel && <span className={styles.attendee} data-host="">♛ 主持 · {entry.nodeLabel}</span>}
    </div>
    {!!meeting?.outputs.length && <div className={styles.meetingOutputs}>
      <span className={styles.rosterLabel}>產出:</span>
      {meeting.outputs.map((path) => {
        const target = entries.get(path);
        return target
          ? <button key={path} type="button" className={styles.outputChip} data-meeting-output="" onClick={() => onOpen(path)}>{target.title} →</button>
          : <span key={path} className={styles.outputChip} data-meeting-output="missing">{path.split('/').at(-1)?.replace(/\.md$/i, '')}(找不到這份草稿)</span>;
      })}
    </div>}

    <section className={styles.meetingConclusion} aria-labelledby={conclusionId}>
      <h3 id={conclusionId}>結論</h3>
      {transcript.conclusion
        ? <Markdown body={transcript.conclusion} related={related} onOpen={onOpen} lineBreaks />
        : <p data-empty="">(主持人未寫結論)</p>}
    </section>

    {transcript.problems.length > 0 && <div className={styles.meetingProblems} role="note" data-meeting-problems="">
      <p>逐字稿有 {transcript.problems.length} 處結構無法辨認,下方可能缺漏內容。</p>
      <ul>{transcript.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
      <button type="button" className={styles.paperButton} aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
        {raw ? '改回分輪檢視' : '顯示原文'}
      </button>
    </div>}

    {raw ? <pre className={styles.meetingRaw} data-meeting-raw="">{entry.body}</pre> : <>
      {transcript.rounds.length > 0 && <div className={styles.meetingTools}>
        <div role="group" aria-label="發言者篩選" className={styles.speakerFilter}>
          <button type="button" aria-pressed={speaker === null} data-speaker-filter="" onClick={() => setSpeaker(null)}>全部發言者</button>
          {speakers.map(([key, speech]) => <button key={key} type="button" aria-pressed={speaker === key} data-speaker-filter={key}
            onClick={() => setSpeaker((value) => value === key ? null : key)}>{speech.name}</button>)}
        </div>
        <div className={styles.foldTools}>
          <button type="button" className={styles.paperButton} onClick={() => setFolded(new Set())}>全部展開</button>
          <button type="button" className={styles.paperButton} onClick={() => setFolded(new Set(transcript.rounds.map((_, index) => index)))}>全部收合</button>
        </div>
      </div>}
      {/* Always mounted so screen readers announce the change (a live region that appears already filled is often silent). */}
      <p className={styles.srOnly} role="status">{speaker === null ? '' : `只顯示 ${speakerName(speaker)} 的發言`}</p>
      {transcript.rounds.map((round, index) => {
        const shown = speaker === null ? round.speeches : round.speeches.filter((speech) => speakerKey(speech) === speaker);
        return <details key={index} className={styles.meetingRound} data-round={round.round} open={!folded.has(index)}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setFolded((previous) => {
              if (open !== previous.has(index)) return previous;
              const next = new Set(previous);
              if (open) next.delete(index); else next.add(index);
              return next;
            });
          }}>
          <summary>
            <span><span className={styles.foldMark} aria-hidden="true" />{round.round === 0 ? '第一輪之前' : `第 ${round.round} 輪`}</span>
            <small>{speaker === null ? `${round.speeches.length} 則發言` : `顯示 ${shown.length} / ${round.speeches.length} 則`}</small>
          </summary>
          {/* Folded rounds render no speeches (open is controlled, so they mount again when unfolded). */}
          {folded.has(index) ? null : shown.length
            ? shown.map((speech) => <Speech key={round.speeches.indexOf(speech)} speech={speech}
              node={speech.nodeId ? nodes.get(speech.nodeId) : undefined} related={related} onOpen={onOpen} onNode={onNode} />)
            : <p className={styles.quietLine}>本輪沒有 {speakerName(speaker!)} 的發言。</p>}
        </details>;
      })}
    </>}
  </div>;
}

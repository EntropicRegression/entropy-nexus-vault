import { Fragment } from 'react';
import type { ReactNode } from 'react';
import styles from './Library.module.css';

type OpenEntry = (path: string) => void;

function inline(text: string, related: ReadonlyMap<string, string>, open: OpenEntry): ReactNode[] {
  return text.split(/(\[\[\d{4}-\d{4}(?:\|[^\]]+)?\]\]|\*\*[^*]+\*\*|\x60[^\x60]+\x60)/g).map((part, i) => {
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const [id, label = id] = part.slice(2, -2).split('|');
      const path = related.get(id);
      return path ? <button type="button" className={styles.inlineLink} key={i} onClick={() => open(path)}>{label}</button> : part;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\x60[^\x60]+\x60$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

const maxQuoteDepth = 8;

/**
 * Render repository Markdown as text/components without allowing HTML, remote loads or arbitrary links.
 * lineBreaks: every source line break is kept (meeting transcripts); elsewhere wrapped lines join into one paragraph.
 */
export function Markdown({ body, related, onOpen, lineBreaks = false, depth = 0 }: {
  body: string; related: ReadonlyMap<string, string>; onOpen: OpenEntry; lineBreaks?: boolean; depth?: number;
}) {
  const lines = body.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;
  const boundary = /^\s*(?:#{1,6}\s|\x60{3,}|~{3,}|[-*+]\s+|\d+\.\s+|>\s?)/;
  while (index < lines.length) {
    const first = lines[index].trim();
    const key = index++;
    if (!first) continue;
    const fence = /^(\x60{3,}|~{3,})/.exec(first);
    if (fence) {
      const code: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(first);
    if (heading) {
      const Heading = heading[1].length <= 2 ? 'h3' : 'h4';
      blocks.push(<Heading key={key}>{inline(heading[2], related, onOpen)}</Heading>);
      continue;
    }
    const marker = /^(?:[-*+]|\d+\.)\s+/.exec(first);
    if (marker) {
      const pattern = /^\d/.test(marker[0]) ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
      const List = /^\d/.test(marker[0]) ? 'ol' : 'ul';
      const items = [first.replace(pattern, '')];
      while (index < lines.length && pattern.test(lines[index])) items.push(lines[index++].replace(pattern, ''));
      blocks.push(<List key={key}>{items.map((item, i) => <li key={i}>{inline(item, related, onOpen)}</li>)}</List>);
      continue;
    }
    if (first.startsWith('>')) {
      // Strip exactly one `>` layer (keeping the rest of each line, indentation included) and render the inside as
      // Markdown again, so nested quotes, lists and code blocks inside a quote keep their structure.
      const quote = [lines[key].replace(/^\s*> ?/, '')];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*> ?/, ''));
      blocks.push(<blockquote key={key}>{depth < maxQuoteDepth
        ? <Markdown body={quote.join('\n')} related={related} onOpen={onOpen} lineBreaks={lineBreaks} depth={depth + 1} />
        : inline(quote.join(' '), related, onOpen)}</blockquote>);
      continue;
    }
    const paragraph = [first];
    while (index < lines.length && lines[index].trim() && !boundary.test(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push(<p key={key}>{lineBreaks
      ? paragraph.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{inline(line, related, onOpen)}</Fragment>)
      : inline(paragraph.join(' '), related, onOpen)}</p>);
  }
  return <>{blocks}</>;
}

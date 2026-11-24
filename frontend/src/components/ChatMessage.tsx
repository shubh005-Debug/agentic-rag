import { useState } from 'react';
import { BookOpen, User, Bot, ChevronDown, ChevronUp, FileText, Table2, Image } from 'lucide-react';
import type { Message, SourceReference } from '../types';

interface ChatMessageProps {
  message: Message;
}

// ─── Markdown renderer ────────────────────────────────────────────────────
//
// Handles the subset the LLM actually produces:
//   • Fenced code blocks  ```lang\n...\n```
//   • Headings            # / ## / ###
//   • Bullet lists        - item  or  * item  (nested not supported)
//   • Numbered lists      1. item
//   • Blank lines         paragraph breaks
//   • Inline: **bold**, *italic*, `code`

/** Apply inline styles (bold, italic, inline code) to a plain string. */
function renderInline(text: string): React.ReactNode[] {
  // Split on **bold**, *italic*, `code` — keep delimiters via capture groups.
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      return (
        <em key={i} className="italic text-slate-200">
          {token.slice(1, -1)}
        </em>
      );
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={i}
          className="bg-slate-900 border border-slate-700 text-violet-300 rounded px-1 py-0.5 text-[0.8em] font-mono"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{token}</span>;
  });
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'code'; lang: string; lines: string[] };

/** Parse raw LLM text into a list of typed blocks. */
function parseBlocks(text: string): Block[] {
  const rawLines = text.split('\n');
  const blocks: Block[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];

    // ── Fenced code block ────────────────────────────────────────────────
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trimStart().startsWith('```')) {
        codeLines.push(rawLines[i]);
        i++;
      }
      i++; // consume closing ```
      blocks.push({ kind: 'code', lang, lines: codeLines });
      continue;
    }

    // ── Heading ──────────────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: headingMatch[2].trim() });
      i++;
      continue;
    }

    // ── Bullet list ───────────────────────────────────────────────────────
    if (/^[\-\*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^[\-\*]\s+/.test(rawLines[i])) {
        items.push(rawLines[i].replace(/^[\-\*]\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'bullet', items });
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────────
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i])) {
        items.push(rawLines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ kind: 'ordered', items });
      continue;
    }

    // ── Blank line — skip (paragraph separator) ───────────────────────────
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Paragraph — accumulate consecutive non-special lines ─────────────
    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== '' &&
      !/^(#{1,3}\s|[\-\*]\s|\d+\.\s|```)/.test(rawLines[i])
    ) {
      paraLines.push(rawLines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paraLines });
    }
  }

  return blocks;
}

/** Turn a list of blocks into React nodes. */
function renderMarkdown(text: string): React.ReactNode {
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        switch (block.kind) {
          case 'heading': {
            const cls =
              block.level === 1
                ? 'text-base font-bold text-white mt-1'
                : block.level === 2
                ? 'text-sm font-bold text-white mt-1'
                : 'text-sm font-semibold text-slate-200 mt-0.5';
            return <p key={bi} className={cls}>{renderInline(block.text)}</p>;
          }

          case 'bullet':
            return (
              <ul key={bi} className="space-y-1 pl-1">
                {block.items.map((item, ii) => (
                  <li key={ii} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
                    <span className="leading-relaxed">{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );

          case 'ordered':
            return (
              <ol key={bi} className="space-y-1 pl-1">
                {block.items.map((item, ii) => (
                  <li key={ii} className="flex items-start gap-2 text-sm">
                    <span className="flex-shrink-0 font-mono text-violet-400 text-xs mt-0.5 w-4 text-right">
                      {ii + 1}.
                    </span>
                    <span className="leading-relaxed">{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );

          case 'code':
            return (
              <div key={bi} className="rounded-lg overflow-hidden border border-slate-700">
                {block.lang && (
                  <div className="px-3 py-1 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-mono">{block.lang}</span>
                  </div>
                )}
                <pre className="bg-slate-900 px-3 py-2.5 overflow-x-auto text-xs text-slate-300 font-mono leading-relaxed whitespace-pre">
                  {block.lines.join('\n')}
                </pre>
              </div>
            );

          case 'paragraph':
          default:
            return (
              <p key={bi} className="text-sm leading-relaxed">
                {block.lines.map((line, li) => (
                  <span key={li}>
                    {renderInline(line)}
                    {li < block.lines.length - 1 && <br />}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

/** Renders a single chat bubble with optional source citations. */
export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  // Which source chip is currently expanded (by chunk id), or null for none.
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  function handleChipClick(src: SourceReference) {
    setActiveSourceId((prev) => (prev === src.documentId ? null : src.documentId));
  }

  const activeSource =
    message.sources?.find((s) => s.documentId === activeSourceId) ?? null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
          isUser ? 'bg-violet-600 text-white' : 'bg-slate-700 text-violet-400'
        }`}
      >
        {isUser ? <User size={15} /> : <Bot size={15} />}
      </div>

      <div className={`flex flex-col gap-2 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Bubble */}
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-violet-600 text-white rounded-tr-sm'
              : 'bg-slate-800 text-slate-300 rounded-tl-sm border border-slate-700'
          }`}
        >
          {isUser
            ? // User messages: plain text, no markdown parsing needed
              message.content
            : renderMarkdown(message.content)}
        </div>

        {/* Source citations (assistant only) */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="w-full space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <BookOpen size={11} />
              <span>Sources used</span>
            </div>

            {/* Chip row */}
            <div className="flex flex-wrap gap-2">
              {message.sources.map((src) => {
                const isOpen = activeSourceId === src.documentId;
                return (
                  <button
                    key={src.documentId}
                    onClick={() => handleChipClick(src)}
                    className={`group flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 transition-colors text-left ${
                      isOpen
                        ? 'bg-violet-600/15 border-violet-500/60 text-violet-300'
                        : 'bg-slate-800/60 border-slate-700 hover:border-violet-500/50 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BookOpen size={11} className="text-violet-400 flex-shrink-0" />
                    <span className="text-xs font-medium truncate max-w-[160px] transition-colors">
                      {src.documentName}
                    </span>
                    {src.page !== undefined && (
                      <span className={`text-xs ${isOpen ? 'text-violet-400/70' : 'text-slate-600'}`}>
                        p.{src.page}
                      </span>
                    )}
                    <span className="text-xs text-emerald-500 font-mono ml-0.5">
                      {Math.round(src.score * 100)}%
                    </span>
                    {isOpen ? (
                      <ChevronUp size={11} className="text-violet-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown size={11} className="text-slate-600 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Expanded excerpt panel */}
            {activeSource && <SourceExcerptPanel source={activeSource} />}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-xs text-slate-600">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}

// ─── Element type badge ───────────────────────────────────────────────────

type ElementType = 'Text' | 'Table' | 'Image' | string | null;

function ElementBadge({ type }: { type: ElementType }) {
  if (!type || type === 'Text') return null;
  const isTable = type === 'Table';
  const isImage = type === 'Image';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${
        isTable
          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
          : isImage
          ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
          : 'bg-slate-700 text-slate-400 border border-slate-600'
      }`}
    >
      {isTable ? <Table2 size={10} /> : isImage ? <Image size={10} /> : null}
      {type}
    </span>
  );
}

// ─── Expanded excerpt panel ───────────────────────────────────────────────

function SourceExcerptPanel({ source }: { source: SourceReference }) {
  const isTable = source.elementType === 'Table';
  const isImage = source.elementType === 'Image';

  return (
    <div className="w-full bg-slate-800/70 border border-violet-500/30 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/60 bg-slate-800">
        <FileText size={12} className="text-violet-400 flex-shrink-0" />
        <span className="text-xs font-medium text-violet-300 truncate flex-1">
          {source.documentName}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ElementBadge type={source.elementType} />
          {source.page !== undefined && (
            <span className="text-xs text-slate-500">p.{source.page}</span>
          )}
          <span className="text-xs font-mono text-emerald-500">
            {Math.round(source.score * 100)}%
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2.5">
        {/* Plain text excerpt — always shown */}
        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
          {source.excerpt}
        </p>

        {/* Table HTML */}
        {isTable && source.tableHtml && (
          <div>
            <p className="text-xs text-amber-400/80 font-medium mb-1.5 flex items-center gap-1">
              <Table2 size={11} />
              Table structure
            </p>
            <div
              className="overflow-x-auto rounded-lg border border-amber-500/20 bg-slate-900 p-2 text-xs text-slate-300
                [&_table]:w-full [&_table]:border-collapse
                [&_th]:bg-slate-800 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-slate-200 [&_th]:border [&_th]:border-slate-700
                [&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-slate-700/60 [&_td]:text-slate-300
                [&_tr:nth-child(even)_td]:bg-slate-800/40"
              dangerouslySetInnerHTML={{ __html: source.tableHtml }}
            />
          </div>
        )}

        {/* Image caption */}
        {isImage && source.imageCaption && (
          <div className="flex items-start gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg px-2.5 py-2">
            <Image size={12} className="text-sky-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-sky-300 leading-relaxed italic">
              {source.imageCaption}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

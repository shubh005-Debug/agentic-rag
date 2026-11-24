import { useState } from 'react';
import { BookOpen, User, Bot, ChevronDown, ChevronUp, FileText, Table2, Image, Copy, Check } from 'lucide-react';
import type { Message, SourceReference } from '../types';

interface ChatMessageProps {
  message: Message;
}

// ─── Inline markdown renderer ──────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return tokens.map((token, i) => {
    if (token.startsWith('**') && token.endsWith('**'))
      return <strong key={i} className="font-semibold text-white">{token.slice(2, -2)}</strong>;
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2)
      return <em key={i} className="italic" style={{ color: '#cbd5e0' }}>{token.slice(1, -1)}</em>;
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2)
      return (
        <code key={i} className="rounded px-1 py-0.5 text-[0.8em] font-mono"
          style={{ background: '#1a1f2e', border: '1px solid #2a3346', color: '#a78bfa' }}>
          {token.slice(1, -1)}
        </code>
      );
    return <span key={i}>{token}</span>;
  });
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'code'; lang: string; lines: string[] };

function parseBlocks(text: string): Block[] {
  const rawLines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trimStart().startsWith('```')) {
        codeLines.push(rawLines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: 'code', lang, lines: codeLines });
      continue;
    }

    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      blocks.push({ kind: 'heading', level: Math.min(hMatch[1].length, 3) as 1|2|3, text: hMatch[2].trim() });
      i++; continue;
    }

    if (/^[\-\*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^[\-\*]\s+/.test(rawLines[i]))
        items.push(rawLines[i++].replace(/^[\-\*]\s+/, ''));
      blocks.push({ kind: 'bullet', items }); continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i]))
        items.push(rawLines[i++].replace(/^\d+\.\s+/, ''));
      blocks.push({ kind: 'ordered', items }); continue;
    }

    if (line.trim() === '') { i++; continue; }

    const paraLines: string[] = [];
    while (i < rawLines.length && rawLines[i].trim() !== '' && !/^(#{1,3}\s|[\-\*]\s|\d+\.\s|```)/.test(rawLines[i]))
      paraLines.push(rawLines[i++]);
    if (paraLines.length > 0) blocks.push({ kind: 'paragraph', lines: paraLines });
  }
  return blocks;
}

function renderMarkdown(text: string): React.ReactNode {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        switch (block.kind) {
          case 'heading': {
            const cls = block.level === 1
              ? 'text-base font-bold text-white mt-1'
              : block.level === 2
              ? 'text-sm font-bold text-white'
              : 'text-sm font-semibold';
            return <p key={bi} className={cls} style={block.level === 3 ? { color: '#e2e8f0' } : {}}>{renderInline(block.text)}</p>;
          }
          case 'bullet':
            return (
              <ul key={bi} className="space-y-1.5">
                {block.items.map((item, ii) => (
                  <li key={ii} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#7c3aed' }} />
                    <span className="leading-relaxed" style={{ color: '#cbd5e0' }}>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'ordered':
            return (
              <ol key={bi} className="space-y-1.5">
                {block.items.map((item, ii) => (
                  <li key={ii} className="flex items-start gap-2.5 text-sm">
                    <span className="flex-shrink-0 font-mono text-xs mt-0.5 w-5 text-right font-semibold" style={{ color: '#7c6fcd' }}>{ii+1}.</span>
                    <span className="leading-relaxed" style={{ color: '#cbd5e0' }}>{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          case 'code':
            return <CodeBlock key={bi} lang={block.lang} lines={block.lines} />;
          case 'paragraph':
          default:
            return (
              <p key={bi} className="text-sm leading-relaxed" style={{ color: '#a0aec0' }}>
                {block.lines.map((line, li) => (
                  <span key={li}>{renderInline(line)}{li < block.lines.length - 1 && <br />}</span>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}

function CodeBlock({ lang, lines }: { lang: string; lines: string[] }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #2a3346' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ background: '#161b27', borderBottom: '1px solid #2a3346' }}>
        <span className="text-xs font-mono" style={{ color: '#4a5568' }}>{lang || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: copied ? '#68d391' : '#4a5568' }}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto text-xs font-mono leading-relaxed whitespace-pre" style={{ background: '#0d1117', color: '#a0aec0' }}>
        {lines.join('\n')}
      </pre>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  const activeSource = message.sources?.find((s) => s.documentId === activeSourceId) ?? null;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

      {/* Avatar */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={isUser
          ? { background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }
          : { background: '#161b27', border: '1px solid #2a3346' }
        }
      >
        {isUser
          ? <User size={14} className="text-white" />
          : <Bot size={14} style={{ color: '#7c6fcd' }} />
        }
      </div>

      <div className={`flex flex-col gap-2 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>

        {/* Bubble */}
        <div
          className="px-4 py-3 rounded-2xl text-sm"
          style={isUser
            ? {
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                color: '#fff',
                borderRadius: '18px 18px 4px 18px',
              }
            : {
                background: '#111620',
                border: '1px solid #1e2433',
                color: '#cbd5e0',
                borderRadius: '4px 18px 18px 18px',
              }
          }
        >
          {isUser ? (
            <p className="text-sm leading-relaxed">{message.content}</p>
          ) : (
            renderMarkdown(message.content)
          )}
        </div>

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="w-full space-y-2">
            <div className="flex items-center gap-1.5">
              <BookOpen size={10} style={{ color: '#4a5568' }} />
              <span className="text-xs" style={{ color: '#4a5568' }}>
                {message.sources.length} source{message.sources.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((src) => {
                const isOpen = activeSourceId === src.documentId;
                return (
                  <button
                    key={src.documentId}
                    onClick={() => setActiveSourceId((p) => p === src.documentId ? null : src.documentId)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all text-xs"
                    style={isOpen
                      ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.5)', color: '#c4b5fd' }
                      : { background: '#111620', border: '1px solid #1e2433', color: '#718096' }
                    }
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.borderColor = '#2a3346'; }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.borderColor = '#1e2433'; }}
                  >
                    <BookOpen size={10} style={{ color: isOpen ? '#7c6fcd' : '#4a5568', flexShrink: 0 }} />
                    <span className="font-medium truncate max-w-[140px]">{src.documentName}</span>
                    {src.page !== undefined && (
                      <span style={{ color: isOpen ? '#7c6fcd' : '#4a5568' }}>p.{src.page}</span>
                    )}
                    <span className="font-mono font-semibold" style={{ color: '#68d391' }}>
                      {Math.round(src.score * 100)}%
                    </span>
                    {isOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                );
              })}
            </div>

            {activeSource && <SourcePanel source={activeSource} />}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-xs" style={{ color: '#2d3748' }}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

function SourcePanel({ source }: { source: SourceReference }) {
  const isTable = source.elementType === 'Table';
  const isImage = source.elementType === 'Image';

  return (
    <div className="w-full rounded-xl overflow-hidden" style={{ background: '#0d1117', border: '1px solid rgba(124,58,237,0.3)' }}>
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: '#111620', borderBottom: '1px solid #1e2433' }}>
        <FileText size={12} style={{ color: '#7c6fcd', flexShrink: 0 }} />
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: '#c4b5fd' }}>{source.documentName}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {source.elementType && source.elementType !== 'Text' && (
            <span className="text-xs rounded px-1.5 py-0.5"
              style={isTable
                ? { background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }
                : { background: 'rgba(14,165,233,0.1)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.3)' }
              }
            >
              {isTable ? <Table2 size={9} className="inline mr-1" /> : <Image size={9} className="inline mr-1" />}
              {source.elementType}
            </span>
          )}
          {source.page !== undefined && <span className="text-xs" style={{ color: '#4a5568' }}>p.{source.page}</span>}
          <span className="text-xs font-mono font-bold" style={{ color: '#68d391' }}>{Math.round(source.score * 100)}%</span>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: '#718096' }}>{source.excerpt}</p>
        {isTable && source.tableHtml && (
          <div className="overflow-x-auto rounded-lg p-2 text-xs"
            style={{ background: '#161b27', border: '1px solid rgba(245,158,11,0.2)' }}
            dangerouslySetInnerHTML={{ __html: source.tableHtml }}
          />
        )}
        {isImage && source.imageCaption && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2"
            style={{ background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)' }}>
            <Image size={11} style={{ color: '#38bdf8', flexShrink: 0, marginTop: 1 }} />
            <p className="text-xs italic leading-relaxed" style={{ color: '#7dd3fc' }}>{source.imageCaption}</p>
          </div>
        )}
      </div>
    </div>
  );
}

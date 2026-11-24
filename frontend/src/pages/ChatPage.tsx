/**
 * ChatPage — /projects/:projectId/chats/:chatId
 * Clean chat with Sources section below answer, matching OpenSlate design.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Send, Loader2, FileText, ThumbsUp, ThumbsDown,
  MessageSquare, Plus, Trash2, ArrowLeft,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import { useMessages } from '../hooks/useMessages';
import { useConversations } from '../hooks/useConversations';
import { useDocuments } from '../hooks/useDocuments';
import { askQuestion, getApiErrorMessage } from '../services/api';
import type { Message, SourceReference } from '../types';
import { getChunkImageUrl } from '../services/api';
import type { AskSource } from '../services/api';

function toSourceReference(src: AskSource, index: number): SourceReference {
  const score = src.rerank_score ?? src.rrf_score ?? src.similarity ?? 0;
  return {
    chunkId: src.id ?? `src-${index}`,
    documentUUID: src.document_id,
    documentName: `Document`,
    excerpt: src.content,
    page: src.page_number ?? undefined,
    score,
    elementType: src.element_type ?? null,
    tableHtml: src.table_html ?? null,
    imageCaption: src.image_caption ?? null,
    hasImage: src.has_image ?? false,
  };
}

export default function ChatPage() {
  const { projectId, chatId } = useParams<{ projectId: string; chatId: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messagesState = useMessages(chatId ?? null);
  const convState = useConversations(projectId ?? null);
  const docState = useDocuments();

  const activeConv = convState.conversations.find(c => c.id === chatId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesState.messages, isAsking]);

  async function handleSend(text?: string) {
    const q = (text ?? input).trim();
    if (!q || isAsking || !chatId) return;
    setInput('');
    setAskError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsAsking(true);
    messagesState.saveUserMessage(q);
    try {
      const result = await askQuestion({ question: q, document_id: null });
      await messagesState.saveAssistantMessage(result.answer, result.sources);
    } catch (err) {
      setAskError(getApiErrorMessage(err));
    } finally {
      setIsAsking(false);
    }
  }

  // Sidebar: conversation list
  const sidebarExtra = (
    <div className="px-3 space-y-1">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#2a2a45' }}>Chats</p>
        <button
          onClick={async () => {
            const c = await convState.create('New conversation');
            if (c) navigate(`/projects/${projectId}/chats/${c.id}`);
          }}
          className="w-5 h-5 rounded flex items-center justify-center transition-all"
          style={{ color: '#4a5568' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
          onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
        >
          <Plus size={12} />
        </button>
      </div>
      {convState.conversations.map(c => (
        <div key={c.id}
          className="group flex items-center rounded-lg transition-all"
          style={{ background: c.id === chatId ? '#1a1a2e' : 'transparent' }}
          onMouseEnter={e => { if (c.id !== chatId) e.currentTarget.style.background = '#111118'; }}
          onMouseLeave={e => { if (c.id !== chatId) e.currentTarget.style.background = 'transparent'; }}
        >
          <button
            onClick={() => navigate(`/projects/${projectId}/chats/${c.id}`)}
            className="flex-1 flex items-center gap-2 px-2 py-2 text-left"
          >
            <MessageSquare size={12} style={{ color: c.id === chatId ? '#a78bfa' : '#4a5568', flexShrink: 0 }} />
            <span className="text-xs truncate" style={{ color: c.id === chatId ? '#c4b5fd' : '#718096' }}>
              {c.title}
            </span>
          </button>
          <button onClick={() => { convState.remove(c.id); if (c.id === chatId) navigate(`/projects/${projectId}`); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity pr-2">
            <Trash2 size={10} style={{ color: '#4a5568' }} />
          </button>
        </div>
      ))}
    </div>
  );

  // Build display messages
  const displayMessages = messagesState.messages.map((m): Message & { sources?: SourceReference[] } => ({
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp: m.created_at,
    sources: m.sources ? m.sources.map((s, i) => {
      const ref = toSourceReference(s, i);
      const matchedDoc = docState.documents.find(d => d.id === s.document_id);
      return { ...ref, documentName: matchedDoc ? matchedDoc.name : ref.documentName };
    }) : undefined,
  }));

  return (
    <AppShell sidebarExtra={sidebarExtra}>
      <div className="flex flex-1 flex-col overflow-hidden" style={{ paddingLeft: 10 }}>

        {/* Chat header */}
        <div className="flex items-center gap-3 px-6 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid #1a1a2e', paddingLeft: 50 }}>
          <Link to={`/projects/${projectId}`}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
            style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
            <ArrowLeft size={13} style={{ color: '#718096' }} />
          </Link>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: '#1a1a2e' }}>
            <MessageSquare size={13} style={{ color: '#a78bfa' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{activeConv?.title ?? 'Chat'}</p>
            <p className="text-xs" style={{ color: '#4a5568' }}>Project Chat</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">

            {messagesState.loading && (
              <div className="flex items-center justify-center gap-2 py-12" style={{ color: '#4a5568' }}>
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Loading messages…</span>
              </div>
            )}

            {!messagesState.loading && displayMessages.length === 0 && (
              <EmptyState onSuggest={handleSend} />
            )}

            {displayMessages.map((msg) => (
              <div key={msg.id}>
                <OpenSlateMessage message={msg} />
                {/* Sources below assistant message */}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <SourcesSection sources={msg.sources} />
                )}
              </div>
            ))}

            {isAsking && <TypingIndicator />}
            {askError && (
              <div className="rounded-xl px-4 py-3 text-sm"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fc8181' }}>
                {askError}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-6 py-4" style={{ borderTop: '1px solid #1a1a2e' }}>
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all"
              style={{ background: '#111118', border: '1px solid #1a1a2e' }}
              onFocusCapture={e => (e.currentTarget.style.borderColor = 'rgba(109,40,217,0.5)')}
              onBlurCapture={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Ask me anything about your documents..."
                rows={1}
                className="flex-1 bg-transparent text-sm outline-none resize-none leading-relaxed"
                style={{ color: '#e2e8f0', minHeight: 24 }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isAsking}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                style={input.trim() && !isAsking
                  ? { background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }
                  : { background: '#1a1a2e', opacity: 0.5, cursor: 'not-allowed' }
                }
              >
                <Send size={14} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ── OpenSlate-style message bubble ────────────────────────────────────────

function OpenSlateMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-[75%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed"
          style={{ background: '#1a1a2e', border: '1px solid #2a2a45', color: '#e2e8f0', borderRadius: '18px 18px 4px 18px' }}>
          {message.content}
        </div>
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
          style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}>
          <span className="text-xs font-bold text-white">S</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
        style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
        <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>AI</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl px-5 py-4 text-sm leading-relaxed"
          style={{ background: '#111118', border: '1px solid #1a1a2e', color: '#e2e8f0', borderRadius: '4px 18px 18px 18px' }}>
          <MarkdownContent content={message.content} />
        </div>
        {/* Feedback buttons */}
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className="text-xs" style={{ color: '#2a2a45' }}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            <button className="w-6 h-6 rounded-lg flex items-center justify-center transition-all"
              style={{ background: '#111118', border: '1px solid #1a1a2e' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#68d391')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
            >
              <ThumbsUp size={11} style={{ color: '#4a5568' }} />
            </button>
            <button className="w-6 h-6 rounded-lg flex items-center justify-center transition-all"
              style={{ background: '#111118', border: '1px solid #1a1a2e' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#fc8181')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
            >
              <ThumbsDown size={11} style={{ color: '#4a5568' }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sources section (below answer) ────────────────────────────────────────

function SourcesSection({ sources }: { sources: SourceReference[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Group by document
  const byDoc: Record<string, { name: string; count: number; sources: SourceReference[] }> = {};
  for (const src of sources) {
    if (!byDoc[src.documentUUID]) byDoc[src.documentUUID] = { name: src.documentName, count: 0, sources: [] };
    byDoc[src.documentUUID].count++;
    byDoc[src.documentUUID].sources.push(src);
  }

  return (
    <div className="ml-11 mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <FileText size={12} style={{ color: '#4a5568' }} />
        <span className="text-xs font-semibold" style={{ color: '#4a5568' }}>Sources ({sources.length})</span>
      </div>
      <div className="space-y-1.5">
        {Object.entries(byDoc).map(([docId, info]) => {
          const isOpen = expanded === docId;
          return (
            <div key={docId}>
              <button
                onClick={() => setExpanded(isOpen ? null : docId)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-left"
                style={isOpen
                  ? { background: '#1a1a2e', border: '1px solid #2a2a45' }
                  : { background: '#111118', border: '1px solid #1a1a2e' }
                }
                onMouseEnter={e => { if (!isOpen) e.currentTarget.style.borderColor = '#2a2a45'; }}
                onMouseLeave={e => { if (!isOpen) e.currentTarget.style.borderColor = '#1a1a2e'; }}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: '#111118', border: '1px solid #2a2a45' }}>
                  <FileText size={13} style={{ color: '#a78bfa' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{info.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>
                    {info.sources[0]?.page !== undefined ? `Page ${info.sources[0].page}` : ''}
                  </p>
                </div>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'rgba(109,40,217,0.2)', color: '#a78bfa' }}>
                  {info.count}
                </div>
              </button>

              {isOpen && (
                <div className="ml-4 mt-1.5 space-y-1.5">
                  {info.sources.map(src => (
                    <SourceChunkCard key={src.chunkId} source={src} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceChunkCard({ source }: { source: SourceReference }) {
  const isTable = source.elementType === 'Table';
  const isImage = source.elementType === 'Image';
  const [imgErr, setImgErr] = useState(false);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          {isTable && <span className="text-xs rounded px-1.5 py-0.5" style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>Table</span>}
          {isImage && <span className="text-xs rounded px-1.5 py-0.5" style={{ background: 'rgba(14,165,233,0.1)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.3)' }}>Image</span>}
          {source.page !== undefined && <span className="text-xs" style={{ color: '#4a5568' }}>p.{source.page}</span>}
          <span className="ml-auto text-xs font-mono font-bold" style={{ color: '#68d391' }}>{Math.round(source.score * 100)}%</span>
        </div>

        {/* Image */}
        {isImage && source.hasImage && !imgErr && (
          <img
            src={getChunkImageUrl(source.documentUUID, source.chunkId)}
            alt={source.imageCaption ?? 'Source image'}
            onError={() => setImgErr(true)}
            className="w-full max-h-40 object-contain rounded-lg"
            style={{ background: '#111118' }}
          />
        )}

        {/* Table */}
        {isTable && source.tableHtml && (
          <div className="overflow-x-auto rounded-lg p-2" style={{ background: '#111118', border: '1px solid rgba(245,158,11,0.15)' }}>
            <style>{`.src-tbl table{width:100%;border-collapse:collapse}.src-tbl th{background:#1a1a2e;padding:4px 8px;text-align:left;color:#c4b5fd;font-size:10px;border:1px solid #2a2a45}.src-tbl td{padding:4px 8px;border:1px solid #1a1a2e;color:#a0aec0;font-size:10px}`}</style>
            <div className="src-tbl" dangerouslySetInnerHTML={{ __html: source.tableHtml }} />
          </div>
        )}

        <p className="text-xs leading-relaxed" style={{ color: '#718096' }}>{source.excerpt}</p>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'What are the main topics covered?',
  'Summarise the key findings',
  'What tables or figures are included?',
  'Find any risks or warnings mentioned',
];

function EmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
        <FileText size={26} style={{ color: '#4a5568' }} />
      </div>
      <p className="text-lg font-bold text-white mb-1">Start a conversation</p>
      <p className="text-sm mb-8" style={{ color: '#4a5568' }}>
        Ask me anything about your documents and I'll help you find the answers.
      </p>
      <div className="flex flex-wrap gap-2 justify-center max-w-lg">
        {SUGGESTIONS.map(s => (
          <button key={s} onClick={() => onSuggest(s)}
            className="text-xs rounded-xl px-4 py-2.5 transition-all"
            style={{ background: '#111118', border: '1px solid #1a1a2e', color: '#718096' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#6d28d9'; e.currentTarget.style.color = '#c4b5fd'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a2e'; e.currentTarget.style.color = '#718096'; }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
        <span className="text-xs font-bold" style={{ color: '#a78bfa' }}>AI</span>
      </div>
      <div className="rounded-2xl px-5 py-4 flex items-center gap-1.5"
        style={{ background: '#111118', border: '1px solid #1a1a2e', borderRadius: '4px 18px 18px 18px' }}>
        {[0, 150, 300].map(d => (
          <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
            style={{ background: '#4a5568', animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

// ── Simple markdown renderer ───────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const lvl = hMatch[1].length;
      nodes.push(<p key={i} className={`font-bold ${lvl === 1 ? 'text-base' : 'text-sm'} text-white mt-2`}>{hMatch[2]}</p>);
      i++; continue;
    }

    if (/^[\-\*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^[\-\*]\s+/, ''));
      nodes.push(
        <ul key={`ul-${i}`} className="space-y-1 my-1">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm" style={{ color: '#e2e8f0' }}>
              <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#6d28d9' }} />
              <span dangerouslySetInnerHTML={{ __html: item.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      items.push(lines[i++].replace(/^\d+\.\s+/, ''));
      nodes.push(
        <ol key={`ol-${i}`} className="space-y-1 my-1">
          {items.map((item, j) => (
            <li key={j} className="flex items-start gap-2 text-sm" style={{ color: '#e2e8f0' }}>
              <span className="font-mono text-xs mt-0.5 font-bold flex-shrink-0" style={{ color: '#a78bfa' }}>{j+1}.</span>
              <span dangerouslySetInnerHTML={{ __html: item.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
            </li>
          ))}
        </ol>
      );
      continue;
    }

    nodes.push(
      <p key={i} className="text-sm leading-relaxed" style={{ color: '#e2e8f0' }}
        dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>') }}
      />
    );
    i++;
  }

  return <div className="space-y-1.5">{nodes}</div>;
}

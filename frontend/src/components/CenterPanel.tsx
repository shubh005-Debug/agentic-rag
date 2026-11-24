/**
 * CenterPanel — main chat area.
 * Fully live: messages load from and persist to the backend.
 * Zero mock data.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  FileSearch,
  Loader2,
  Pencil,
  Send,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { ApiConversation, ApiProject, AskSource } from '../services/api';
import type { UseMessagesReturn } from '../hooks/useMessages';
import type { KBDocument, Message, SourceReference } from '../types';
import { askQuestion, getApiErrorMessage } from '../services/api';
import ChatMessage from './ChatMessage';

interface CenterPanelProps {
  project: ApiProject | null;
  conversation: ApiConversation | null;
  messagesState: UseMessagesReturn;
  selectedDocumentId: string | null;
  documents: KBDocument[];
  onRenameConversation: (id: string, title: string) => Promise<void>;
}

function toSourceReference(src: AskSource, index: number, documents: KBDocument[]): SourceReference {
  const score = src.rerank_score ?? src.rrf_score ?? src.similarity ?? 0;
  const matchedDoc = documents.find((d) => d.id === src.document_id);
  return {
    chunkId: src.id ?? `src-${index}`,
    documentUUID: src.document_id,
    documentName: matchedDoc ? matchedDoc.name : `Doc ${src.document_id.slice(0, 8)}…`,
    excerpt: src.content,
    page: src.page_number ?? undefined,
    score,
    elementType: src.element_type ?? null,
    tableHtml: src.table_html ?? null,
    imageCaption: src.image_caption ?? null,
    hasImage: src.has_image ?? false,
  };
}

function toMessage(
  m: { id: string; conversation_id: string; role: string; content: string; sources: AskSource[] | null; created_at: string },
  documents: KBDocument[],
): Message {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp: m.created_at,
    sources: m.sources ? m.sources.map((s, i) => toSourceReference(s, i, documents)) : undefined,
  };
}

export default function CenterPanel(props: CenterPanelProps) {
  return <CenterPanelInner key={props.conversation?.id ?? 'empty'} {...props} />;
}

// Suggested starter prompts shown on empty conversation
const SUGGESTIONS = [
  'Summarise the key points in my documents',
  'What are the main topics covered?',
  'Find any risks or warnings mentioned',
  'Compare the documents and highlight differences',
];

function CenterPanelInner({
  project,
  conversation,
  messagesState,
  selectedDocumentId,
  documents,
  onRenameConversation,
}: CenterPanelProps) {
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation?.title ?? '');

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const displayMessages: Message[] = messagesState.messages.map((m) => toMessage(m, documents));

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messagesState.messages, isAsking]);
  useEffect(() => { if (isRenaming) { renameInputRef.current?.focus(); renameInputRef.current?.select(); } }, [isRenaming]);

  function startRename() { setRenameValue(conversation?.title ?? ''); setIsRenaming(true); }
  async function commitRename() {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (trimmed && conversation && trimmed !== conversation.title)
      await onRenameConversation(conversation.id, trimmed);
  }
  function cancelRename() { setRenameValue(conversation?.title ?? ''); setIsRenaming(false); }
  function handleRenameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') cancelRename();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  async function handleSend(text?: string) {
    const q = (text ?? input).trim();
    if (!q || isAsking || !conversation) return;
    setInput('');
    setAskError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsAsking(true);
    messagesState.saveUserMessage(q);
    try {
      const result = await askQuestion({ question: q, document_id: selectedDocumentId ?? null });
      await messagesState.saveAssistantMessage(result.answer, result.sources);
    } catch (err) {
      setAskError(getApiErrorMessage(err));
    } finally {
      setIsAsking(false);
    }
  }

  // ── Empty / no project state ──────────────────────────────────────────

  if (!conversation || !project) {
    return (
      <main className="flex flex-col h-full items-center justify-center" style={{ background: '#090c14' }}>
        <div className="text-center space-y-4 px-6 max-w-sm">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(79,70,229,0.2))', border: '1px solid rgba(124,58,237,0.3)' }}
          >
            <Sparkles size={28} style={{ color: '#7c6fcd' }} />
          </div>
          <div>
            <p className="text-base font-semibold text-white">Welcome to RAG Studio</p>
            <p className="text-sm mt-1" style={{ color: '#4a5568' }}>
              Create a project and upload documents to start asking questions about your knowledge base.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col h-full" style={{ background: '#090c14' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center pl-14 pr-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid #1e2433', background: '#0d1117' }}
      >
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-medium truncate max-w-[120px]" style={{ color: '#7c6fcd' }}>{project.name}</span>
            <span className="text-xs" style={{ color: '#2d3748' }}>/</span>
          </div>
          {isRenaming ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKey}
                onBlur={commitRename}
                maxLength={200}
                className="flex-1 min-w-0 text-sm font-semibold text-white rounded-lg px-2.5 py-1 outline-none"
                style={{ background: '#161b27', border: '1px solid rgba(124,58,237,0.6)' }}
              />
              <button onMouseDown={e => { e.preventDefault(); commitRename(); }}
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: '#7c3aed' }}>
                <Check size={11} className="text-white" />
              </button>
              <button onMouseDown={e => { e.preventDefault(); cancelRename(); }}
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: '#161b27', border: '1px solid #2a3346' }}>
                <X size={11} style={{ color: '#718096' }} />
              </button>
            </div>
          ) : (
            <button
              onClick={startRename}
              className="group flex items-center gap-1.5 text-left"
              title="Click to rename"
            >
              <h2 className="text-sm font-bold text-white truncate">{conversation.title}</h2>
              <Pencil size={11} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" style={{ color: '#4a5568' }} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {selectedDocumentId && (
            <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', color: '#c4b5fd' }}>
              <FileSearch size={11} />
              <span>1 doc</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
            style={{ background: '#161b27', border: '1px solid #2a3346', color: '#718096' }}>
            <Zap size={11} style={{ color: '#7c6fcd' }} />
            <span>RAG</span>
          </div>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messagesState.loading && (
          <div className="flex items-center gap-2" style={{ color: '#4a5568' }}>
            <Loader2 size={13} className="animate-spin" />
            <span className="text-xs">Loading messages…</span>
          </div>
        )}

        {!messagesState.loading && displayMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6 py-12">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}
            >
              <Bot size={24} style={{ color: '#7c6fcd' }} />
            </div>
            <div>
              <p className="text-base font-semibold text-white">Ask anything</p>
              <p className="text-sm mt-1" style={{ color: '#4a5568' }}>
                {selectedDocumentId ? 'Searching within selected document' : 'Searching across all documents'}
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-xs rounded-lg px-3 py-2 transition-all"
                  style={{ background: '#111620', border: '1px solid #1e2433', color: '#718096' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#c4b5fd'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e2433'; e.currentTarget.style.color = '#718096'; }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {displayMessages.map((msg) => <ChatMessage key={msg.id} message={msg} />)}

        {/* Typing indicator */}
        {isAsking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: '#161b27', border: '1px solid #2a3346' }}>
              <Loader2 size={14} className="animate-spin" style={{ color: '#7c6fcd' }} />
            </div>
            <div className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
              style={{ background: '#111620', border: '1px solid #1e2433', borderRadius: '4px 18px 18px 18px' }}>
              {[0, 150, 300].map((delay) => (
                <span key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: '#4a5568', animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        )}

        {askError && (
          <div className="flex items-start gap-2.5 rounded-xl px-4 py-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <AlertCircle size={14} style={{ color: '#fc8181', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-xs font-semibold" style={{ color: '#fc8181' }}>Request failed</p>
              <p className="text-xs mt-0.5" style={{ color: '#fc8181', opacity: 0.8 }}>{askError}</p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid #1e2433', background: '#0d1117' }}>
        <div
          className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all"
          style={{ background: '#111620', border: '1px solid #1e2433' }}
          onFocus={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.5)')}
          onBlur={e => (e.currentTarget.style.borderColor = '#1e2433')}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={selectedDocumentId ? 'Ask about the selected document…' : 'Ask a question about your documents…'}
            rows={1}
            className="flex-1 bg-transparent text-sm outline-none resize-none leading-relaxed min-h-[24px]"
            style={{ color: '#e2e8f0' }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isAsking}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
            style={input.trim() && !isAsking
              ? { background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }
              : { background: '#161b27', cursor: 'not-allowed', opacity: 0.5 }
            }
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
        <p className="text-xs mt-2 text-center" style={{ color: '#2d3748' }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>

    </main>
  );
}

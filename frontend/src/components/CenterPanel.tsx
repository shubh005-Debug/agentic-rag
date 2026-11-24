/**
 * src/components/CenterPanel.tsx
 *
 * Main chat panel: conversation header, message list, input box.
 *
 * Messages are now persisted:
 *   - History loads from GET /conversations/{id}/messages (via useMessages)
 *   - Each user message is saved via POST before the /ask call
 *   - Each assistant message (+ sources) is saved after the /ask response
 *
 * Renaming a conversation calls PATCH /conversations/{id} and updates
 * the left panel list immediately.
 *
 * The outer CenterPanel passes key={conversation.id} so the inner component
 * remounts cleanly on conversation switch.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  FileSearch,
  Loader2,
  MoreHorizontal,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X,
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

/** Convert a backend AskSource to the SourceReference shape used by the UI. */
function toSourceReference(
  src: AskSource,
  index: number,
  documents: KBDocument[],
): SourceReference {
  const score = src.rerank_score ?? src.rrf_score ?? src.similarity ?? 0;
  const matchedDoc = documents.find((d) => d.id === src.document_id);
  const documentName = matchedDoc
    ? matchedDoc.name
    : `Doc ${src.document_id.slice(0, 8)}…`;

  return {
    documentId: src.id ?? `src-${index}`,
    documentName,
    excerpt: src.content,
    page: src.page_number ?? undefined,
    score,
    elementType: src.element_type ?? null,
    tableHtml: src.table_html ?? null,
    imageCaption: src.image_caption ?? null,
  };
}

/** Convert a saved ApiMessage (from DB) to the Message shape used by ChatMessage. */
function toMessage(m: { id: string; conversation_id: string; role: string; content: string; sources: AskSource[] | null; created_at: string }, documents: KBDocument[]): Message {
  const sources = m.sources
    ? m.sources.map((s, i) => toSourceReference(s, i, documents))
    : undefined;
  return {
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    timestamp: m.created_at,
    sources,
  };
}

// Outer wrapper — remounts inner component on conversation change.
export default function CenterPanel(props: CenterPanelProps) {
  return (
    <CenterPanelInner
      key={props.conversation?.id ?? 'empty'}
      {...props}
    />
  );
}

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

  // ── Rename state ──────────────────────────────────────────────────────
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation?.title ?? '');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Dropdown menu state ───────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Build the display message list from persisted messages.
  const displayMessages: Message[] = messagesState.messages.map((m) =>
    toMessage(m, documents),
  );

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  // Focus rename input when it appears.
  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  // Auto-scroll to latest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesState.messages, isAsking]);

  // ── Rename handlers ───────────────────────────────────────────────────

  function startRename() {
    setMenuOpen(false);
    setRenameValue(conversation?.title ?? '');
    setIsRenaming(true);
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    setIsRenaming(false);
    if (trimmed && conversation && trimmed !== conversation.title) {
      await onRenameConversation(conversation.id, trimmed);
    }
  }

  function cancelRename() {
    setRenameValue(conversation?.title ?? '');
    setIsRenaming(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') cancelRename();
  }

  // ── Input helpers ─────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if (!text || isAsking || !conversation) return;

    setInput('');
    setAskError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsAsking(true);

    // Save the user message to the DB (non-blocking — UI continues).
    messagesState.saveUserMessage(text);

    try {
      const result = await askQuestion({
        question: text,
        document_id: selectedDocumentId ?? null,
      });

      // Save the assistant message + sources to the DB.
      await messagesState.saveAssistantMessage(result.answer, result.sources);

    } catch (err) {
      setAskError(getApiErrorMessage(err));
    } finally {
      setIsAsking(false);
    }
  }

  // ── Empty state ───────────────────────────────────────────────────────

  if (!conversation || !project) {
    return (
      <main className="flex flex-col h-full bg-slate-950 items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto">
            <Bot size={22} className="text-slate-500" />
          </div>
          <p className="text-sm text-slate-500">Select or create a project to get started.</p>
        </div>
      </main>
    );
  }

  const conversationTitle = conversation.title;

  return (
    <main className="flex flex-col h-full bg-slate-950">

      {/* ── Header ── */}
      <div className="flex items-center justify-between pl-12 pr-4 py-4 border-b border-slate-800 flex-shrink-0">

        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span className="text-violet-400 truncate max-w-[140px]">{project.name}</span>
            <span>/</span>
            <span>Conversation</span>
          </div>

          {isRenaming ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={commitRename}
                maxLength={200}
                className="flex-1 min-w-0 bg-slate-800 border border-violet-500/60 text-white text-sm font-semibold rounded-lg px-2.5 py-1 outline-none focus:border-violet-500 transition-colors"
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); commitRename(); }}
                className="w-6 h-6 rounded-md bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors"
              >
                <Check size={12} className="text-white" />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelRename(); }}
                className="w-6 h-6 rounded-md bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors"
              >
                <X size={12} className="text-slate-300" />
              </button>
            </div>
          ) : (
            <h2 className="text-sm font-semibold text-white truncate">{conversationTitle}</h2>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {selectedDocumentId && (
            <div className="flex items-center gap-1.5 bg-violet-600/10 border border-violet-500/30 rounded-lg px-2.5 py-1.5">
              <FileSearch size={12} className="text-violet-400" />
              <span className="text-xs text-violet-300">1 doc</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5">
            <Sparkles size={12} className="text-violet-400" />
            <span className="text-xs text-slate-400">GPT-oss-20b</span>
          </div>

          {/* ⋯ menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center transition-colors"
            >
              <MoreHorizontal size={14} className="text-slate-400" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden">
                <button
                  onClick={startRename}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <Pencil size={13} className="text-slate-500" />
                  Rename
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    // Clear is local only — messages remain in DB.
                    // Reload to restore them.
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <Trash2 size={13} className="text-slate-500" />
                  Delete conversation
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

        {/* Loading skeleton */}
        {messagesState.loading && (
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 size={13} className="animate-spin" />
            <span className="text-xs">Loading messages…</span>
          </div>
        )}

        {/* Empty state */}
        {!messagesState.loading && displayMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-3">
              <Sparkles size={18} className="text-slate-500" />
            </div>
            <p className="text-sm text-slate-400 font-medium">Ask anything</p>
            <p className="text-xs text-slate-600 mt-1">
              {selectedDocumentId
                ? 'Searching within the selected document'
                : 'Searching across all documents'}
            </p>
          </div>
        )}

        {displayMessages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {isAsking && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
              <Loader2 size={15} className="text-violet-400 animate-spin" />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Error banner */}
        {askError && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{askError}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-6 py-4 border-t border-slate-800 flex-shrink-0">
        <div className="flex items-end gap-3 bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 focus-within:border-violet-500/50 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedDocumentId
                ? 'Ask about the selected document…'
                : 'Ask a question about your documents…'
            }
            rows={1}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none resize-none leading-relaxed min-h-[24px]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isAsking}
            className="w-8 h-8 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0 mb-0.5"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
        <p className="text-xs text-slate-700 mt-2 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>

    </main>
  );
}

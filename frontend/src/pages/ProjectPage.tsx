/**
 * ProjectPage — /projects/:projectId
 * Two tabs: Conversations | Knowledge Base (right panel)
 * Right panel: Documents tab + Settings tab
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Plus, Trash2, Loader2, Upload, FileText,
  File, FileSpreadsheet, FileType2, CheckCircle2, XCircle,
  AlertCircle, RefreshCw, Settings, Database, X, ExternalLink,
} from 'lucide-react';
import AppShell from '../components/AppShell';
import PipelineModal from '../components/PipelineModal';
import { useDocuments } from '../hooks/useDocuments';
import { useConversations } from '../hooks/useConversations';
import { listProjects, type ApiProject } from '../services/api';
import type { KBDocument } from '../types';
import { ALLOWED_EXTENSIONS } from '../services/api';

type RightTab = 'documents' | 'settings';

const ACCEPT = [...ALLOWED_EXTENSIONS].join(',');

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ApiProject | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('documents');
  const [pipelineDoc, setPipelineDoc] = useState<KBDocument | null>(null);

  const docState = useDocuments();
  const convState = useConversations(projectId ?? null);

  useEffect(() => {
    if (!projectId) return;
    listProjects().then(projects => {
      const p = projects.find(x => x.id === projectId);
      if (p) setProject(p);
    }).catch(() => {});
  }, [projectId]);

  async function handleNewChat() {
    if (!projectId) return;
    const conv = await convState.create('New conversation');
    if (conv) navigate(`/projects/${projectId}/chats/${conv.id}`);
  }

  // Sidebar extra: conversation list
  const sidebarExtra = (
    <div className="px-3 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-widest px-1 pb-1" style={{ color: '#2a2a45' }}>Conversations</p>
      {convState.conversations.map(c => (
        <div key={c.id} className="group flex items-center rounded-lg transition-all"
          style={{ background: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#111118')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <button
            onClick={() => navigate(`/projects/${projectId}/chats/${c.id}`)}
            className="flex-1 flex items-center gap-2 px-2 py-2 text-left"
          >
            <MessageSquare size={12} style={{ color: '#4a5568', flexShrink: 0 }} />
            <span className="text-xs truncate" style={{ color: '#718096' }}>{c.title}</span>
          </button>
          <button
            onClick={() => convState.remove(c.id)}
            className="opacity-0 group-hover:opacity-100 pr-2 transition-opacity"
          >
            <Trash2 size={10} style={{ color: '#4a5568' }} />
          </button>
        </div>
      ))}
      {convState.conversations.length === 0 && !convState.loading && (
        <p className="text-xs px-2 py-1" style={{ color: '#2a2a45' }}>No conversations yet</p>
      )}
    </div>
  );

  return (
    <AppShell sidebarExtra={sidebarExtra}>
      <div className="flex flex-1 overflow-hidden" style={{ paddingLeft: 10 }}>

        {/* ── Center: Conversations ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Project header */}
          <div className="px-10 pt-8 pb-0 flex-shrink-0" style={{ paddingLeft: 50 }}>
            {project ? (
              <>
                <h1 className="text-xl font-bold text-white">{project.name}</h1>
                {project.description && (
                  <p className="text-sm mt-1" style={{ color: '#4a5568' }}>{project.description}</p>
                )}
              </>
            ) : (
              <div className="h-6 w-48 rounded animate-pulse" style={{ background: '#1a1a2e' }} />
            )}

            {/* Tabs */}
            <div className="flex mt-5" style={{ borderBottom: '1px solid #1a1a2e' }}>
              <button className="px-1 pb-3 mr-6 text-sm font-semibold transition-all"
                style={{ color: '#a78bfa', borderBottom: '2px solid #6d28d9' }}>
                Conversations
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-10 py-6" style={{ paddingLeft: 50 }}>
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm" style={{ color: '#4a5568' }}>
                {convState.conversations.length} conversation{convState.conversations.length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={handleNewChat}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}
              >
                <Plus size={13} />
                New chat
              </button>
            </div>

            {convState.loading && (
              <div className="flex items-center gap-2 py-8 justify-center" style={{ color: '#4a5568' }}>
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            )}

            {!convState.loading && convState.conversations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                  <MessageSquare size={22} style={{ color: '#4a5568' }} />
                </div>
                <p className="font-semibold text-white mb-1">No conversations yet</p>
                <p className="text-sm mb-5" style={{ color: '#4a5568' }}>Start a chat to query your documents</p>
                <button onClick={handleNewChat}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}>
                  <Plus size={14} />
                  New conversation
                </button>
              </div>
            )}

            <div className="space-y-2.5">
              {convState.conversations.map(c => (
                <div
                  key={c.id}
                  onClick={() => navigate(`/projects/${projectId}/chats/${c.id}`)}
                  className="group flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all"
                  style={{ background: '#111118', border: '1px solid #1a1a2e' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#6d28d9')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: '#1a1a2e' }}>
                    <MessageSquare size={16} style={{ color: '#a78bfa' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-white truncate">{c.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>
                      Project Chat · {timeAgo(c.updated_at)}
                    </p>
                  </div>
                  <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    style={{ color: '#4a5568' }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Knowledge Base ── */}
        <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: '1px solid #1a1a2e', background: '#0a0a0f' }}>

          {/* Panel header */}
          <div className="px-4 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #1a1a2e' }}>
            <div className="flex items-center gap-2">
              <Database size={14} style={{ color: '#a78bfa' }} />
              <p className="text-sm font-bold text-white">Knowledge Base</p>
              <button className="ml-auto w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
                <Plus size={12} style={{ color: '#a78bfa' }} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid #1a1a2e' }}>
            {(['documents', 'settings'] as RightTab[]).map(t => (
              <button key={t} onClick={() => setRightTab(t)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold capitalize transition-all"
                style={rightTab === t
                  ? { color: '#a78bfa', borderBottom: '2px solid #6d28d9' }
                  : { color: '#4a5568', borderBottom: '2px solid transparent' }
                }>
                {t === 'documents' ? <FileText size={11} /> : <Settings size={11} />}
                {t}
              </button>
            ))}
          </div>

          {rightTab === 'documents'
            ? <DocumentsPanel docState={docState} onOpenPipeline={setPipelineDoc} />
            : <SettingsPanel />
          }
        </div>
      </div>

      {pipelineDoc && (
        <PipelineModal doc={pipelineDoc} onClose={() => setPipelineDoc(null)} />
      )}
    </AppShell>
  );
}

// ── Documents panel ──────────────────────────────────────────────────────

function DocumentsPanel({
  docState,
  onOpenPipeline,
}: {
  docState: ReturnType<typeof useDocuments>;
  onOpenPipeline: (doc: KBDocument) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) docState.upload(files);
  }, [docState]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) docState.upload(files);
    e.target.value = '';
  }, [docState]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Upload zone */}
      <div className="px-4 py-4 space-y-3 flex-shrink-0" style={{ borderBottom: '1px solid #1a1a2e' }}>
        <div
          role="button" tabIndex={0}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl cursor-pointer transition-all"
          style={isDragging
            ? { border: '1px dashed #6d28d9', background: 'rgba(109,40,217,0.08)' }
            : { border: '1px dashed #2a2a45', background: 'transparent' }
          }
          onMouseEnter={e => { if (!isDragging) e.currentTarget.style.borderColor = '#4a4a65'; }}
          onMouseLeave={e => { if (!isDragging) e.currentTarget.style.borderColor = '#2a2a45'; }}
        >
          <Upload size={20} style={{ color: isDragging ? '#a78bfa' : '#4a5568' }} />
          <div className="text-center">
            <p className="text-xs font-semibold" style={{ color: isDragging ? '#c4b5fd' : '#718096' }}>
              Drop files or click to upload
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#2a2a45' }}>PDF, DOCX, CSV · Max 50MB</p>
          </div>
        </div>
        <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={handleFileChange} />

        {/* Uploading rows */}
        {docState.uploadingFiles.map(u => (
          <div key={u.key} className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
            {u.error
              ? <XCircle size={13} style={{ color: '#fc8181', flexShrink: 0 }} />
              : u.progress < 100
                ? <Loader2 size={13} className="animate-spin" style={{ color: '#a78bfa', flexShrink: 0 }} />
                : <CheckCircle2 size={13} style={{ color: '#68d391', flexShrink: 0 }} />
            }
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: '#a0aec0' }}>{u.filename}</p>
              {u.error
                ? <p className="text-xs" style={{ color: '#fc8181' }}>{u.error}</p>
                : u.progress < 100
                  ? <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
                      <div className="h-full rounded-full" style={{ width: `${u.progress}%`, background: 'linear-gradient(90deg,#6d28d9,#4f46e5)' }} />
                    </div>
                  : <p className="text-xs" style={{ color: '#4a5568' }}>Processing…</p>
              }
            </div>
          </div>
        ))}
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {docState.loading && docState.documents.length === 0 && (
          <div className="flex flex-col gap-2">
            {[1,2,3].map(i => (
              <div key={i} className="rounded-xl p-3 animate-pulse" style={{ background: '#111118', height: 60 }} />
            ))}
          </div>
        )}
        {!docState.loading && docState.documents.length === 0 && docState.uploadingFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Upload size={22} style={{ color: '#2a2a45' }} className="mb-2" />
            <p className="text-xs" style={{ color: '#4a5568' }}>No documents yet</p>
          </div>
        )}
        {docState.documents.map(doc => (
          <DocRow
            key={doc.id}
            doc={doc}
            isDeleting={docState.deletingIds.has(doc.id)}
            deleteError={docState.deleteErrors[doc.id] ?? null}
            onDelete={() => docState.remove(doc.id)}
            onOpenPipeline={() => onOpenPipeline(doc)}
          />
        ))}
      </div>
    </div>
  );
}

function DocRow({ doc, isDeleting, deleteError, onDelete, onOpenPipeline }: {
  doc: KBDocument;
  isDeleting: boolean;
  deleteError: string | null;
  onDelete: () => void;
  onOpenPipeline: () => void;
}) {
  const ext = doc.type;
  let Icon = File;
  let iconColor = '#63b3ed';
  if (ext === 'pdf') { Icon = FileText; iconColor = '#fc8181'; }
  else if (ext === 'csv' || ext === 'xlsx') { Icon = FileSpreadsheet; iconColor = '#68d391'; }
  else if (ext === 'html' || ext === 'htm') { Icon = FileType2; iconColor = '#63b3ed'; }

  return (
    <div>
      <div
        className="group flex items-start gap-2.5 p-3 rounded-xl cursor-pointer transition-all"
        style={{ background: '#111118', border: '1px solid #1a1a2e' }}
        onClick={onOpenPipeline}
        onMouseEnter={e => (e.currentTarget.style.borderColor = '#2a2a45')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
      >
        <Icon size={16} style={{ color: iconColor, flexShrink: 0, marginTop: 1 }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate text-white" title={doc.name}>{doc.name}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={doc.status} />
            {doc.chunkCount > 0 && (
              <span className="text-xs" style={{ color: '#4a5568' }}>{doc.chunkCount.toLocaleString()} chunks</span>
            )}
          </div>
          {doc.summaryStatus && doc.summaryStatus !== 'done' && (
            <SummaryRow status={doc.summaryStatus} />
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          disabled={isDeleting}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
        >
          {isDeleting
            ? <Loader2 size={12} className="animate-spin" style={{ color: '#4a5568' }} />
            : <Trash2 size={12} style={{ color: '#4a5568' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fc8181')}
                onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
              />
          }
        </button>
      </div>
      {deleteError && (
        <p className="text-xs px-3 pb-1" style={{ color: '#fc8181' }}>
          <X size={9} className="inline mr-1" />{deleteError}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: KBDocument['status'] }) {
  if (status === 'indexed')
    return <span className="flex items-center gap-1 text-xs" style={{ color: '#68d391' }}><CheckCircle2 size={10} />Indexed</span>;
  if (status === 'processing')
    return <span className="flex items-center gap-1 text-xs" style={{ color: '#fbbf24' }}><Loader2 size={10} className="animate-spin" />Processing</span>;
  return <span className="flex items-center gap-1 text-xs" style={{ color: '#fc8181' }}><XCircle size={10} />Failed</span>;
}

function SummaryRow({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; spin?: boolean }> = {
    processing: { label: 'Summarising…', color: '#63b3ed', spin: true },
    partial: { label: 'Partial summary', color: '#fbbf24' },
    skipped: { label: 'Summary skipped', color: '#4a5568' },
    failed: { label: 'Summary failed', color: '#fc8181' },
  };
  const cfg = map[status];
  if (!cfg) return null;
  return (
    <div className="flex items-center gap-1 mt-1 text-xs" style={{ color: cfg.color }}>
      {cfg.spin ? <RefreshCw size={9} className="animate-spin" /> : <AlertCircle size={9} />}
      {cfg.label}
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#4a5568' }}>Backend Stack</p>
      {[
        ['LLM', 'Groq · gpt-oss-20b'],
        ['Embeddings', 'BAAI/bge-small-en-v1.5'],
        ['Reranker', 'Cohere rerank-v4.0'],
        ['Vector DB', 'Supabase pgvector'],
        ['Retrieval', 'Hybrid + RRF'],
      ].map(([label, value]) => (
        <div key={label} className="flex items-center justify-between py-2"
          style={{ borderBottom: '1px solid #1a1a2e' }}>
          <span className="text-xs" style={{ color: '#4a5568' }}>{label}</span>
          <span className="text-xs font-mono" style={{ color: '#718096' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

import { useCallback, useRef, useState } from 'react';
import {
  Upload, FileText, File, FileSpreadsheet, FileType2,
  CheckCircle2, Loader2, XCircle, Trash2, AlertCircle, RefreshCw, X,
} from 'lucide-react';
import type { KBDocument } from '../types';
import type { UploadingFile } from '../hooks/useDocuments';
import { ALLOWED_EXTENSIONS } from '../services/api';

interface KnowledgeTabProps {
  documents: KBDocument[];
  loading: boolean;
  fetchError: string | null;
  uploadingFiles: UploadingFile[];
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => Promise<void>;
  deletingIds: Set<string>;
  deleteErrors: Record<string, string>;
  selectedDocumentId: string | null;
  onSelectDocument: (id: string | null) => void;
}

const ACCEPT_ATTR = ['.pdf', '.docx', '.pptx', '.txt', '.csv', '.xlsx', '.html', '.htm'].join(',');

export default function KnowledgeTab({
  documents, loading, fetchError, uploadingFiles,
  onUpload, onDelete, deletingIds, deleteErrors,
  selectedDocumentId, onSelectDocument,
}: KnowledgeTabProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const indexed = documents.filter((d) => d.status === 'indexed').length;
  const processing = documents.filter((d) => d.status === 'processing').length;
  const totalChunks = documents.reduce((s, d) => s + d.chunkCount, 0);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onUpload(files);
  }, [onUpload]);
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onUpload(files);
    e.target.value = '';
  }, [onUpload]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Stats */}
      <div className="px-4 pt-4 pb-3 grid grid-cols-3 gap-2" style={{ borderBottom: '1px solid #1e2433' }}>
        {[
          { label: 'Docs', value: documents.length },
          { label: 'Indexed', value: indexed, accent: true },
          { label: 'Chunks', value: totalChunks },
        ].map(({ label, value, accent }) => (
          <div key={label} className="rounded-lg px-2 py-2.5 text-center" style={{ background: '#161b27', border: '1px solid #1e2433' }}>
            <p className="text-sm font-bold tabular-nums" style={{ color: accent ? '#a78bfa' : '#e2e8f0' }}>{value.toLocaleString()}</p>
            <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Upload zone */}
      <div className="px-4 py-3 space-y-2" style={{ borderBottom: '1px solid #1e2433' }}>
        <div
          role="button" tabIndex={0} aria-label="Upload documents"
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 py-5 rounded-xl cursor-pointer transition-all select-none"
          style={isDragging
            ? { border: '1px dashed #7c3aed', background: 'rgba(124,58,237,0.08)' }
            : { border: '1px dashed #2a3346', background: 'transparent' }
          }
          onMouseEnter={e => { if (!isDragging) e.currentTarget.style.borderColor = 'rgba(124,58,237,0.5)'; }}
          onMouseLeave={e => { if (!isDragging) e.currentTarget.style.borderColor = '#2a3346'; }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={isDragging
              ? { background: 'rgba(124,58,237,0.2)' }
              : { background: '#161b27', border: '1px solid #2a3346' }
            }>
            <Upload size={16} style={{ color: isDragging ? '#a78bfa' : '#4a5568' }} />
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold" style={{ color: isDragging ? '#c4b5fd' : '#718096' }}>
              {isDragging ? 'Drop to upload' : 'Click or drag & drop'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#2d3748' }}>PDF · DOCX · PPTX · TXT · CSV · XLSX</p>
          </div>
        </div>

        <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={handleFileChange} />

        {uploadingFiles.map((u) => <UploadRow key={u.key} item={u} />)}
      </div>

      {/* Error */}
      {fetchError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertCircle size={12} style={{ color: '#fc8181', flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs" style={{ color: '#fc8181' }}>{fetchError}</p>
        </div>
      )}

      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
        {documents.length > 0 && (
          <div className="mb-3">
            <p className="text-xs mb-2" style={{ color: '#4a5568' }}>Search scope</p>
            <button
              onClick={() => onSelectDocument(null)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={selectedDocumentId === null
                ? { background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }
                : { background: '#111620', border: '1px solid #1e2433', color: '#718096' }
              }
              onMouseEnter={e => { if (selectedDocumentId !== null) e.currentTarget.style.borderColor = '#2a3346'; }}
              onMouseLeave={e => { if (selectedDocumentId !== null) e.currentTarget.style.borderColor = '#1e2433'; }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: selectedDocumentId === null ? '#a78bfa' : '#4a5568' }} />
              All documents
            </button>
          </div>
        )}

        {loading && documents.length === 0 ? (
          <LoadingState />
        ) : documents.length === 0 && uploadingFiles.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {processing > 0 && (
              <div className="flex items-center gap-1.5 text-xs mb-2" style={{ color: '#fbbf24' }}>
                <Loader2 size={11} className="animate-spin" />
                <span>{processing} processing…</span>
              </div>
            )}
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id} doc={doc}
                onDelete={onDelete}
                isDeleting={deletingIds.has(doc.id)}
                deleteError={deleteErrors[doc.id] ?? null}
                isSelected={selectedDocumentId === doc.id}
                onSelect={() => onSelectDocument(selectedDocumentId === doc.id ? null : doc.id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function UploadRow({ item }: { item: UploadingFile }) {
  const isError = !!item.error;
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
      style={isError
        ? { background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)' }
        : { background: '#111620', border: '1px solid #1e2433' }
      }>
      <div className="flex-shrink-0 mt-0.5">
        {isError ? <XCircle size={13} style={{ color: '#fc8181' }} />
          : item.progress < 100 ? <Loader2 size={13} className="animate-spin" style={{ color: '#a78bfa' }} />
          : <CheckCircle2 size={13} style={{ color: '#68d391' }} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" style={{ color: '#a0aec0' }}>{item.filename}</p>
        {isError ? (
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#fc8181' }}>{item.error}</p>
        ) : item.progress < 100 ? (
          <div className="mt-1.5">
            <div className="h-1 rounded-full overflow-hidden" style={{ background: '#1e2433' }}>
              <div className="h-full rounded-full transition-all duration-200"
                style={{ width: `${item.progress}%`, background: 'linear-gradient(90deg, #7c3aed, #4f46e5)' }} />
            </div>
            <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>{item.progress}%</p>
          </div>
        ) : (
          <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>Queued for processing</p>
        )}
      </div>
    </div>
  );
}

function DocumentRow({
  doc, onDelete, isDeleting, deleteError, isSelected, onSelect,
}: {
  doc: KBDocument; onDelete: (id: string) => Promise<void>;
  isDeleting: boolean; deleteError: string | null;
  isSelected: boolean; onSelect: () => void;
}) {
  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={isSelected
        ? { border: '1px solid rgba(124,58,237,0.4)', background: 'rgba(124,58,237,0.05)' }
        : { border: '1px solid transparent' }
      }>
      <div
        className="group flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer transition-all"
        onClick={onSelect} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        style={{ background: isSelected ? 'rgba(124,58,237,0.05)' : '#111620' }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#161b27'; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#111620'; }}
      >
        <div className="mt-0.5 flex-shrink-0">{getFileIcon(doc.type)}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: '#a0aec0' }} title={doc.name}>{doc.name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
            <StatusBadge status={doc.status} />
            {doc.chunkCount > 0 && (
              <>
                <span style={{ color: '#1e2433' }}>·</span>
                <span className="text-xs" style={{ color: '#4a5568' }}>{doc.chunkCount.toLocaleString()} chunks</span>
              </>
            )}
          </div>
          {doc.summaryStatus && doc.summaryStatus !== 'done' && (
            <SummaryRow status={doc.summaryStatus} />
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
          disabled={isDeleting}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0"
          aria-label={`Delete ${doc.name}`}
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
        <div className="flex items-center gap-1.5 px-2.5 pb-2 text-xs" style={{ color: '#fc8181' }}>
          <X size={10} className="flex-shrink-0" />{deleteError}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: KBDocument['status'] }) {
  if (status === 'indexed')
    return <div className="flex items-center gap-1 text-xs" style={{ color: '#68d391' }}><CheckCircle2 size={10} />Indexed</div>;
  if (status === 'processing')
    return <div className="flex items-center gap-1 text-xs" style={{ color: '#fbbf24' }}><Loader2 size={10} className="animate-spin" />Processing</div>;
  return <div className="flex items-center gap-1 text-xs" style={{ color: '#fc8181' }}><XCircle size={10} />Failed</div>;
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

function getFileIcon(ext: string) {
  if (ext === 'pdf') return <FileText size={14} style={{ color: '#fc8181' }} />;
  if (ext === 'csv' || ext === 'xlsx') return <FileSpreadsheet size={14} style={{ color: '#68d391' }} />;
  if (ext === 'html' || ext === 'htm') return <FileType2 size={14} style={{ color: '#63b3ed' }} />;
  return <File size={14} style={{ color: '#63b3ed' }} />;
}

function EmptyState() {
  const exts = [...ALLOWED_EXTENSIONS].map((e) => e.slice(1).toUpperCase());
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
        style={{ background: '#161b27', border: '1px solid #2a3346' }}>
        <Upload size={20} style={{ color: '#4a5568' }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: '#718096' }}>No documents yet</p>
      <p className="text-xs mt-1 leading-relaxed" style={{ color: '#4a5568' }}>
        Upload a {exts.slice(0, 3).join(', ')}, or other supported file.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-2 py-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl animate-pulse"
          style={{ background: '#111620' }}>
          <div className="w-3.5 h-3.5 rounded flex-shrink-0" style={{ background: '#161b27' }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 rounded w-3/4" style={{ background: '#161b27' }} />
            <div className="h-2 rounded w-1/2" style={{ background: '#161b27' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

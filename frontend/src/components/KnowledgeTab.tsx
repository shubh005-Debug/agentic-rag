/**
 * src/components/KnowledgeTab.tsx
 *
 * The Knowledge Base tab: upload zone, stats bar, uploading-file progress
 * list, real document list fetched from GET /documents.
 *
 * All data-fetching and mutation is delegated to the useDocuments hook;
 * this component is purely presentational with event wiring.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Upload,
  FileText,
  File,
  FileSpreadsheet,
  FileType2,
  CheckCircle2,
  Loader2,
  XCircle,
  Trash2,
  AlertCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import type { KBDocument } from '../types';
import type { UploadingFile } from '../hooks/useDocuments';
import { ALLOWED_EXTENSIONS } from '../services/api';

// ─── Props ────────────────────────────────────────────────────────────────

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

// ─── Allowed MIME types for the file picker ───────────────────────────────

const ACCEPT_ATTR = [
  '.pdf', '.docx', '.pptx', '.txt', '.csv', '.xlsx', '.html', '.htm',
].join(',');

// ─── Main component ───────────────────────────────────────────────────────

export default function KnowledgeTab({
  documents,
  loading,
  fetchError,
  uploadingFiles,
  onUpload,
  onDelete,
  deletingIds,
  deleteErrors,
  selectedDocumentId,
  onSelectDocument,
}: KnowledgeTabProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const indexed = documents.filter((d) => d.status === 'indexed').length;
  const processing = documents.filter((d) => d.status === 'processing').length;
  const totalChunks = documents.reduce((s, d) => s + d.chunkCount, 0);

  // ── Drag & drop ──────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the drop zone itself, not a child
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onUpload(files);
    },
    [onUpload]
  );

  // ── File picker ──────────────────────────────────────────────────────

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onUpload(files);
      // Reset so selecting the same file again fires onChange
      e.target.value = '';
    },
    [onUpload]
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Stats row ── */}
      <div className="px-4 py-4 border-b border-slate-800 flex gap-3">
        <StatChip label="Total" value={documents.length} />
        <StatChip label="Indexed" value={indexed} accent />
        <StatChip label="Chunks" value={totalChunks} />
      </div>

      {/* ── Upload zone ── */}
      <div className="px-4 py-3 border-b border-slate-800 space-y-2">
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload documents"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          className={`w-full flex flex-col items-center justify-center gap-1.5 py-4 border border-dashed rounded-xl cursor-pointer transition-colors select-none ${
            isDragging
              ? 'border-violet-500 bg-violet-600/10'
              : 'border-slate-700 hover:border-violet-500/50 hover:bg-violet-600/5'
          }`}
        >
          <Upload
            size={18}
            className={`transition-colors ${
              isDragging ? 'text-violet-400' : 'text-slate-500'
            }`}
          />
          <span className="text-xs text-slate-400 font-medium">
            {isDragging ? 'Drop files here' : 'Click or drag & drop'}
          </span>
          <span className="text-xs text-slate-600">
            PDF, DOCX, PPTX, TXT, CSV, XLSX, HTML · max 10 MB
          </span>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Uploading file rows */}
        {uploadingFiles.map((u) => (
          <UploadProgressRow key={u.key} item={u} />
        ))}
      </div>

      {/* ── Fetch error banner ── */}
      {fetchError && (
        <div className="mx-4 mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
          <AlertCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-300">{fetchError}</p>
          </div>
        </div>
      )}

      {/* ── Document list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {/* Filter bar — shown only when documents exist */}
        {documents.length > 0 && (
          <div className="mb-2">
            <p className="text-xs text-slate-500 mb-1.5">Search scope</p>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => onSelectDocument(null)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                  selectedDocumentId === null
                    ? 'bg-violet-600/20 border-violet-500/60 text-violet-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                All documents
              </button>
            </div>
          </div>
        )}

        {loading && documents.length === 0 ? (
          <LoadingState />
        ) : documents.length === 0 && uploadingFiles.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {processing > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400 mb-1">
                <Loader2 size={11} className="animate-spin" />
                <span>{processing} document{processing > 1 ? 's' : ''} processing…</span>
              </div>
            )}
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onDelete={onDelete}
                isDeleting={deletingIds.has(doc.id)}
                deleteError={deleteErrors[doc.id] ?? null}
                isSelected={selectedDocumentId === doc.id}
                onSelect={() =>
                  onSelectDocument(selectedDocumentId === doc.id ? null : doc.id)
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Upload progress row ──────────────────────────────────────────────────

function UploadProgressRow({ item }: { item: UploadingFile }) {
  const isError = !!item.error;

  return (
    <div
      className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border ${
        isError
          ? 'bg-red-500/5 border-red-500/30'
          : 'bg-slate-800/60 border-slate-700'
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {isError ? (
          <XCircle size={13} className="text-red-400" />
        ) : item.progress < 100 ? (
          <Loader2 size={13} className="text-violet-400 animate-spin" />
        ) : (
          <CheckCircle2 size={13} className="text-emerald-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-300 truncate">{item.filename}</p>
        {isError ? (
          <p className="text-xs text-red-400 mt-0.5 leading-relaxed">{item.error}</p>
        ) : item.progress < 100 ? (
          <div className="mt-1.5">
            <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-200"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-600 mt-0.5">{item.progress}%</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">Uploaded — queued for processing</p>
        )}
      </div>
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 bg-slate-800 rounded-lg px-3 py-2 text-center">
      <p
        className={`text-sm font-semibold tabular-nums ${
          accent ? 'text-violet-400' : 'text-white'
        }`}
      >
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-slate-600 mt-0.5">{label}</p>
    </div>
  );
}

// ─── Document row ─────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  onDelete,
  isDeleting,
  deleteError,
  isSelected,
  onSelect,
}: {
  doc: KBDocument;
  onDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
  deleteError: string | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        isSelected
          ? 'border-violet-500/50 bg-violet-600/5'
          : 'border-transparent hover:border-slate-700'
      }`}
    >
      <div
        className={`group flex items-start gap-2.5 p-2.5 rounded-lg transition-colors cursor-pointer ${
          isSelected ? 'bg-violet-600/10' : 'hover:bg-slate-800/60'
        }`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onSelect()}
        title={isSelected ? 'Deselect (search all)' : 'Select to filter search to this document'}
      >
        <div className="mt-0.5 flex-shrink-0">{getFileIcon(doc.type)}</div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-300 truncate" title={doc.name}>
            {doc.name}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
            <StatusBadge status={doc.status} />

            {doc.chunkCount > 0 && (
              <>
                <span className="text-xs text-slate-700">·</span>
                <span className="text-xs text-slate-600">
                  {doc.chunkCount.toLocaleString()} chunks
                </span>
              </>
            )}

            {doc.elementCounts && Object.keys(doc.elementCounts).length > 0 && (
              <>
                <span className="text-xs text-slate-700">·</span>
                <ElementCountBadges counts={doc.elementCounts} />
              </>
            )}
          </div>

          {doc.summaryStatus && doc.summaryStatus !== 'done' && (
            <SummaryStatusRow status={doc.summaryStatus} />
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
          disabled={isDeleting}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0 disabled:cursor-not-allowed"
          title="Delete document"
          aria-label={`Delete ${doc.name}`}
        >
          {isDeleting ? (
            <Loader2 size={13} className="text-slate-500 animate-spin" />
          ) : (
            <Trash2 size={13} className="text-slate-600 hover:text-red-400 transition-colors" />
          )}
        </button>
      </div>

      {/* Delete error — shown below the row */}
      {deleteError && (
        <div className="flex items-center gap-1.5 px-2.5 pb-2 text-xs text-red-400">
          <X size={10} className="flex-shrink-0" />
          {deleteError}
        </div>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: KBDocument['status'] }) {
  switch (status) {
    case 'indexed':
      return (
        <div className="flex items-center gap-1 text-emerald-500">
          <CheckCircle2 size={11} />
          <span className="text-xs">Indexed</span>
        </div>
      );
    case 'processing':
      return (
        <div className="flex items-center gap-1 text-amber-400">
          <Loader2 size={11} className="animate-spin" />
          <span className="text-xs">Processing</span>
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-center gap-1 text-red-400">
          <XCircle size={11} />
          <span className="text-xs">Failed</span>
        </div>
      );
  }
}

// ─── Element count badges ─────────────────────────────────────────────────

function ElementCountBadges({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {entries.map(([type, count]) => (
        <span
          key={type}
          className="text-xs text-slate-600 bg-slate-800 rounded px-1 py-0.5"
        >
          {count} {type}
        </span>
      ))}
    </div>
  );
}

// ─── Summary status ───────────────────────────────────────────────────────

function SummaryStatusRow({ status }: { status: string }) {
  const configs: Record<string, { label: string; color: string; spin?: boolean }> = {
    processing: { label: 'Summarising…', color: 'text-blue-400', spin: true },
    partial: { label: 'Summary partial', color: 'text-amber-400' },
    skipped: { label: 'Summary skipped', color: 'text-slate-500' },
    failed: { label: 'Summary failed', color: 'text-red-400' },
  };
  const cfg = configs[status];
  if (!cfg) return null;

  return (
    <div className={`flex items-center gap-1 mt-1 ${cfg.color}`}>
      {cfg.spin ? (
        <RefreshCw size={9} className="animate-spin" />
      ) : (
        <AlertCircle size={9} />
      )}
      <span className="text-xs">{cfg.label}</span>
    </div>
  );
}

// ─── File icon helper ─────────────────────────────────────────────────────

function getFileIcon(ext: string) {
  if (ext === 'pdf') return <FileText size={14} className="text-red-400" />;
  if (ext === 'csv' || ext === 'xlsx')
    return <FileSpreadsheet size={14} className="text-emerald-400" />;
  if (ext === 'html' || ext === 'htm')
    return <FileType2 size={14} className="text-blue-400" />;
  return <File size={14} className="text-blue-400" />;
}

// ─── Empty / loading states ───────────────────────────────────────────────

function EmptyState() {
  const exts = [...ALLOWED_EXTENSIONS].map((e) => e.slice(1).toUpperCase());
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
      <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-3">
        <Upload size={18} className="text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-400">No documents yet</p>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
        Upload a {exts.slice(0, 3).join(', ')}, or other supported file to start
        building your knowledge base.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-2 py-2">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-800/40 animate-pulse"
        >
          <div className="w-3.5 h-3.5 rounded bg-slate-700 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 bg-slate-700 rounded w-3/4" />
            <div className="h-2 bg-slate-700 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

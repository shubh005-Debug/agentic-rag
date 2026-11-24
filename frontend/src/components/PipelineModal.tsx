/**
 * PipelineModal — Document Processing Pipeline
 * Full-screen modal with step tabs showing real-time processing status.
 * Tabs: Upload → Queued → Partitioning → Chunking → Summarisation → Vectorization & Storage → View Chunks
 */
import { useEffect, useState, useCallback } from 'react';
import {
  X, FileText, CheckCircle2, Loader2, AlertCircle, Eye,
  Search, ChevronRight, Image as ImageIcon, Table2, FileType2,
} from 'lucide-react';
import type { KBDocument } from '../types';
import { getDocumentChunks, getChunkImageUrl, type ApiChunk } from '../services/api';

type Step = 'queued' | 'partitioning' | 'chunking' | 'summarisation' | 'storage' | 'chunks';
type ChunkFilter = 'all' | 'text' | 'image' | 'table';

const STEPS: { key: Step; label: string }[] = [
  { key: 'queued',        label: 'Queued' },
  { key: 'partitioning',  label: 'Partitioning' },
  { key: 'chunking',      label: 'Chunking' },
  { key: 'summarisation', label: 'Summarisation' },
  { key: 'storage',       label: 'Vectorization & Storage' },
  { key: 'chunks',        label: 'View Chunks' },
];

interface Props {
  doc: KBDocument;
  onClose: () => void;
}

function stepFromDoc(doc: KBDocument): Step {
  if (doc.backendStatus === 'uploaded') return 'queued';
  if (doc.backendStatus === 'processing') return 'partitioning';
  if (doc.status === 'failed') return 'queued';
  // processed
  if (doc.summaryStatus === 'processing') return 'summarisation';
  if (doc.summaryStatus === null) return 'chunking';
  return 'chunks';
}

export default function PipelineModal({ doc, onClose }: Props) {
  const activeStep = stepFromDoc(doc);
  const [tab, setTab] = useState<Step>(activeStep);
  const [chunks, setChunks] = useState<ApiChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [filter, setFilter] = useState<ChunkFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedChunk, setSelectedChunk] = useState<ApiChunk | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'summary' | 'original'>('original');

  const isProcessed = doc.status === 'indexed';
  const totalElements = Object.values(doc.elementCounts ?? {}).reduce((s, v) => s + v, 0);

  const loadChunks = useCallback(async () => {
    if (!isProcessed) return;
    setChunksLoading(true);
    try {
      const res = await getDocumentChunks(doc.id);
      setChunks(res.chunks);
    } catch {}
    setChunksLoading(false);
  }, [doc.id, isProcessed]);

  useEffect(() => {
    if (tab === 'chunks') loadChunks();
  }, [tab, loadChunks]);

  const filteredChunks = chunks.filter(c => {
    if (filter === 'text' && c.element_type !== 'Text') return false;
    if (filter === 'image' && c.element_type !== 'Image') return false;
    if (filter === 'table' && c.element_type !== 'Table') return false;
    if (search && !c.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const isStepDone = (step: Step) => {
    const order: Step[] = ['queued', 'partitioning', 'chunking', 'summarisation', 'storage', 'chunks'];
    const activeIdx = order.indexOf(activeStep);
    const stepIdx = order.indexOf(step);
    return stepIdx <= activeIdx && isProcessed;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-5xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0d0d14', border: '1px solid #2a2a45', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #1a1a2e' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
            <FileText size={18} style={{ color: '#a78bfa' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{doc.name}</p>
            <p className="text-xs" style={{ color: '#4a5568' }}>Processing Pipeline</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
            <X size={14} style={{ color: '#718096' }} />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex overflow-x-auto flex-shrink-0" style={{ borderBottom: '1px solid #1a1a2e' }}>
          {STEPS.map(({ key, label }) => {
            const done = isStepDone(key);
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex items-center gap-1.5 px-4 py-3.5 text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
                style={active
                  ? { color: '#a78bfa', borderBottom: '2px solid #6d28d9' }
                  : { color: done ? '#718096' : '#3a3a55', borderBottom: '2px solid transparent' }
                }
              >
                {done && !active && <CheckCircle2 size={11} style={{ color: '#68d391' }} />}
                {label}
              </button>
            );
          })}
        </div>

        {/* Body: left content + right inspector */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left pane */}
          <div className="flex-1 overflow-y-auto p-6">

            {tab === 'queued' && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                  style={{ background: 'rgba(104,211,145,0.1)', border: '2px solid #68d391' }}>
                  <CheckCircle2 size={30} style={{ color: '#68d391' }} />
                </div>
                <p className="text-lg font-bold text-white mb-1">Queued</p>
                <p className="text-sm mb-6" style={{ color: '#718096' }}>File queued for processing</p>
                <div className="w-full max-w-sm rounded-xl px-5 py-3.5 flex items-center gap-2"
                  style={{ background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.3)' }}>
                  <CheckCircle2 size={16} style={{ color: '#68d391', flexShrink: 0 }} />
                  <span className="text-sm font-medium" style={{ color: '#68d391' }}>Step completed successfully</span>
                </div>
              </div>
            )}

            {tab === 'partitioning' && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                {doc.status === 'processing' ? (
                  <>
                    <Loader2 size={40} className="animate-spin mb-4" style={{ color: '#a78bfa' }} />
                    <p className="text-lg font-bold text-white mb-1">Partitioning</p>
                    <p className="text-sm" style={{ color: '#718096' }}>Extracting elements from document…</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                      style={{ background: 'rgba(104,211,145,0.1)', border: '2px solid #68d391' }}>
                      <CheckCircle2 size={30} style={{ color: '#68d391' }} />
                    </div>
                    <p className="text-lg font-bold text-white mb-1">Partitioning</p>
                    <p className="text-sm mb-4" style={{ color: '#718096' }}>Document partitioned into elements</p>
                    <div className="rounded-xl px-6 py-4 w-full max-w-sm"
                      style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                      <p className="text-3xl font-bold mb-1" style={{ color: '#a78bfa' }}>{totalElements}</p>
                      <p className="text-sm" style={{ color: '#718096' }}>atomic elements extracted</p>
                      {doc.elementCounts && (
                        <div className="flex justify-center gap-3 mt-3 flex-wrap">
                          {Object.entries(doc.elementCounts).map(([type, count]) => (
                            <span key={type} className="text-xs rounded-lg px-2.5 py-1"
                              style={{ background: '#1a1a2e', color: '#a0aec0' }}>
                              {count} {type}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="w-full max-w-sm rounded-xl px-5 py-3.5 flex items-center gap-2 mt-4"
                      style={{ background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.3)' }}>
                      <CheckCircle2 size={16} style={{ color: '#68d391', flexShrink: 0 }} />
                      <span className="text-sm font-medium" style={{ color: '#68d391' }}>Step completed successfully</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'chunking' && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xl font-bold text-white mb-1">Chunking</p>
                <p className="text-sm mb-6" style={{ color: '#718096' }}>Creating semantic chunks</p>
                {isProcessed ? (
                  <>
                    <div className="rounded-xl p-5 w-full max-w-md mb-4"
                      style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                      <p className="text-xs font-semibold mb-4" style={{ color: '#a78bfa' }}>Chunking Results</p>
                      <div className="rounded-xl px-6 py-5 flex items-center justify-center gap-6"
                        style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
                        <div className="text-center">
                          <p className="text-3xl font-bold text-white">{totalElements}</p>
                          <p className="text-xs mt-1" style={{ color: '#718096' }}>atomic elements</p>
                        </div>
                        <ChevronRight size={20} style={{ color: '#4a5568' }} />
                        <div className="text-center">
                          <p className="text-3xl font-bold" style={{ color: '#68d391' }}>{doc.chunkCount}</p>
                          <p className="text-xs mt-1" style={{ color: '#718096' }}>chunks created</p>
                        </div>
                      </div>
                    </div>
                    <div className="w-full max-w-md rounded-xl px-5 py-3.5 flex items-center gap-2"
                      style={{ background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.3)' }}>
                      <CheckCircle2 size={16} style={{ color: '#68d391', flexShrink: 0 }} />
                      <span className="text-sm font-medium" style={{ color: '#68d391' }}>Step completed successfully</span>
                    </div>
                  </>
                ) : (
                  <Loader2 size={30} className="animate-spin" style={{ color: '#a78bfa' }} />
                )}
              </div>
            )}

            {tab === 'summarisation' && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xl font-bold text-white mb-1">Summarisation</p>
                <p className="text-sm mb-6" style={{ color: '#718096' }}>Enhancing content with AI summaries for images and tables</p>
                {doc.summaryStatus === 'processing' ? (
                  <div className="rounded-xl p-5 w-full max-w-md"
                    style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                    <p className="text-xs font-semibold mb-4" style={{ color: '#a78bfa' }}>🤖 AI Summarising Progress</p>
                    <div className="rounded-xl p-5 mb-3"
                      style={{ background: '#0d0d14', border: '1px solid #1a1a2e' }}>
                      <Loader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: '#a78bfa' }} />
                      <p className="text-sm" style={{ color: '#718096' }}>Processing chunks…</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl px-5 py-3.5 flex items-center gap-2 w-full max-w-md"
                      style={doc.summaryStatus === 'done'
                        ? { background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.3)' }
                        : { background: '#111118', border: '1px solid #1a1a2e' }
                      }>
                      {doc.summaryStatus === 'done'
                        ? <CheckCircle2 size={16} style={{ color: '#68d391' }} />
                        : <AlertCircle size={16} style={{ color: '#fbbf24' }} />
                      }
                      <span className="text-sm font-medium"
                        style={{ color: doc.summaryStatus === 'done' ? '#68d391' : '#fbbf24' }}>
                        {doc.summaryStatus === 'done' ? 'Summarisation complete' :
                         doc.summaryStatus === 'skipped' ? 'Skipped — too many chunks' :
                         doc.summaryStatus === 'failed' ? 'Summarisation failed' :
                         doc.summaryStatus === 'partial' ? 'Partial summary' : 'Not summarised'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'storage' && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-xl font-bold text-white mb-1">Vectorization & Storage</p>
                <p className="text-sm mb-6" style={{ color: '#718096' }}>Embedding chunks and storing in vector database</p>
                {isProcessed ? (
                  <>
                    <div className="rounded-xl p-5 w-full max-w-md mb-4"
                      style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                      <div className="flex justify-around">
                        <div className="text-center">
                          <p className="text-2xl font-bold" style={{ color: '#a78bfa' }}>{doc.chunkCount}</p>
                          <p className="text-xs mt-1" style={{ color: '#718096' }}>vectors stored</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-white">384</p>
                          <p className="text-xs mt-1" style={{ color: '#718096' }}>dimensions</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold" style={{ color: '#68d391' }}>pgvector</p>
                          <p className="text-xs mt-1" style={{ color: '#718096' }}>backend</p>
                        </div>
                      </div>
                    </div>
                    <div className="w-full max-w-md rounded-xl px-5 py-3.5 flex items-center gap-2"
                      style={{ background: 'rgba(104,211,145,0.08)', border: '1px solid rgba(104,211,145,0.3)' }}>
                      <CheckCircle2 size={16} style={{ color: '#68d391', flexShrink: 0 }} />
                      <span className="text-sm font-medium" style={{ color: '#68d391' }}>Step completed successfully</span>
                    </div>
                  </>
                ) : (
                  <Loader2 size={30} className="animate-spin" style={{ color: '#a78bfa' }} />
                )}
              </div>
            )}

            {tab === 'chunks' && (
              <div>
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <p className="font-bold text-white">Content Chunks</p>
                  <p className="text-sm" style={{ color: '#4a5568' }}>{filteredChunks.length} of {chunks.length} chunks</p>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {(['all', 'text', 'image', 'table'] as ChunkFilter[]).map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
                      style={filter === f
                        ? { background: 'rgba(109,40,217,0.2)', border: '1px solid #6d28d9', color: '#a78bfa' }
                        : { background: '#111118', border: '1px solid #1a1a2e', color: '#718096' }
                      }>
                      {f}
                    </button>
                  ))}
                  <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 ml-auto"
                    style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                    <Search size={12} style={{ color: '#4a5568' }} />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search chunks..."
                      className="bg-transparent text-xs outline-none w-32"
                      style={{ color: '#a0aec0' }}
                    />
                  </div>
                </div>

                {/* Chunk list */}
                {chunksLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2" style={{ color: '#4a5568' }}>
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Loading chunks…</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredChunks.map(chunk => (
                      <div
                        key={chunk.id}
                        onClick={() => { setSelectedChunk(chunk); setInspectorTab('original'); }}
                        className="rounded-xl p-4 cursor-pointer transition-all"
                        style={selectedChunk?.id === chunk.id
                          ? { background: '#1a1a2e', border: '1px solid #6d28d9' }
                          : { background: '#111118', border: '1px solid #1a1a2e' }
                        }
                        onMouseEnter={e => { if (selectedChunk?.id !== chunk.id) e.currentTarget.style.borderColor = '#2a2a45'; }}
                        onMouseLeave={e => { if (selectedChunk?.id !== chunk.id) e.currentTarget.style.borderColor = '#1a1a2e'; }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <ChunkTypeBadge type={chunk.element_type} />
                          {chunk.has_image && <ChunkTypeBadge type="Image" />}
                          <span className="text-xs" style={{ color: '#4a5568' }}>
                            {chunk.page_number != null ? `Page ${chunk.page_number}` : ''}
                          </span>
                          <span className="ml-auto text-xs" style={{ color: '#4a5568' }}>
                            {chunk.content.length.toLocaleString()} chars
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: '#718096' }}>
                          {chunk.content}
                        </p>
                      </div>
                    ))}
                    {filteredChunks.length === 0 && (
                      <p className="text-sm text-center py-8" style={{ color: '#4a5568' }}>No chunks match your filter</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Detail Inspector */}
          <div className="w-80 flex-shrink-0 overflow-y-auto"
            style={{ borderLeft: '1px solid #1a1a2e', background: '#0a0a0f' }}>
            <div className="px-4 py-4" style={{ borderBottom: '1px solid #1a1a2e' }}>
              <p className="text-sm font-bold text-white">Detail Inspector</p>
            </div>

            {!selectedChunk ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
                  <Eye size={20} style={{ color: '#4a5568' }} />
                </div>
                <p className="text-xs" style={{ color: '#4a5568' }}>
                  {tab === 'chunks' ? 'Select a chunk to inspect details' : 'Chunks will be available when processing completes'}
                </p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {/* Tabs */}
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a45' }}>
                  {(['summary', 'original'] as const).map(t => (
                    <button key={t} onClick={() => setInspectorTab(t)}
                      className="flex-1 py-2 text-xs font-semibold capitalize transition-all"
                      style={inspectorTab === t
                        ? { background: '#1a1a2e', color: '#a78bfa' }
                        : { background: 'transparent', color: '#4a5568' }
                      }>
                      {t === 'summary' ? '📄 Summary' : '🗂 Original'}
                    </button>
                  ))}
                </div>

                {/* Type badges */}
                <div className="flex gap-1.5 flex-wrap">
                  <ChunkTypeBadge type={selectedChunk.element_type} />
                  {selectedChunk.has_image && <ChunkTypeBadge type="Image" />}
                </div>

                {inspectorTab === 'original' ? (
                  <>
                    <div>
                      <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#4a5568' }}>Original Text</p>
                      <div className="rounded-xl p-3 max-h-48 overflow-y-auto"
                        style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: '#a0aec0' }}>
                          {selectedChunk.content}
                        </p>
                      </div>
                    </div>

                    {/* Image */}
                    {selectedChunk.has_image && (
                      <div>
                        <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#4a5568' }}>
                          Images (1)
                        </p>
                        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #2a2a45' }}>
                          <img
                            src={getChunkImageUrl(selectedChunk.document_id, selectedChunk.id)}
                            alt="chunk image"
                            className="w-full object-contain max-h-48"
                            style={{ background: '#111118' }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Table HTML */}
                    {selectedChunk.table_html && (
                      <div>
                        <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#4a5568' }}>Table</p>
                        <div className="rounded-xl overflow-x-auto p-3"
                          style={{ background: '#111118', border: '1px solid rgba(245,158,11,0.2)' }}>
                          <style>{`
                            .ins-table table{width:100%;border-collapse:collapse}
                            .ins-table th{background:#1a1a2e;padding:5px 8px;text-align:left;color:#c4b5fd;font-size:10px;border:1px solid #2a2a45}
                            .ins-table td{padding:4px 8px;border:1px solid #1a1a2e;color:#a0aec0;font-size:10px}
                            .ins-table tr:nth-child(even) td{background:rgba(255,255,255,0.02)}
                          `}</style>
                          <div className="ins-table" dangerouslySetInnerHTML={{ __html: selectedChunk.table_html }} />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: '#4a5568' }}>Content</p>
                    <div className="rounded-xl p-3 max-h-64 overflow-y-auto"
                      style={{ background: '#111118', border: '1px solid #1a1a2e' }}>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: '#a0aec0' }}>
                        {selectedChunk.summary ?? selectedChunk.image_caption ?? '— No summary yet —'}
                      </p>
                    </div>
                    {selectedChunk.image_caption && (
                      <div className="mt-3 rounded-xl p-3"
                        style={{ background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)' }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: '#38bdf8' }}>AI Image Caption</p>
                        <p className="text-xs italic leading-relaxed" style={{ color: '#7dd3fc' }}>
                          {selectedChunk.image_caption}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChunkTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === 'image') return (
    <span className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-0.5 font-semibold"
      style={{ background: 'rgba(14,165,233,0.1)', color: '#38bdf8', border: '1px solid rgba(14,165,233,0.3)' }}>
      <ImageIcon size={9} />image
    </span>
  );
  if (t === 'table') return (
    <span className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-0.5 font-semibold"
      style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>
      <Table2 size={9} />table
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs rounded-md px-2 py-0.5 font-semibold"
      style={{ background: 'rgba(104,211,145,0.1)', color: '#68d391', border: '1px solid rgba(104,211,145,0.3)' }}>
      <FileType2 size={9} />text
    </span>
  );
}

import { useState } from 'react';
import { Database, Settings, Cpu, Lock, Layers, Zap } from 'lucide-react';
import type { UseDocumentsReturn } from '../hooks/useDocuments';
import KnowledgeTab from './KnowledgeTab';

interface RightPanelProps {
  selectedDocumentId: string | null;
  onSelectDocument: (id: string | null) => void;
  docState: UseDocumentsReturn;
}

type Tab = 'knowledge' | 'settings';

const BACKEND_STACK = [
  { label: 'LLM', value: 'Groq · gpt-oss-20b' },
  { label: 'Embeddings', value: 'BAAI/bge-small-en-v1.5' },
  { label: 'Reranker', value: 'Cohere rerank-v4.0' },
  { label: 'Vector DB', value: 'Supabase pgvector' },
  { label: 'Retrieval', value: 'Hybrid + RRF' },
  { label: 'Parser', value: 'Unstructured.io' },
];

export default function RightPanel({ selectedDocumentId, onSelectDocument, docState }: RightPanelProps) {
  const [tab, setTab] = useState<Tab>('knowledge');

  return (
    <aside className="flex flex-col h-full" style={{ background: '#0d1117', borderLeft: '1px solid #1e2433' }}>

      {/* Tab bar */}
      <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid #1e2433' }}>
        {(['knowledge', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-semibold transition-all"
            style={tab === t
              ? { color: '#a78bfa', borderBottom: '2px solid #7c3aed' }
              : { color: '#4a5568', borderBottom: '2px solid transparent' }
            }
          >
            {t === 'knowledge' ? <Database size={12} /> : <Settings size={12} />}
            {t === 'knowledge' ? 'Knowledge Base' : 'Stack'}
          </button>
        ))}
      </div>

      {tab === 'knowledge' ? (
        <KnowledgeTab
          documents={docState.documents}
          loading={docState.loading}
          fetchError={docState.fetchError}
          uploadingFiles={docState.uploadingFiles}
          onUpload={docState.upload}
          onDelete={docState.remove}
          deletingIds={docState.deletingIds}
          deleteErrors={docState.deleteErrors}
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={onSelectDocument}
        />
      ) : (
        <StackTab />
      )}
    </aside>
  );
}

function StackTab() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">

      {/* Backend stack — read only */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={13} style={{ color: '#4a5568' }} />
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#4a5568' }}>Backend Stack</h3>
        </div>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e2433' }}>
          {BACKEND_STACK.map(({ label, value }, i) => (
            <div
              key={label}
              className="flex items-center justify-between px-3 py-2.5"
              style={i < BACKEND_STACK.length - 1 ? { borderBottom: '1px solid #1e2433' } : {}}
            >
              <span className="text-xs" style={{ color: '#4a5568' }}>{label}</span>
              <div className="flex items-center gap-1.5 rounded px-2 py-1"
                style={{ background: '#161b27', border: '1px solid #2a3346' }}>
                <Lock size={9} style={{ color: '#2d3748' }} />
                <span className="text-xs font-mono" style={{ color: '#718096' }}>{value}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2 flex items-center gap-1" style={{ color: '#2d3748' }}>
          <Lock size={9} />
          Configured in backend — not editable from UI
        </p>
      </div>

      {/* Pipeline info */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Layers size={13} style={{ color: '#4a5568' }} />
          <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#4a5568' }}>RAG Pipeline</h3>
        </div>
        <div className="space-y-2">
          {[
            { step: '1', label: 'Upload & Parse', desc: 'Unstructured.io extracts text, tables, images' },
            { step: '2', label: 'Chunk & Embed', desc: 'BGE-small embeddings via FastEmbed' },
            { step: '3', label: 'Hybrid Retrieve', desc: 'Vector + BM25 keyword → RRF fusion' },
            { step: '4', label: 'Rerank', desc: 'Cohere reranker scores top-K chunks' },
            { step: '5', label: 'Generate', desc: 'Groq LLM synthesises the final answer' },
          ].map(({ step, label, desc }) => (
            <div key={step} className="flex gap-3 p-3 rounded-xl" style={{ background: '#111620', border: '1px solid #1e2433' }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}>
                {step}
              </div>
              <div>
                <p className="text-xs font-semibold" style={{ color: '#a0aec0' }}>{label}</p>
                <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status dot */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: '#111620', border: '1px solid #1e2433' }}>
        <Zap size={12} style={{ color: '#68d391' }} />
        <span className="text-xs" style={{ color: '#718096' }}>All systems operational</span>
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500" />
      </div>

    </div>
  );
}

/**
 * src/components/RightPanel.tsx
 *
 * Two-tab right panel:
 *   • Knowledge Base — real documents from useDocuments (live API)
 *   • Settings       — backend stack info (read-only) + demo sliders (not sent to backend)
 *
 * Document state is owned by WorkspacePage and passed in via `docState` so
 * CenterPanel can share the same document list for source name resolution
 * without double-fetching.
 */

import { useState } from 'react';
import {
  Cpu,
  Database,
  FlaskConical,
  GitMerge,
  Info,
  Layers,
  Lock,
  Settings,
} from 'lucide-react';
import type { UseDocumentsReturn } from '../hooks/useDocuments';
import KnowledgeTab from './KnowledgeTab';

// Used only by the demo Settings tab — not fetched from or saved to the backend.
interface ProjectSettings {
  projectId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topK: number;
  similarityThreshold: number;
  systemPrompt: string;
}

// Backend stack values are sourced from the backend code — not from env vars.
// Update these if you change the models in the backend.
const BACKEND_LLM_MODEL = 'openai/gpt-oss-20b';
const BACKEND_EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5';
const BACKEND_RERANKER_MODEL = 'rerank-v4.0-fast';


// ─── Props ────────────────────────────────────────────────────────────────

interface RightPanelProps {
  selectedDocumentId: string | null;
  onSelectDocument: (id: string | null) => void;
  /** Document state lifted from WorkspacePage — shared with CenterPanel. */
  docState: UseDocumentsReturn;
}

type RightTab = 'knowledge' | 'settings';


// ─── Root component ───────────────────────────────────────────────────────

export default function RightPanel({
  selectedDocumentId,
  onSelectDocument,
  docState,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightTab>('knowledge');

  // Default settings for the demo Settings tab.
  const defaultSettings = {
    projectId: '',
    model: 'openai/gpt-oss-20b',
    temperature: 0.2,
    maxTokens: 2048,
    topK: 5,
    similarityThreshold: 0.75,
    systemPrompt: '',
  };

  return (
    <aside className="flex flex-col h-full bg-slate-900 border-l border-slate-800">

      {/* Tab bar */}
      <div className="flex border-b border-slate-800 flex-shrink-0">
        <TabButton
          label="Knowledge Base"
          icon={<Database size={13} />}
          active={activeTab === 'knowledge'}
          onClick={() => setActiveTab('knowledge')}
        />
        <TabButton
          label="Settings"
          icon={<Settings size={13} />}
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
        />
      </div>

      {activeTab === 'knowledge' ? (
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
        <SettingsTab settings={defaultSettings} />
      )}

    </aside>
  );
}


// ─── Tab button ───────────────────────────────────────────────────────────

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors border-b-2 ${
        active
          ? 'border-violet-500 text-violet-400'
          : 'border-transparent text-slate-500 hover:text-slate-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}


// ─── Settings tab ─────────────────────────────────────────────────────────
// The sliders and system prompt are local state only — they are NOT sent
// to the backend. To wire them up, add fields to AskRequest in api.ts and
// pass them from CenterPanel.handleSend.

function SettingsTab({ settings }: { settings: ProjectSettings }) {
  const [localSettings, setLocalSettings] = useState(settings);

  function update<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

      {/* Backend stack — read-only display */}
      <SettingsSection title="Backend Stack" icon={<Cpu size={13} />}>
        <ReadonlyField label="LLM (Groq)" value={BACKEND_LLM_MODEL} />
        <ReadonlyField label="Embeddings (FastEmbed)" value={BACKEND_EMBEDDING_MODEL} />
        <ReadonlyField label="Reranker (Cohere)" value={BACKEND_RERANKER_MODEL} />
        <ReadonlyField label="Vector Store" value="Supabase pgvector" />
        <ReadonlyField label="Retrieval Strategy" value="Hybrid Search + RRF" />
        <p className="text-xs text-slate-600 flex items-center gap-1 mt-1">
          <Lock size={10} />
          Configured in the backend — not editable from the UI.
        </p>
      </SettingsSection>

      {/* Retrieval — demo only */}
      <DemoSection
        title="Retrieval"
        icon={<Layers size={13} />}
        note="Not yet sent to the backend. Wire these to AskRequest to activate."
      >
        <SliderField
          label="Top-K documents"
          value={localSettings.topK}
          min={1} max={20} step={1}
          onChange={(v) => update('topK', v)}
          display={String(localSettings.topK)}
        />
        <SliderField
          label="Similarity threshold"
          value={localSettings.similarityThreshold}
          min={0} max={1} step={0.05}
          onChange={(v) => update('similarityThreshold', v)}
          display={localSettings.similarityThreshold.toFixed(2)}
        />
      </DemoSection>

      {/* Generation — demo only */}
      <DemoSection
        title="Generation"
        icon={<GitMerge size={13} />}
        note="Not yet sent to the backend."
      >
        <SliderField
          label="Temperature"
          value={localSettings.temperature}
          min={0} max={2} step={0.1}
          onChange={(v) => update('temperature', v)}
          display={localSettings.temperature.toFixed(1)}
        />
        <SliderField
          label="Max tokens"
          value={localSettings.maxTokens}
          min={256} max={8192} step={256}
          onChange={(v) => update('maxTokens', v)}
          display={localSettings.maxTokens.toLocaleString()}
        />
      </DemoSection>

      {/* System prompt — demo only */}
      <DemoSection
        title="System Prompt"
        icon={<Info size={13} />}
        note="Stored locally only — not yet forwarded to the backend."
      >
        <textarea
          value={localSettings.systemPrompt}
          onChange={(e) => update('systemPrompt', e.target.value)}
          rows={6}
          className="w-full bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-2.5 outline-none focus:border-violet-500 transition-colors resize-none leading-relaxed"
        />
      </DemoSection>

      {/* Save button — stub */}
      {/* TODO: call a backend endpoint when implemented */}
      <button className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
        <FlaskConical size={14} />
        Save (not yet connected)
      </button>

    </div>
  );
}


// ─── Shared sub-components ────────────────────────────────────────────────

function SettingsSection({
  title, icon, children,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-slate-500">{icon}</span>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function DemoSection({
  title, icon, note, children,
}: {
  title: string; icon: React.ReactNode; note: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-slate-500">{icon}</span>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h3>
        <span className="ml-auto text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded px-1.5 py-0.5">
          demo
        </span>
      </div>
      <p className="text-xs text-slate-600 mb-3 leading-relaxed">{note}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700/60 rounded px-2 py-1">
        <Lock size={9} className="text-slate-600" />
        <span className="text-xs font-mono text-slate-300">{value}</span>
      </div>
    </div>
  );
}

function SliderField({
  label, value, min, max, step, onChange, display,
}: {
  label: string; value: number; min: number; max: number;
  step: number; onChange: (v: number) => void; display: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-slate-400">{label}</label>
        <span className="text-xs font-mono text-violet-400 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5">
          {display}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none bg-slate-700 rounded-full outline-none cursor-pointer accent-violet-500"
      />
    </div>
  );
}

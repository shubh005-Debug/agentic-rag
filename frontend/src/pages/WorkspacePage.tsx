/**
 * src/pages/WorkspacePage.tsx
 *
 * Root layout: three-panel workspace (left sidebar / center chat / right panel).
 *
 * All data is now live from the backend:
 *   - projects       → useProjects
 *   - conversations  → useConversations (re-fetches when active project changes)
 *   - messages       → useMessages (re-fetches when active conversation changes)
 *   - documents      → useDocuments
 *
 * selectedDocumentId — UUID scoping /ask to one document, or null for all docs.
 */

import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import CenterPanel from '../components/CenterPanel';
import LeftPanel from '../components/LeftPanel';
import RightPanel from '../components/RightPanel';
import { useDocuments } from '../hooks/useDocuments';
import { useProjects } from '../hooks/useProjects';
import { useConversations } from '../hooks/useConversations';
import { useMessages } from '../hooks/useMessages';

export default function WorkspacePage() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  // ── Projects ──────────────────────────────────────────────────────────
  const projectsState = useProjects();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Auto-select the first project once they load.
  useEffect(() => {
    if (!activeProjectId && projectsState.projects.length > 0) {
      setActiveProjectId(projectsState.projects[0].id);
    }
  }, [projectsState.projects, activeProjectId]);

  // ── Conversations ─────────────────────────────────────────────────────
  const conversationsState = useConversations(activeProjectId);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Auto-select the first conversation when the project (or its conversation
  // list) changes.
  useEffect(() => {
    if (conversationsState.conversations.length > 0) {
      setActiveConversationId(conversationsState.conversations[0].id);
    } else {
      setActiveConversationId(null);
    }
  }, [activeProjectId, conversationsState.conversations]);

  // ── Messages ──────────────────────────────────────────────────────────
  const messagesState = useMessages(activeConversationId);

  // ── Documents ─────────────────────────────────────────────────────────
  const docState = useDocuments();

  // ── Derived values ────────────────────────────────────────────��───────
  const activeProject = projectsState.projects.find((p) => p.id === activeProjectId) ?? null;
  const activeConversation =
    conversationsState.conversations.find((c) => c.id === activeConversationId) ?? null;

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleNewProject() {
    const name = window.prompt('Project name:');
    if (!name?.trim()) return;
    const project = await projectsState.create(name.trim());
    if (project) setActiveProjectId(project.id);
  }

  async function handleNewConversation() {
    if (!activeProjectId) return;
    const conv = await conversationsState.create('New conversation');
    if (conv) setActiveConversationId(conv.id);
  }

  function handleSelectProject(id: string) {
    setActiveProjectId(id);
    // Conversations re-fetch via useConversations; auto-select happens in
    // the useEffect above.
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">

      {/* ── Left panel ── */}
      <div
        className={`flex-shrink-0 transition-all duration-200 ${
          leftOpen ? 'w-64' : 'w-0 overflow-hidden'
        }`}
      >
        <LeftPanel
          projects={projectsState.projects}
          conversations={conversationsState.conversations}
          activeProjectId={activeProjectId}
          activeConversationId={activeConversationId}
          loading={projectsState.loading}
          onSelectProject={handleSelectProject}
          onSelectConversation={setActiveConversationId}
          onNewProject={handleNewProject}
          onNewConversation={handleNewConversation}
          onDeleteConversation={conversationsState.remove}
          onDeleteProject={projectsState.remove}
        />
      </div>

      {/* ── Center panel ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Panel toggle buttons */}
        <div className="absolute top-4 left-3 z-10 flex gap-1">
          <button
            onClick={() => setLeftOpen((v) => !v)}
            className="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 flex items-center justify-center transition-colors backdrop-blur-sm"
            title={leftOpen ? 'Collapse left panel' : 'Expand left panel'}
          >
            {leftOpen ? (
              <PanelLeftClose size={13} className="text-slate-400" />
            ) : (
              <PanelLeftOpen size={13} className="text-slate-400" />
            )}
          </button>
        </div>

        <div className="absolute top-4 right-3 z-10">
          <button
            onClick={() => setRightOpen((v) => !v)}
            className="w-7 h-7 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 flex items-center justify-center transition-colors backdrop-blur-sm"
            title={rightOpen ? 'Collapse right panel' : 'Expand right panel'}
          >
            {rightOpen ? (
              <PanelRightClose size={13} className="text-slate-400" />
            ) : (
              <PanelRightOpen size={13} className="text-slate-400" />
            )}
          </button>
        </div>

        <CenterPanel
          project={activeProject}
          conversation={activeConversation}
          messagesState={messagesState}
          selectedDocumentId={selectedDocumentId}
          documents={docState.documents}
          onRenameConversation={conversationsState.rename}
        />
      </div>

      {/* ── Right panel ── */}
      <div
        className={`flex-shrink-0 transition-all duration-200 ${
          rightOpen ? 'w-80' : 'w-0 overflow-hidden'
        }`}
      >
        <RightPanel
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={setSelectedDocumentId}
          docState={docState}
        />
      </div>

    </div>
  );
}

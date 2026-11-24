/**
 * WorkspacePage — root three-panel layout.
 * Zero mock data. All state comes from backend via hooks.
 */

import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
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

  // Modal state for new project
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // ── Projects ──────────────────────────────────────────────────────────
  const projectsState = useProjects();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId && projectsState.projects.length > 0)
      setActiveProjectId(projectsState.projects[0].id);
  }, [projectsState.projects, activeProjectId]);

  // ── Conversations ─────────────────────────────────────────────────────
  const conversationsState = useConversations(activeProjectId);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (conversationsState.conversations.length > 0)
      setActiveConversationId(conversationsState.conversations[0].id);
    else
      setActiveConversationId(null);
  }, [activeProjectId, conversationsState.conversations]);

  // ── Messages / Documents ──────────────────────────────────────────────
  const messagesState = useMessages(activeConversationId);
  const docState = useDocuments();

  const activeProject = projectsState.projects.find((p) => p.id === activeProjectId) ?? null;
  const activeConversation = conversationsState.conversations.find((c) => c.id === activeConversationId) ?? null;

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      const project = await projectsState.create(newProjectName.trim(), newProjectDesc.trim());
      if (project) setActiveProjectId(project.id);
      setShowNewProject(false);
      setNewProjectName('');
      setNewProjectDesc('');
    } finally {
      setCreating(false);
    }
  }

  async function handleNewConversation() {
    if (!activeProjectId) return;
    const conv = await conversationsState.create('New conversation');
    if (conv) setActiveConversationId(conv.id);
  }

  const toggleStyle = {
    background: 'rgba(13,17,23,0.85)',
    border: '1px solid #2a3346',
    backdropFilter: 'blur(8px)',
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#090c14' }}>

      {/* ── Left panel ── */}
      <div className={`flex-shrink-0 transition-all duration-200 ${leftOpen ? 'w-64' : 'w-0 overflow-hidden'}`}>
        <LeftPanel
          projects={projectsState.projects}
          conversations={conversationsState.conversations}
          activeProjectId={activeProjectId}
          activeConversationId={activeConversationId}
          loading={projectsState.loading}
          onSelectProject={setActiveProjectId}
          onSelectConversation={setActiveConversationId}
          onNewProject={() => setShowNewProject(true)}
          onNewConversation={handleNewConversation}
          onDeleteConversation={conversationsState.remove}
          onDeleteProject={projectsState.remove}
        />
      </div>

      {/* ── Center panel ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Panel toggles */}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          <button onClick={() => setLeftOpen((v) => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={toggleStyle}
            title={leftOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {leftOpen
              ? <PanelLeftClose size={13} style={{ color: '#718096' }} />
              : <PanelLeftOpen size={13} style={{ color: '#718096' }} />
            }
          </button>
        </div>

        <div className="absolute top-3 right-3 z-10">
          <button onClick={() => setRightOpen((v) => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={toggleStyle}
            title={rightOpen ? 'Collapse panel' : 'Expand panel'}
          >
            {rightOpen
              ? <PanelRightClose size={13} style={{ color: '#718096' }} />
              : <PanelRightOpen size={13} style={{ color: '#718096' }} />
            }
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
      <div className={`flex-shrink-0 transition-all duration-200 ${rightOpen ? 'w-80' : 'w-0 overflow-hidden'}`}>
        <RightPanel
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={setSelectedDocumentId}
          docState={docState}
        />
      </div>

      {/* ── New project modal ── */}
      {showNewProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewProject(false); }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-6 space-y-5"
            style={{ background: '#111620', border: '1px solid #2a3346' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">New Project</h2>
              <button
                onClick={() => setShowNewProject(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                style={{ background: '#161b27', border: '1px solid #2a3346' }}
              >
                <X size={13} style={{ color: '#718096' }} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: '#718096' }}>
                  Project name <span style={{ color: '#fc8181' }}>*</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  placeholder="e.g. Legal Documents, Research Papers…"
                  maxLength={100}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-all"
                  style={{ background: '#161b27', border: '1px solid #2a3346' }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(124,58,237,0.6)')}
                  onBlur={e => (e.target.style.borderColor = '#2a3346')}
                />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: '#718096' }}>
                  Description <span style={{ color: '#4a5568' }}>(optional)</span>
                </label>
                <textarea
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="What kind of documents will this project contain?"
                  rows={3}
                  maxLength={300}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none transition-all"
                  style={{ background: '#161b27', border: '1px solid #2a3346', color: '#a0aec0' }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(124,58,237,0.6)')}
                  onBlur={e => (e.target.style.borderColor = '#2a3346')}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowNewProject(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: '#161b27', border: '1px solid #2a3346', color: '#718096' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || creating}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all text-white"
                style={newProjectName.trim() && !creating
                  ? { background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }
                  : { background: '#2a3346', cursor: 'not-allowed', opacity: 0.5, color: '#718096' }
                }
              >
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

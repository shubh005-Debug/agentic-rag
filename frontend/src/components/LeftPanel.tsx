/**
 * LeftPanel — project + conversation sidebar.
 * No mock data. All data comes from the backend via props.
 */

import { useState } from 'react';
import {
  ChevronRight,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  FolderPlus,
} from 'lucide-react';
import type { ApiConversation, ApiProject } from '../services/api';

interface LeftPanelProps {
  projects: ApiProject[];
  conversations: ApiConversation[];
  activeProjectId: string | null;
  activeConversationId: string | null;
  loading: boolean;
  onSelectProject: (id: string) => void;
  onSelectConversation: (id: string) => void;
  onNewProject: () => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function LeftPanel({
  projects,
  conversations,
  activeProjectId,
  activeConversationId,
  loading,
  onSelectProject,
  onSelectConversation,
  onNewProject,
  onNewConversation,
  onDeleteConversation,
  onDeleteProject,
}: LeftPanelProps) {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const effectiveExpanded = expandedId ?? activeProjectId;

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const activeConvs = conversations.filter(
    (c) => c.project_id === effectiveExpanded,
  );

  function toggleProject(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
    onSelectProject(id);
  }

  return (
    <aside className="flex flex-col h-full" style={{ background: '#0d1117', borderRight: '1px solid #1e2433' }}>

      {/* ── Logo / header ── */}
      <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid #1e2433' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            <Sparkles size={15} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">RAG Studio</p>
            <p className="text-xs mt-0.5" style={{ color: '#4a5568' }}>AI Knowledge Base</p>
          </div>
        </div>
        <button
          onClick={onNewProject}
          title="New project"
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{ background: '#161b27', border: '1px solid #2a3346' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#7c3aed')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a3346')}
        >
          <Plus size={14} style={{ color: '#7c6fcd' }} />
        </button>
      </div>

      {/* ── Search ── */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: '#161b27', border: '1px solid #2a3346' }}>
          <Search size={13} style={{ color: '#4a5568', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-xs outline-none w-full"
            style={{ color: '#a0aec0' }}
          />
        </div>
      </div>

      {/* ── Project list ── */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest px-2 py-2 mb-1" style={{ color: '#2d3748' }}>
          Projects
        </p>

        {loading && projects.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-4" style={{ color: '#4a5568' }}>
            <Loader2 size={13} className="animate-spin" />
            <span className="text-xs">Loading…</span>
          </div>
        )}

        {!loading && projects.length === 0 && (
          <button
            onClick={onNewProject}
            className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl transition-all"
            style={{ border: '1px dashed #2a3346', color: '#4a5568' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#7c6fcd'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3346'; e.currentTarget.style.color = '#4a5568'; }}
          >
            <FolderPlus size={22} />
            <span className="text-xs font-medium">Create your first project</span>
          </button>
        )}

        <div className="space-y-0.5">
          {filtered.map((project) => {
            const isExpanded = effectiveExpanded === project.id;
            const isActive = activeProjectId === project.id;

            return (
              <div key={project.id}>
                {/* Project row */}
                <div
                  className="group flex items-center rounded-lg transition-all"
                  style={{
                    background: isActive ? '#161b27' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#111620'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <button
                    onClick={() => toggleProject(project.id)}
                    className="flex-1 flex items-center gap-2 px-2 py-2.5 text-left"
                  >
                    <ChevronRight
                      size={12}
                      className="flex-shrink-0 transition-transform duration-150"
                      style={{
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        color: isExpanded ? '#7c3aed' : '#2d3748',
                      }}
                    />
                    <FolderOpen
                      size={14}
                      className="flex-shrink-0"
                      style={{ color: isActive ? '#7c6fcd' : '#4a5568' }}
                    />
                    <span
                      className="flex-1 text-xs font-semibold truncate"
                      style={{ color: isActive ? '#e2e8f0' : '#718096' }}
                    >
                      {project.name}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${project.name}"?`)) onDeleteProject(project.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity pr-2"
                    title="Delete project"
                  >
                    <Trash2 size={11} style={{ color: '#4a5568' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#fc8181')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
                    />
                  </button>
                </div>

                {/* Conversations */}
                {isExpanded && (
                  <div className="ml-5 mt-0.5 space-y-0.5 mb-1">
                    {activeConvs.length === 0 && (
                      <p className="text-xs px-3 py-1.5" style={{ color: '#2d3748' }}>
                        No conversations yet
                      </p>
                    )}
                    {activeConvs.map((conv) => {
                      const isCActive = activeConversationId === conv.id;
                      return (
                        <div
                          key={conv.id}
                          className="group flex items-center rounded-lg transition-all"
                          style={{
                            background: isCActive ? 'rgba(124,58,237,0.12)' : 'transparent',
                            border: isCActive ? '1px solid rgba(124,58,237,0.3)' : '1px solid transparent',
                          }}
                          onMouseEnter={e => { if (!isCActive) e.currentTarget.style.background = '#111620'; }}
                          onMouseLeave={e => { if (!isCActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                          <button
                            onClick={() => onSelectConversation(conv.id)}
                            className="flex-1 flex items-start gap-2 px-2.5 py-2 text-left"
                          >
                            <MessageSquare
                              size={11}
                              className="flex-shrink-0 mt-0.5"
                              style={{ color: isCActive ? '#7c6fcd' : '#4a5568' }}
                            />
                            <div className="flex-1 min-w-0">
                              <p
                                className="text-xs font-medium truncate"
                                style={{ color: isCActive ? '#c4b5fd' : '#718096' }}
                              >
                                {conv.title}
                              </p>
                              <p className="text-xs mt-0.5" style={{ color: '#2d3748' }}>
                                {relativeTime(conv.updated_at)}
                              </p>
                            </div>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity pr-2"
                          >
                            <Trash2 size={10} style={{ color: '#4a5568' }}
                              onMouseEnter={e => (e.currentTarget.style.color = '#fc8181')}
                              onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
                            />
                          </button>
                        </div>
                      );
                    })}

                    <button
                      onClick={onNewConversation}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all text-left"
                      style={{ color: '#4a5568' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#7c6fcd'; e.currentTarget.style.background = '#111620'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#4a5568'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Plus size={11} />
                      <span className="text-xs">New conversation</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid #1e2433' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            S
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: '#a0aec0' }}>Shubham</p>
            <p className="text-xs" style={{ color: '#2d3748' }}>Developer</p>
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="Connected" />
        </div>
      </div>

    </aside>
  );
}

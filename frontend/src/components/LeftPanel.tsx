/**
 * src/components/LeftPanel.tsx
 *
 * Left sidebar: project list, conversations per project, search, user footer.
 * All data comes from the backend via useProjects + useConversations in WorkspacePage.
 */

import { useState } from 'react';
import {
  Archive,
  ChevronRight,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
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
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return 'just now';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [manualExpandId, setManualExpandId] = useState<string | null>(null);

  const expandedProjectId = manualExpandId ?? activeProjectId;

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const projectConversations = conversations.filter(
    (c) => c.project_id === expandedProjectId,
  );

  function toggleProject(id: string) {
    setManualExpandId((prev) => (prev === id ? null : id));
    onSelectProject(id);
  }

  return (
    <aside className="flex flex-col h-full bg-slate-900 border-r border-slate-800">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <span className="font-semibold text-white text-sm tracking-tight">RAG Studio</span>
        </div>
        <button
          onClick={onNewProject}
          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-violet-600 border border-slate-700 hover:border-violet-500 flex items-center justify-center transition-colors group"
          title="New project"
        >
          <Plus size={14} className="text-slate-400 group-hover:text-white transition-colors" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2">
          <Search size={13} className="text-slate-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search projects…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-sm text-slate-300 placeholder-slate-600 outline-none w-full"
          />
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        <p className="text-xs font-medium text-slate-600 uppercase tracking-wider px-2 py-2">
          Projects
        </p>

        {loading && projects.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-4 text-slate-600">
            <Loader2 size={13} className="animate-spin" />
            <span className="text-xs">Loading…</span>
          </div>
        )}

        {!loading && projects.length === 0 && (
          <p className="text-xs text-slate-600 px-3 py-4">
            No projects yet — click + to create one.
          </p>
        )}

        {filtered.map((project) => {
          const isExpanded = expandedProjectId === project.id;
          const isActive = activeProjectId === project.id;

          return (
            <div key={project.id}>
              {/* Project row */}
              <div className={`group flex items-center gap-0.5 rounded-lg transition-colors ${
                isActive ? 'bg-slate-800' : 'hover:bg-slate-800/60'
              }`}>
                <button
                  onClick={() => toggleProject(project.id)}
                  className="flex-1 flex items-center gap-2.5 px-2.5 py-2 text-left"
                >
                  <ChevronRight
                    size={13}
                    className={`flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''} text-slate-600`}
                  />
                  <FolderOpen
                    size={14}
                    className={`flex-shrink-0 ${isActive ? 'text-violet-400' : 'text-slate-500'}`}
                  />
                  <span className={`flex-1 text-sm truncate font-medium ${isActive ? 'text-white' : 'text-slate-400'}`}>
                    {project.name}
                  </span>
                  <span className="text-xs text-slate-600 tabular-nums">
                    {projectConversations.length > 0 && isExpanded
                      ? projectConversations.length
                      : ''}
                  </span>
                </button>

                {/* Delete project — visible on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete project "${project.name}" and all its conversations?`)) {
                      onDeleteProject(project.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity pr-2 flex-shrink-0"
                  title="Delete project"
                >
                  <Trash2 size={12} className="text-slate-600 hover:text-red-400 transition-colors" />
                </button>
              </div>

              {/* Conversations under expanded project */}
              {isExpanded && (
                <div className="ml-6 mt-0.5 space-y-0.5">
                  {projectConversations.length === 0 && (
                    <p className="text-xs text-slate-700 px-2.5 py-1.5">No conversations yet</p>
                  )}

                  {projectConversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`group flex items-center rounded-lg transition-colors ${
                        activeConversationId === conv.id
                          ? 'bg-violet-600/20 border border-violet-500/30'
                          : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <button
                        onClick={() => onSelectConversation(conv.id)}
                        className="flex-1 flex items-start gap-2 px-2.5 py-2 text-left"
                      >
                        <MessageSquare size={12} className="flex-shrink-0 mt-0.5 text-slate-500" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${
                            activeConversationId === conv.id ? 'text-violet-300' : 'text-slate-400'
                          }`}>
                            {conv.title}
                          </p>
                          <p className="text-xs text-slate-600 truncate mt-0.5">
                            {relativeTime(conv.updated_at)}
                          </p>
                        </div>
                      </button>

                      {/* Delete conversation */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conv.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity pr-2 flex-shrink-0"
                        title="Delete conversation"
                      >
                        <Trash2 size={11} className="text-slate-600 hover:text-red-400 transition-colors" />
                      </button>
                    </div>
                  ))}

                  {/* New conversation */}
                  <button
                    onClick={onNewConversation}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-slate-600 hover:text-violet-400 hover:bg-slate-800/60 transition-colors"
                  >
                    <Plus size={12} />
                    <span className="text-xs">New conversation</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-xs font-semibold text-white">
            S
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-300 truncate">Shubham</p>
            <p className="text-xs text-slate-600">Pro plan</p>
          </div>
        </div>
      </div>

    </aside>
  );
}

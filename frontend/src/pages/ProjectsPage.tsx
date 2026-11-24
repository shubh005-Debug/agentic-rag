/**
 * ProjectsPage — /projects
 * Grid of project cards, matches the OpenSlate design.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, Sparkles, Trash2, Loader2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import CreateProjectModal from '../components/CreateProjectModal';
import { listProjects, deleteProject, getApiErrorMessage, type ApiProject } from '../services/api';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!confirm('Delete this project and all its data?')) return;
    try {
      await deleteProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch {}
  }

  function handleCreated(id: string) {
    setShowCreate(false);
    navigate(`/projects/${id}`);
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto px-10 py-8" style={{ paddingLeft: 60 }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Projects</h1>
            <p className="text-sm mt-1" style={{ color: '#4a5568' }}>
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}
          >
            <Plus size={15} />
            New project
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 py-16 justify-center" style={{ color: '#4a5568' }}>
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading projects…</span>
          </div>
        )}

        {/* Empty */}
        {!loading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
              <FolderOpen size={28} style={{ color: '#4a5568' }} />
            </div>
            <p className="text-base font-semibold text-white mb-1">No projects yet</p>
            <p className="text-sm mb-6" style={{ color: '#4a5568' }}>Create a project to start building your knowledge base</p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}
            >
              <Sparkles size={15} />
              Create your first project
            </button>
          </div>
        )}

        {/* Grid */}
        {!loading && projects.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <div
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                className="group relative rounded-2xl p-5 cursor-pointer transition-all"
                style={{ background: '#111118', border: '1px solid #1a1a2e' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#6d28d9')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a2e')}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, rgba(109,40,217,0.2), rgba(79,70,229,0.2))', border: '1px solid rgba(109,40,217,0.3)' }}>
                    <FolderOpen size={18} style={{ color: '#a78bfa' }} />
                  </div>
                  <button
                    onClick={e => handleDelete(e, p.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}
                    title="Delete project"
                  >
                    <Trash2 size={12} style={{ color: '#718096' }} />
                  </button>
                </div>
                <h3 className="font-bold text-white text-sm mb-1 truncate">{p.name}</h3>
                {p.description && (
                  <p className="text-xs line-clamp-2 mb-3" style={{ color: '#718096' }}>{p.description}</p>
                )}
                <p className="text-xs" style={{ color: '#4a5568' }}>Updated {timeAgo(p.updated_at)}</p>
              </div>
            ))}

            {/* Add card */}
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-2xl p-5 flex flex-col items-center justify-center gap-2 transition-all min-h-[140px]"
              style={{ background: 'transparent', border: '1px dashed #2a2a45' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#6d28d9')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a45')}
            >
              <Plus size={22} style={{ color: '#4a5568' }} />
              <span className="text-sm font-medium" style={{ color: '#4a5568' }}>New project</span>
            </button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
    </AppShell>
  );
}

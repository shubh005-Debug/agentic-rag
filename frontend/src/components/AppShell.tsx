/**
 * AppShell — persistent left sidebar + main content area.
 * Matches the OpenSlate sidebar: logo, New project button, Projects link.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutGrid, Plus, Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import CreateProjectModal from './CreateProjectModal';

interface AppShellProps {
  children: React.ReactNode;
  /** Extra content in the sidebar below the nav (e.g. conversation list) */
  sidebarExtra?: React.ReactNode;
}

export default function AppShell({ children, sidebarExtra }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  function handleCreated(id: string) {
    setShowCreate(false);
    navigate(`/projects/${id}`);
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0f', color: '#e2e8f0' }}>

      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden"
        style={{
          width: sidebarOpen ? 220 : 0,
          background: '#0d0d14',
          borderRight: '1px solid #1a1a2e',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4" style={{ borderBottom: '1px solid #1a1a2e' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}>
            <Sparkles size={15} className="text-white" />
          </div>
          <span className="font-bold text-sm text-white whitespace-nowrap">RAG Studio</span>
        </div>

        {/* New project button */}
        <div className="px-3 pt-3">
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{ background: '#1a1a2e', border: '1px solid #2a2a45', color: '#a78bfa' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#6d28d9'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2a45'}
          >
            <Plus size={15} />
            New project
          </button>
        </div>

        {/* Nav */}
        <nav className="px-3 pt-2">
          <Link
            to="/projects"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
            style={{ color: '#718096' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
            onMouseLeave={e => (e.currentTarget.style.color = '#718096')}
          >
            <LayoutGrid size={15} />
            Projects
          </Link>
        </nav>

        {/* Extra (conversations list etc.) */}
        {sidebarExtra && (
          <div className="flex-1 overflow-y-auto mt-2">
            {sidebarExtra}
          </div>
        )}
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="absolute top-3 left-3 z-20 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
          style={{ background: 'rgba(13,13,20,0.9)', border: '1px solid #2a2a45' }}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen
            ? <PanelLeftClose size={13} style={{ color: '#718096' }} />
            : <PanelLeftOpen size={13} style={{ color: '#718096' }} />
          }
        </button>

        {children}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

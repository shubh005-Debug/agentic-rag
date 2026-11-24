import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { createProject } from '../services/api';
import { getApiErrorMessage } from '../services/api';

interface Props {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export default function CreateProjectModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const project = await createProject(name.trim(), desc.trim());
      onCreated(project.id);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: '#111118', border: '1px solid #2a2a45' }}>
        {/* Header */}
        <div className="flex items-start gap-4 px-6 pt-6 pb-4" style={{ borderBottom: '1px solid #1a1a2e' }}>
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }}>
            <Sparkles size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-white">Create new project</h2>
            <p className="text-sm mt-0.5" style={{ color: '#718096' }}>Start organizing your knowledge</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
            style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
            <X size={14} style={{ color: '#718096' }} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-2 text-white">Project name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g., Research Analysis, Meeting Notes..."
              maxLength={100}
              className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
              style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}
              onFocus={e => (e.target.style.borderColor = '#6d28d9')}
              onBlur={e => (e.target.style.borderColor = '#2a2a45')}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2 text-white">
              Description <span style={{ color: '#4a5568', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What will this project be about?"
              rows={4}
              maxLength={300}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none transition-all"
              style={{ background: '#1a1a2e', border: '1px solid #2a2a45', color: '#a0aec0' }}
              onFocus={e => (e.target.style.borderColor = '#6d28d9')}
              onBlur={e => (e.target.style.borderColor = '#2a2a45')}
            />
          </div>
          {error && <p className="text-sm" style={{ color: '#fc8181' }}>{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 space-y-3">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: '#1a1a2e', border: '1px solid #2a2a45', color: '#718096' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all"
              style={name.trim() && !loading
                ? { background: 'linear-gradient(135deg, #6d28d9, #4f46e5)' }
                : { background: '#2a2a45', cursor: 'not-allowed', opacity: 0.5 }
              }
            >
              <Sparkles size={14} />
              {loading ? 'Creating...' : 'Create project'}
            </button>
          </div>
          <p className="text-xs text-center" style={{ color: '#4a5568' }}>
            You can add documents and start chatting once your project is created
          </p>
        </div>
      </div>
    </div>
  );
}

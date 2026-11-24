/**
 * src/hooks/useProjects.ts
 *
 * Manages the project list:
 *   - Fetches all projects from GET /projects on mount
 *   - create(name, description) → POST /projects
 *   - remove(id)                → DELETE /projects/{id}
 *   - rename(id, name)          → PATCH /projects/{id}
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type ApiProject,
  createProject,
  deleteProject,
  getApiErrorMessage,
  listProjects,
  updateProject,
} from '../services/api';

export interface UseProjectsReturn {
  projects: ApiProject[];
  loading: boolean;
  error: string | null;
  create: (name: string, description?: string) => Promise<ApiProject | null>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchProjects().finally(() => setLoading(false));
  }, [fetchProjects]);

  const create = useCallback(
    async (name: string, description = '') => {
      try {
        const project = await createProject(name, description);
        // Prepend so it appears at the top of the list.
        setProjects((prev) => [project, ...prev]);
        return project;
      } catch (err) {
        setError(getApiErrorMessage(err));
        return null;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    try {
      const updated = await updateProject(id, { name });
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, []);

  return { projects, loading, error, create, remove, rename };
}

/**
 * src/hooks/useConversations.ts
 *
 * Manages conversations for the active project:
 *   - Re-fetches whenever projectId changes
 *   - create(title) → POST /projects/{id}/conversations
 *   - remove(id)    → DELETE /conversations/{id}
 *   - rename(id, title) → PATCH /conversations/{id}
 */

import { useCallback, useEffect, useState } from 'react';
import {
  type ApiConversation,
  createConversation,
  deleteConversation,
  getApiErrorMessage,
  listConversations,
  renameConversation,
} from '../services/api';

export interface UseConversationsReturn {
  conversations: ApiConversation[];
  loading: boolean;
  error: string | null;
  create: (title?: string) => Promise<ApiConversation | null>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
}

export function useConversations(projectId: string | null): UseConversationsReturn {
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async (pid: string) => {
    try {
      const data = await listConversations(pid);
      setConversations(data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setConversations([]);
      return;
    }
    setLoading(true);
    fetchConversations(projectId).finally(() => setLoading(false));
  }, [projectId, fetchConversations]);

  const create = useCallback(
    async (title = 'New conversation') => {
      if (!projectId) return null;
      try {
        const conv = await createConversation(projectId, title);
        setConversations((prev) => [conv, ...prev]);
        return conv;
      } catch (err) {
        setError(getApiErrorMessage(err));
        return null;
      }
    },
    [projectId],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      const updated = await renameConversation(id, title);
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, []);

  return { conversations, loading, error, create, remove, rename };
}

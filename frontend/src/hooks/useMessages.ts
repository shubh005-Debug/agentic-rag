/**
 * src/hooks/useMessages.ts
 *
 * Loads and saves messages for the active conversation.
 *
 *   - Fetches history from GET /conversations/{id}/messages when conversationId changes
 *   - saveUserMessage(content)              → POST to save user turn
 *   - saveAssistantMessage(content, sources) → POST to save assistant turn
 *
 * CenterPanel calls these after sending/receiving so history survives a refresh.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AskSource } from '../services/api';
import {
  type ApiMessage,
  getApiErrorMessage,
  listMessages,
  saveMessage,
} from '../services/api';

export interface UseMessagesReturn {
  messages: ApiMessage[];
  loading: boolean;
  error: string | null;
  saveUserMessage: (content: string) => Promise<ApiMessage | null>;
  saveAssistantMessage: (content: string, sources: AskSource[]) => Promise<ApiMessage | null>;
}

export function useMessages(conversationId: string | null): UseMessagesReturn {
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    listMessages(conversationId)
      .then((data) => {
        setMessages(data);
        setError(null);
      })
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [conversationId]);

  const saveUserMessage = useCallback(
    async (content: string) => {
      if (!conversationId) return null;
      try {
        const msg = await saveMessage(conversationId, 'user', content);
        setMessages((prev) => [...prev, msg]);
        return msg;
      } catch (err) {
        setError(getApiErrorMessage(err));
        return null;
      }
    },
    [conversationId],
  );

  const saveAssistantMessage = useCallback(
    async (content: string, sources: AskSource[]) => {
      if (!conversationId) return null;
      try {
        const msg = await saveMessage(conversationId, 'assistant', content, sources);
        setMessages((prev) => [...prev, msg]);
        return msg;
      } catch (err) {
        setError(getApiErrorMessage(err));
        return null;
      }
    },
    [conversationId],
  );

  return { messages, loading, error, saveUserMessage, saveAssistantMessage };
}

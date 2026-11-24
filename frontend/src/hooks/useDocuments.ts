/**
 * src/hooks/useDocuments.ts
 *
 * Owns the full document lifecycle for the Knowledge Base panel:
 *   - Fetches documents from GET /documents on mount
 *   - Polls every 2.5 s while any document is still processing
 *   - Uploads files via POST /upload with per-file progress tracking
 *   - Deletes documents via DELETE /documents/{id}
 *
 * Lifted to WorkspacePage so both CenterPanel (needs document names to
 * resolve source UUIDs) and RightPanel (shows the document list) share
 * the same fetch without double-calling the API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ApiDocument,
  deleteDocument as apiDelete,
  getApiErrorMessage,
  listDocuments,
  uploadDocument,
  validateFile,
} from '../services/api';
import type { KBDocument } from '../types';

const POLL_INTERVAL_MS = 2500;

/** Backend statuses that mean processing is still ongoing. */
const IN_PROGRESS_STATUSES = new Set(['uploaded', 'processing']);

/** Map a raw backend status string to the display status shown in the UI. */
function toDisplayStatus(backendStatus: string): KBDocument['status'] {
  if (backendStatus === 'processed') return 'indexed';
  if (backendStatus === 'failed') return 'failed';
  return 'processing';
}

/** Convert a raw API document to the KBDocument shape used by the UI. */
function toKBDocument(d: ApiDocument): KBDocument {
  const ext = d.filename.split('.').pop()?.toLowerCase() ?? '';
  return {
    id: d.id,
    name: d.filename,
    type: ext,
    status: toDisplayStatus(d.status),
    backendStatus: d.status,
    uploadedAt: d.created_at,
    chunkCount: d.total_chunks ?? 0,
    elementCounts: d.element_counts ?? null,
    summaryStatus: d.summary_status,
  };
}


// ─── Per-file upload state ────────────────────────────────────────────────

export interface UploadingFile {
  /** Unique key for React reconciliation */
  key: string;
  filename: string;
  /** 0–100; 100 means the HTTP transfer finished */
  progress: number;
  /** Set once the server responds with an error */
  error: string | null;
}


// ─── Hook return type ─────────────────────────────────────────────────────

export interface UseDocumentsReturn {
  documents: KBDocument[];
  loading: boolean;
  fetchError: string | null;
  uploadingFiles: UploadingFile[];
  upload: (files: File[]) => void;
  remove: (id: string) => Promise<void>;
  deletingIds: Set<string>;
  deleteErrors: Record<string, string>;
}


// ─── Hook ─────────────────────────────────────────────────────────────────

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  // Interval reference — cleared when polling is no longer needed or on unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // ── Fetch ──────────────────────────────────────────────────────────────

  const fetchDocuments = useCallback(async () => {
    try {
      const raw = await listDocuments();
      setDocuments(raw.map(toKBDocument));
      setFetchError(null);
      return raw;
    } catch (err) {
      setFetchError(getApiErrorMessage(err));
      return null;
    }
  }, []);


  // ── Polling ────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    // Never start a second interval if one is already running.
    if (pollRef.current !== null) return;

    pollRef.current = setInterval(async () => {
      const raw = await fetchDocuments();
      if (!raw) return;

      // Stop polling once every document has finished processing.
      const anyInProgress = raw.some((d) => IN_PROGRESS_STATUSES.has(d.status));
      if (!anyInProgress) stopPolling();
    }, POLL_INTERVAL_MS);
  }, [fetchDocuments, stopPolling]);


  // ── Initial load ───────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;

    async function init() {
      setLoading(true);
      const raw = await fetchDocuments();
      if (!alive) return;
      setLoading(false);

      // Start polling immediately if any document is still processing.
      if (raw && raw.some((d) => IN_PROGRESS_STATUSES.has(d.status))) {
        startPolling();
      }
    }

    void init();

    return () => {
      alive = false;
      stopPolling();
    };
  }, [fetchDocuments, startPolling, stopPolling]);


  // ── Upload ─────────────────────────────────────────────────────────────

  const upload = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      files.forEach((file) => {
        const key = `${file.name}-${Date.now()}-${Math.random()}`;

        // Run client-side validation before sending anything to the server.
        const validationError = validateFile(file);
        if (validationError) {
          setUploadingFiles((prev) => [
            ...prev,
            { key, filename: file.name, progress: 0, error: validationError },
          ]);
          // Auto-remove the error entry after 6 s.
          setTimeout(() => {
            setUploadingFiles((prev) => prev.filter((u) => u.key !== key));
          }, 6000);
          return;
        }

        // Add an in-progress entry immediately so the user sees feedback.
        setUploadingFiles((prev) => [
          ...prev,
          { key, filename: file.name, progress: 0, error: null },
        ]);

        uploadDocument(file, (percent) => {
          setUploadingFiles((prev) =>
            prev.map((u) => (u.key === key ? { ...u, progress: percent } : u)),
          );
        })
          .then(() => {
            // Remove the progress entry and refresh the document list.
            setUploadingFiles((prev) => prev.filter((u) => u.key !== key));
            fetchDocuments().then((raw) => {
              if (raw && raw.some((d) => IN_PROGRESS_STATUSES.has(d.status))) {
                startPolling();
              }
            });
          })
          .catch((err) => {
            const message = getApiErrorMessage(err);
            setUploadingFiles((prev) =>
              prev.map((u) =>
                u.key === key ? { ...u, progress: 0, error: message } : u,
              ),
            );
            // Auto-remove the error entry after 8 s.
            setTimeout(() => {
              setUploadingFiles((prev) => prev.filter((u) => u.key !== key));
            }, 8000);
          });
      });
    },
    [fetchDocuments, startPolling],
  );


  // ── Delete ─────────────────────────────────────────────────────────────

  const remove = useCallback(
    async (id: string) => {
      setDeletingIds((prev) => new Set(prev).add(id));
      // Clear any previous error for this document.
      setDeleteErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      try {
        await apiDelete(id);
        await fetchDocuments();
      } catch (err) {
        setDeleteErrors((prev) => ({
          ...prev,
          [id]: getApiErrorMessage(err),
        }));
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [fetchDocuments],
  );

  return {
    documents,
    loading,
    fetchError,
    uploadingFiles,
    upload,
    remove,
    deletingIds,
    deleteErrors,
  };
}

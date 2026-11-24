/**
 * src/services/api.ts
 *
 * Typed Axios client for the FastAPI RAG backend.
 *
 * Base URL is read from the VITE_API_BASE_URL env var (set in .env).
 * Default when the var is not set: http://localhost:8000
 *
 * All functions are pure — no React state, can be called from anywhere.
 *
 * Live endpoints:
 *   GET  /                             → checkHealth()
 *   GET  /documents                    → listDocuments()
 *   POST /upload                       → uploadDocument()
 *   DELETE /documents/{id}             → deleteDocument()
 *   POST /ask                          → askQuestion()
 *
 * Defined but not yet wired to the UI (backend endpoints exist):
 *   GET  /documents/{id}/chunks        → getDocumentChunks()
 *   GET  /documents/{id}/chunks/{cid}/image  → getChunkImageUrl() (returns a URL)
 */

import axios, { type AxiosProgressEvent } from 'axios';

// ─── Axios instance ───────────────────────────────────────────────────────

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  // Do NOT set Content-Type here — the browser must set it automatically
  // for multipart/form-data uploads (to include the correct boundary).
});


// ─── Response type definitions ────────────────────────────────────────────

/** Element type breakdown: { Text: 38, Table: 3, Image: 1 } */
export type ElementCounts = Record<string, number>;

/** Summary pipeline status values */
export type SummaryStatus =
  | 'processing'
  | 'done'
  | 'partial'
  | 'skipped'
  | 'failed'
  | null;

/** Document status values returned by the backend */
export type BackendDocStatus = 'uploaded' | 'processing' | 'processed' | 'failed';

/** A single document record from GET /documents */
export interface ApiDocument {
  id: string;
  filename: string;
  storage_path: string;
  status: BackendDocStatus;
  created_at: string;
  summary_status: SummaryStatus;
  total_chunks: number | null;
  element_counts: ElementCounts | null;
}

/** Response body of GET /documents */
interface ListDocumentsResponse {
  documents: ApiDocument[];
}

/** Response body of POST /upload */
export interface UploadResponse {
  message: string;
  document: {
    id: string;
    filename: string;
    storage_path: string;
    status: BackendDocStatus;
    created_at: string;
  };
  task_id: string;
}

/** Response body of DELETE /documents/{id} */
export interface DeleteDocumentResponse {
  message: string;
  document_id: string;
}

/** Response body of GET / */
export interface HealthResponse {
  message: string;
  supabase: string;
}

/** Request body for POST /ask */
export interface AskRequest {
  question: string;
  /** UUID string — omit or null to search all documents */
  document_id?: string | null;
}

/** A single source chunk returned by POST /ask */
export interface AskSource {
  id: string;             // chunk UUID
  document_id: string;   // document UUID
  content: string;
  chunk_index: number;
  page_number: number | null;
  similarity: number | null;
  rrf_score: number | null;
  rerank_score: number | null;
  element_type: string | null;   // "Text" | "Table" | "Image"
  table_html: string | null;     // HTML for table chunks
  image_caption: string | null;  // AI caption for image chunks
  has_image: boolean | null;     // true when an image file is stored
}

/** Response body of POST /ask */
export interface AskResponse {
  answer: string;
  sources: AskSource[];
}

// ─── Projects ─────────────────────────────────────────────────────────────

export interface ApiProject {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ApiConversation {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ApiMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: AskSource[] | null;
  created_at: string;
}

// ─── Chunk listing ────────────────────────────────────────────────────────

/** A single chunk record from GET /documents/{id}/chunks */
export interface ApiChunk {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  page_number: number | null;
  element_type: string | null;
  table_html: string | null;
  image_caption: string | null;
  summary: string | null;
  has_image: boolean;
}

/** Response body of GET /documents/{id}/chunks */
export interface GetChunksResponse {
  document_id: string;
  chunks: ApiChunk[];
}


// ─── API functions ────────────────────────────────────────────────────────

/** GET /  — quick health check to confirm the backend is reachable. */
export async function checkHealth(): Promise<HealthResponse> {
  const res = await apiClient.get<HealthResponse>('/');
  return res.data;
}

/** GET /documents  — returns all documents ordered newest-first. */
export async function listDocuments(): Promise<ApiDocument[]> {
  const res = await apiClient.get<ListDocumentsResponse>('/documents');
  return res.data.documents;
}

/**
 * POST /upload  — uploads a single file as multipart/form-data.
 * @param file        The File object selected by the user.
 * @param onProgress  Optional callback receiving 0–100 during the upload.
 */
export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);  // must match the FastAPI field name exactly

  const res = await apiClient.post<UploadResponse>('/upload', form, {
    headers: { 'Content-Type': undefined },  // let the browser set the boundary
    onUploadProgress(event: AxiosProgressEvent) {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });

  return res.data;
}

/** DELETE /documents/{id}  — removes the document, chunks, and storage objects. */
export async function deleteDocument(
  documentId: string,
): Promise<DeleteDocumentResponse> {
  const res = await apiClient.delete<DeleteDocumentResponse>(
    `/documents/${documentId}`,
  );
  return res.data;
}

/** POST /ask  — sends a question to the RAG pipeline and returns the answer + sources. */
export async function askQuestion(request: AskRequest): Promise<AskResponse> {
  const res = await apiClient.post<AskResponse>('/ask', request);
  return res.data;
}

/**
 * GET /documents/{id}/chunks  — lists all chunks for a document.
 * Not yet wired to a UI component, but the backend endpoint is ready.
 */
export async function getDocumentChunks(
  documentId: string,
): Promise<GetChunksResponse> {
  const res = await apiClient.get<GetChunksResponse>(
    `/documents/${documentId}/chunks`,
  );
  return res.data;
}

/**
 * Returns the URL for a chunk's image.
 * Use as: <img src={getChunkImageUrl(documentId, chunkId)} />
 * The backend serves the image directly — no auth header needed.
 */
export function getChunkImageUrl(documentId: string, chunkId: string): string {
  return `${BASE_URL}/documents/${documentId}/chunks/${chunkId}/image`;
}


// ─── Error helper ─────────────────────────────────────────────────────────

/**
 * Extract a user-readable message from an Axios error.
 * FastAPI returns { detail: "..." } for HTTPException responses.
 */
export function getApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (err.response?.status === 413) return 'File is too large (max 10 MB).';
    if (err.response?.status === 409) return detail ?? 'This file already exists.';
    if (err.response?.status === 400) return detail ?? 'Invalid file.';
    if (!err.response) return 'Cannot reach the backend. Is it running?';
  }
  return 'An unexpected error occurred.';
}


// ─── Client-side file validation ──────────────────────────────────────────
// These mirror the backend's ALLOWED_EXTENSIONS and MAX_FILE_SIZE so the
// user gets an instant error before a byte is sent to the server.

export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.pptx', '.txt', '.csv', '.xlsx', '.html', '.htm',
]);

export const MAX_FILE_BYTES = 10 * 1024 * 1024;  // 10 MB

/** Returns an error string if the file fails client-side validation, else null. */
export function validateFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Unsupported file type "${ext}". Allowed: PDF, DOCX, PPTX, TXT, CSV, XLSX, HTML, HTM.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `File is ${(file.size / 1_048_576).toFixed(1)} MB — maximum is 10 MB.`;
  }
  return null;
}


// ─── Projects API ─────────────────────────────────────────────────────────

export async function listProjects(): Promise<ApiProject[]> {
  const res = await apiClient.get<{ projects: ApiProject[] }>('/projects');
  return res.data.projects;
}

export async function createProject(name: string, description = ''): Promise<ApiProject> {
  const res = await apiClient.post<{ project: ApiProject }>('/projects', { name, description });
  return res.data.project;
}

export async function updateProject(
  id: string,
  updates: { name?: string; description?: string },
): Promise<ApiProject> {
  const res = await apiClient.patch<{ project: ApiProject }>(`/projects/${id}`, updates);
  return res.data.project;
}

export async function deleteProject(id: string): Promise<void> {
  await apiClient.delete(`/projects/${id}`);
}


// ─── Conversations API ────────────────────────────────────────────────────

export async function listConversations(projectId: string): Promise<ApiConversation[]> {
  const res = await apiClient.get<{ conversations: ApiConversation[] }>(
    `/projects/${projectId}/conversations`,
  );
  return res.data.conversations;
}

export async function createConversation(
  projectId: string,
  title = 'New conversation',
): Promise<ApiConversation> {
  const res = await apiClient.post<{ conversation: ApiConversation }>(
    `/projects/${projectId}/conversations`,
    { title },
  );
  return res.data.conversation;
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<ApiConversation> {
  const res = await apiClient.patch<{ conversation: ApiConversation }>(
    `/conversations/${conversationId}`,
    { title },
  );
  return res.data.conversation;
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}`);
}


// ─── Messages API ─────────────────────────────────────────────────────────

export async function listMessages(conversationId: string): Promise<ApiMessage[]> {
  const res = await apiClient.get<{ messages: ApiMessage[] }>(
    `/conversations/${conversationId}/messages`,
  );
  return res.data.messages;
}

export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  sources?: AskSource[],
): Promise<ApiMessage> {
  const res = await apiClient.post<{ message: ApiMessage }>(
    `/conversations/${conversationId}/messages`,
    { role, content, sources: sources ?? null },
  );
  return res.data.message;
}

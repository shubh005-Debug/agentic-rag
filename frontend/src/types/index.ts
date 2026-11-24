/**
 * src/types/index.ts
 *
 * Shared TypeScript types for the entire frontend.
 *
 * Split into two sections:
 *   1. LIVE TYPES — backed by real backend API responses
 *   2. MOCK TYPES — used only for the left panel / conversation sidebar
 *                   (no backend endpoints exist yet for projects/conversations)
 */


// =============================================================================
// 1. LIVE TYPES — backed by real backend API responses
// =============================================================================

/** Human-readable document status shown in the UI. */
export type DisplayDocStatus = 'processing' | 'indexed' | 'failed';

/**
 * A document as the UI sees it — derived from ApiDocument (GET /documents).
 * Most fields map 1-to-1; `status` is the display version of `backendStatus`.
 */
export interface KBDocument {
  /** UUID from Supabase */
  id: string;
  /** Original filename as uploaded */
  name: string;
  /** Lowercase extension: 'pdf', 'docx', etc. */
  type: string;
  /** Human-readable display status */
  status: DisplayDocStatus;
  /** Raw backend status — the poller checks this to know when to stop */
  backendStatus: string;
  /** ISO 8601 timestamp */
  uploadedAt: string;
  /** Number of chunks extracted, or 0 when not yet processed */
  chunkCount: number;
  /** Element type counts: { Text: 38, Table: 3, Image: 1 } */
  elementCounts: Record<string, number> | null;
  /** Summary pipeline status (shown in the document row when not 'done') */
  summaryStatus: string | null;
}

/**
 * A source citation returned with a RAG answer.
 * Mapped from AskSource (POST /ask response).
 *
 * NOTE: `documentId` here holds the CHUNK uuid (AskSource.id), not the
 * document uuid (AskSource.document_id). This key is used only as a React
 * key for toggling the expanded excerpt panel.
 */
export interface SourceReference {
  /** Chunk UUID — used as React toggle key AND for building the image URL */
  chunkId: string;
  /** Document UUID — used to resolve the document name and build the image URL */
  documentUUID: string;
  /** Display name of the source document */
  documentName: string;
  /** The raw chunk text */
  excerpt: string;
  /** Page number, if available */
  page?: number;
  /** Best available relevance score: rerank_score → rrf_score → similarity */
  score: number;
  /** "Text" | "Table" | "Image" */
  elementType: string | null;
  /** Raw HTML for table chunks — rendered with dangerouslySetInnerHTML */
  tableHtml: string | null;
  /** AI-generated caption for image chunks */
  imageCaption: string | null;
  /** True when an image file exists in Supabase Storage for this chunk */
  hasImage: boolean;
}

export type MessageRole = 'user' | 'assistant';

/** A single chat message (user or assistant). */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** Source citations — only present on assistant messages */
  sources?: SourceReference[];
}


// =============================================================================
// 2. MOCK TYPES — used only while backend endpoints for these don't exist
// =============================================================================
// When you add project/conversation persistence to the backend, replace
// the mock data usage in WorkspacePage.tsx with real API calls and remove
// these types (or move them to a dedicated file).

export interface Project {
  id: string;
  name: string;
  description: string;
  conversationCount: number;
  documentCount: number;
  updatedAt: string;
  status: 'active' | 'archived';
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  preview: string;
  messageCount: number;
  updatedAt: string;
}

/** Settings shown in the right panel Settings tab. Currently demo-only. */
export interface ProjectSettings {
  projectId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topK: number;
  similarityThreshold: number;
  systemPrompt: string;
}

/** Legacy alias kept so mockData.ts compiles without changes. */
export type DocumentStatus = 'indexed' | 'processing' | 'failed';

---
name: rag-studio-conventions
description: Full-stack conventions, patterns, and architecture rules for RAG Studio. Covers both the FastAPI backend and the React/TypeScript frontend. Activate automatically when asked to add any feature, component, hook, API endpoint, service, task, or type.
inclusion: auto
---

# RAG Studio — Full-Stack Conventions

This is the single source of truth for all new code in this project.
Follow every rule here when adding features to either the **backend** (FastAPI + Celery) or the **frontend** (React + TypeScript).

---

## 1. Project Structure

```
rag-project/
├── backend/                    FastAPI + Celery
│   ├── main.py                 FastAPI app — all HTTP routes live here
│   ├── celery_app.py           Celery instance + broker config
│   ├── requirements.txt        Pinned production dependencies (Python 3.12)
│   ├── .env / .env.example     All secrets and feature flags
│   └── app/
│       ├── database/
│       │   └── supabase.py     Singleton Supabase client (reads .env)
│       ├── services/           Pure business logic, no HTTP, no Celery imports
│       │   ├── rag.py          Full RAG pipeline orchestrator
│       │   ├── retriever.py    Vector + keyword search + RRF fusion
│       │   ├── embeddings.py   fastembed wrapper (BAAI/bge-small-en-v1.5, 384-dim)
│       │   ├── reranker.py     Cohere rerank-v4.0-fast
│       │   ├── llm.py          Groq client (openai/gpt-oss-20b)
│       │   ├── summarizer.py   Chunk summaries (openai/gpt-oss-120b)
│       │   ├── unstructured_parser.py  Multimodal document parsing
│       │   ├── structured_chunking.py  PyMuPDF fallback for PDFs
│       │   ├── chunking.py     Legacy chunking helper
│       │   ├── query_expansion.py  Optional LLM query rewrite
│       │   ├── vision.py       Groq vision model for image captions
│       │   └── documents.py    Document-level helper functions
│       └── tasks/              Celery background tasks
│           ├── ingestion_tasks.py   Full multimodal ingestion pipeline
│           └── summary_tasks.py     Background chunk summarization
│
└── frontend/                   React 19 + TypeScript + Vite + Tailwind v4
    ├── index.html
    ├── vite.config.ts
    ├── package.json
    └── src/
        ├── App.tsx             BrowserRouter + Routes
        ├── main.tsx            StrictMode + render root
        ├── index.css           Tailwind import + global reset + scrollbars
        ├── pages/              Route-level components
        ├── components/         Presentational + compound components
        ├── hooks/              Custom data-fetching hooks
        ├── services/           Typed Axios API client
        ├── types/              Shared TypeScript interfaces
        └── data/               Static mock data (navigation/chat)
```

---

## 2. Backend — Tech Stack

| Tool | Version | Role |
|---|---|---|
| Python | 3.12 | Runtime |
| FastAPI | 0.141.1 | HTTP API framework |
| Uvicorn | 0.53.0 | ASGI server |
| Pydantic | 2.13.5 | Request/response validation |
| Supabase | 2.31.0 | PostgreSQL + pgvector + Storage |
| Celery | 5.6.3 | Async task queue (ingestion, summarization) |
| Redis | 8.1.0 | Celery broker + result backend |
| Groq | 0.37.1 | LLM API (chat + vision + summarization) |
| Cohere | 7.1.1 | Reranking (rerank-v4.0-fast) |
| fastembed | — | Local embeddings (BAAI/bge-small-en-v1.5, 384-dim) |
| Unstructured | 0.27.10 | Multimodal document parsing (PDF/DOCX/PPTX/etc.) |
| PyMuPDF | 1.28.2 | Fallback PDF chunking |
| langchain-text-splitters | 1.1.2 | Text splitting utilities |

**Models in use:**
- Embeddings: `BAAI/bge-small-en-v1.5` (local via fastembed, 384 dimensions)
- LLM: `openai/gpt-oss-20b` (via Groq) — answers questions
- Summarization: `openai/gpt-oss-120b` (via Groq) — chunk summaries
- Reranker: `rerank-v4.0-fast` (Cohere)
- Vision: `qwen/qwen3.8-27b` (Groq, optional) — image captions

---

## 3. Backend — Architecture Rules

### 3.1 Routing (main.py)
- **All HTTP routes live in `main.py`** — no routers, no `APIRouter`, no sub-apps.
- Use plain `def` (not `async def`) for endpoints that do blocking I/O (Supabase calls, file reads). FastAPI runs them in a thread pool.
- Use `async def` only when the endpoint uses `await` and all I/O is async.
- Every route must have a Pydantic `BaseModel` for its request body. Never use raw `dict`.
- Every destructive change (delete, update) must validate the resource exists first and return 404 if not.
- Always return a dict with descriptive keys — never return a bare string or list.
- CORS middleware allows `"*"` origins for development. Tighten `allow_origins` for production.

**Existing endpoints:**
```
GET  /                               Health check
POST /upload                         Upload document (multipart/form-data, field "file")
GET  /documents                      List all documents (newest first)
DELETE /documents/{document_id}      Delete document + chunks + storage objects
POST /ask                            RAG question answering
GET  /documents/{document_id}/chunks List all chunks for a document
GET  /documents/{document_id}/chunks/{chunk_id}/image  Serve extracted image
```

### 3.2 Adding a new endpoint — checklist
1. Add Pydantic models for request and response body at the top of `main.py` (near existing models)
2. Add the route function below the last related route
3. Validate the input at the boundary (use `Field(min_length=…)` etc.)
4. Call into `app/services/` for all business logic — zero business logic in route functions
5. Wrap in `try/except Exception` and re-raise as `HTTPException(500, detail=…)`
6. HTTPException status codes must match what `src/services/api.ts` already handles: 400, 404, 409, 413, 500

### 3.3 Services (`app/services/`)
- Services are **pure Python** — no FastAPI imports, no Celery imports, no HTTP concerns.
- They may import the Supabase client from `app.database.supabase`.
- Keep one responsibility per file (retrieval ≠ reranking ≠ LLM ≠ embeddings).
- Side-effect-free functions are preferred; configure via `os.getenv(…)` with safe defaults.
- Never read secrets with bare `os.getenv` without a default or a startup guard — the existing services raise `ValueError` at import time if required keys are missing.
- **Feature flags** pattern (copy exactly):
  ```python
  def feature_enabled() -> bool:
      return os.getenv("FEATURE_FLAG", "false").strip().lower() in ("1", "true", "yes", "on")
  ```

### 3.4 Database — Supabase conventions
- Always import the client from `app.database.supabase` — never create a second client.
- Use `.execute()` on every query and check `.data` for results.
- Use `.single()` only when you are certain exactly one row will be returned; prefer handling the list yourself when in doubt.
- ON DELETE CASCADE is set on `document_chunks → documents` — deleting a document row removes its chunks automatically.
- Always delete Storage objects before deleting the database row (the cascade only covers DB rows, not Storage blobs).
- Supabase RPC functions used: `match_document_chunks` (vector search), `search_document_chunks` (keyword/BM25 search), `match_chunk_summaries` (summary vector search).

### 3.5 Celery tasks (`app/tasks/`)
- Tasks are decorated with `@celery_app.task` imported from `celery_app` (the module at the backend root).
- Always call `.delay(…)` on a task — never call the function directly from a route.
- Task functions must catch all exceptions, update the document status to `"failed"` in Supabase, and re-raise so Celery logs the error.
- Task functions are idempotent: they delete existing chunks before re-inserting (safe to retry).
- Status progression: `"uploaded"` → `"processing"` (set at task start) → `"processed"` or `"failed"`.
- Summary tasks run after ingestion succeeds; a failure there must NOT fail ingestion (wrap in `try/except`).

### 3.6 Retrieval pipeline (read before modifying `rag.py` or `retriever.py`)
The RAG pipeline in `rag.py` runs in this order:
1. **Vector search** — `search_chunks(question, match_count=15, document_id?)`
2. **Keyword search** — `search_keyword_chunks(question, match_count=15, document_id?)` (BM25 via `search_document_chunks` RPC)
3. **Summary vector search** *(optional, `SUMMARY_SEARCH_ENABLED`)* — `search_summary_chunks(…)`
4. **Query expansion** *(optional, `QUERY_EXPANSION_ENABLED`)* — one extra vector search on an LLM-rewritten query
5. **RRF fusion** — `reciprocal_rank_fusion(…)` merges all lists with k=60, returns top 10
6. **Duplicate removal** — `remove_duplicate_chunks(…)` deduplicates by content
7. **Reranking** — `rerank_chunks(query, chunks, top_k=5)` via Cohere; falls back to RRF order on failure
8. **Score threshold** — chunks below `RERANK_MIN_SCORE` (default 0.55) are dropped
9. **Context construction** — multimodal: table HTML and image captions are injected differently
10. **LLM answer** — `generate_answer(question, context)` via Groq
11. **Source assembly** — returns `{answer, sources[]}` where each source includes `similarity`, `rrf_score`, `rerank_score`, `element_type`, `table_html`, `image_caption`, `has_image`

When adding retrieval features, plug into this pipeline rather than creating parallel paths.

### 3.7 Document parsing (`unstructured_parser.py`)
- `chunk_document_multimodal(file_path)` is the primary entry point for all document types.
- Returns chunks with keys: `content`, `page_number`, `element_type` ("Text"|"Table"|"Image"), `table_html`, `image_base64`, `image_mime_type`.
- `chunk_document(file_path)` is the backward-compatible entry that folds table HTML into content — only use for legacy paths.
- PDF hi-res mode (Tesseract + unstructured_inference) is optional: `PDF_HI_RES_ENABLED=true` in `.env`.
- For non-PDF formats, Unstructured partition functions are used directly: `partition_docx`, `partition_pptx`, `partition_text`, `partition_csv`, `partition_xlsx`, `partition_html`.

### 3.8 Environment variables
All configuration is in `.env` (never hardcode). The `.env.example` is the canonical list. Required variables (app crashes at startup if missing):
- `SUPABASE_URL`, `SUPABASE_KEY`
- `GROQ_API_KEY`
- `COHERE_API_KEY`
- `REDIS_URL` (default `redis://localhost:6379/0`)

Optional feature flags (all default to `false`/off unless stated):
- `PDF_HI_RES_ENABLED` — hi-res PDF extraction with Tesseract
- `TESSERACT_CMD` — explicit path to `tesseract.exe`
- `VISION_SUMMARY_ENABLED` — Groq vision captions during summarization
- `VISION_MODEL` — vision model name (default `qwen/qwen3.8-27b`)
- `SUMMARY_ENABLED` — chunk summarization pipeline (default `true`)
- `SUMMARY_MODEL` — model for summaries (default `openai/gpt-oss-120b`)
- `SUMMARY_MAX_CHUNKS` — max chunks per document to summarize (default 80)
- `SUMMARY_SEARCH_ENABLED` — third RRF list from summary embeddings
- `RERANK_MIN_SCORE` — Cohere score threshold (default 0.55)
- `QUERY_EXPANSION_ENABLED` — extra vector search on rewritten query
- `EMBEDDING_CACHE_DIR` — fastembed model cache (default `~/.cache/rag_fastembed`)

---

## 4. Backend — Naming and Code Style

| Item | Convention | Example |
|---|---|---|
| Files | `snake_case.py` | `unstructured_parser.py` |
| Functions | `snake_case` | `generate_embedding`, `rerank_chunks` |
| Classes (Pydantic) | `PascalCase` | `AskRequest`, `AskResponse`, `Source` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_FILE_SIZE`, `STORAGE_BUCKET`, `POLL_INTERVAL_MS` |
| Feature flag env names | `UPPER_SNAKE_CASE` | `SUMMARY_SEARCH_ENABLED` |
| Logger | `logging.getLogger(__name__)` per module | — |
| Logging | INFO for normal flow, WARNING for recoverable issues, exception for errors | `logger.info("…")` |
| Type hints | Python 3.10+ syntax — `str \| None`, `list[dict]` | No `Optional[str]`, no `List[dict]` |

Code style:
- Module-level docstrings explain the purpose of each service file.
- Use `load_dotenv()` at the top of any module that reads `.env` variables directly.
- Guard against missing secrets at module import time with `if not SECRET: raise ValueError(…)`.
- Keep commented-out legacy code clearly separated from active code (the existing pattern uses `# =====` section headers with commented blocks above and active code below).

---

## 5. Frontend — Tech Stack

| Tool | Version | Notes |
|---|---|---|
| React | 19 | No explicit React import needed (new JSX transform) |
| TypeScript | ~6.0.3 | Strict mode; `import type` for type-only imports |
| Vite | 8 | Dev: `npm run dev` · Build: `npm run build` |
| Tailwind CSS | v4 | `@tailwindcss/vite` plugin; no `tailwind.config.*` file |
| Axios | v1 | Shared `apiClient` instance in `src/services/api.ts` |
| lucide-react | v1.73 | Only icon library |
| react-router-dom | v7 | `BrowserRouter` + `Routes`/`Route` |
| recharts | v3 | Available, not yet wired up — use for charts/analytics features |

---

## 6. Frontend — Architecture Rules

### 6.1 Layers (strict, top-down only)
```
WorkspacePage (page)       Cross-panel shared state
    ↓ props / callbacks
Components                 Presentational / compound UI
    ↓ calls
Hooks                      Async server state (fetch, poll, mutate)
    ↓ calls
src/services/api.ts        Pure Axios functions — no React imports
    ↓ calls
FastAPI backend            HTTP
```

No layer should import from a layer above it.

### 6.2 State management (no external store)
| Layer | Owns |
|---|---|
| `WorkspacePage` | Cross-panel shared state: `selectedDocumentId`, active IDs, panel open/closed |
| Component | Local UI state: `isDragging`, `input`, `isLoading`, `activeTab` |
| Hook | Async server state: documents, loading, errors, uploading, polling |

Data flows top-down via props. Cross-panel communication goes up to `WorkspacePage` via callbacks, then down to siblings.

Do **not** introduce React Context, Redux, or Zustand unless the team explicitly approves it.

### 6.3 Components
- Named function, default export — always:
  ```tsx
  export default function FeatureCard({ title }: FeatureCardProps) { ... }
  ```
- Props typed with a local `interface XxxProps` declared immediately above the component.
- Sub-components and private helpers go below the main export in the same file — not exported.
- Use the outer/inner remount pattern when a prop change must reset all local state:
  ```tsx
  export default function Panel(props: PanelProps) {
    return <PanelInner key={props.conversationId} {...props} />;
  }
  function PanelInner({ ... }: PanelProps) { ... }
  ```
- Callback props: `on` prefix (`onUpload`, `onSelectDocument`).
- Local handlers: `handle` prefix (`handleSend`, `handleDrop`).

### 6.4 Custom hooks (`src/hooks/`)
- Export a named `interface UseXxxReturn` from every hook file.
- Wrap every returned function in `useCallback` for stable references.
- Manage intervals/timers in `useRef`, not `useState`.
- Use the `alive` guard in `useEffect` cleanup to prevent post-unmount state updates:
  ```ts
  useEffect(() => {
    let alive = true;
    async function init() {
      const data = await fetch();
      if (!alive) return;
      setData(data);
    }
    void init();
    return () => { alive = false; stopPolling(); };
  }, []);
  ```
- **Polling pattern** (copy exactly when polling is needed):
  ```ts
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  const startPolling = useCallback(() => {
    if (pollRef.current !== null) return; // prevent duplicate intervals
    pollRef.current = setInterval(async () => {
      const data = await fetchData();
      if (!data || !needsMorePolling(data)) stopPolling();
    }, POLL_INTERVAL_MS);
  }, [fetchData, stopPolling]);
  ```

### 6.5 API service layer (`src/services/api.ts`)
- **Never** create a second `axios.create()` — use the existing `apiClient` instance.
- Every endpoint is a standalone exported `async function` with typed return value.
- Interface-type both request bodies and response shapes.
- Always use `getApiErrorMessage(err)` to convert errors to user-readable strings.
- Client-side validation (`validateFile`, `ALLOWED_EXTENSIONS`, `MAX_FILE_BYTES`) mirrors backend constraints and must be kept in sync when the backend changes them.
- **Adding a new endpoint:**
  ```ts
  /** GET /summaries */
  export async function listSummaries(): Promise<Summary[]> {
    const res = await apiClient.get<{ summaries: Summary[] }>('/summaries');
    return res.data.summaries;
  }
  ```

### 6.6 TypeScript rules
- `import type { Foo }` for type-only imports always.
- Interfaces for all types (`interface KBDocument { … }`), no `I`-prefix.
- Status values as string union literals: `type DisplayDocStatus = 'processing' | 'indexed' | 'failed'`.
- Module-level constants in `SCREAMING_SNAKE_CASE`.
- Local tab/enum types as union: `type RightTab = 'knowledge' | 'settings'`.
- Non-null assertions (`!`) only where data is guaranteed (mock data seeds, `getElementById('root')`).

### 6.7 Shared types
All frontend domain types live in `src/types/index.ts`. Check there before defining a new type elsewhere.

**Mapping pattern** (backend → frontend shape):
```ts
// In src/types/index.ts — frontend shape
export interface KBDocument { id: string; name: string; status: DisplayDocStatus; ... }

// In src/services/api.ts — backend shape
export interface ApiDocument { id: string; filename: string; status: BackendDocStatus; ... }

// In the hook file — mapper function (pure, not a hook, not in a component)
function toKBDocument(d: ApiDocument): KBDocument { ... }
```

---

## 7. Frontend — Styling (Tailwind CSS v4)

- All styles are Tailwind utility classes in `className` strings — no CSS modules, no styled-components, no `style={{}}` (except for computed values Tailwind cannot express, e.g. `style={{ height: scrollHeight + 'px' }}`).
- Use template literals with ternaries for dynamic classes — never string concatenation:
  ```tsx
  className={`flex items-center ${active ? 'text-violet-400' : 'text-slate-500'}`}
  ```
- Always add `transition-colors` (or `transition-all duration-200`) on interactive elements.

**Color palette:**

| Use | Classes |
|---|---|
| Background tiers | `slate-950` (darkest), `slate-900`, `slate-800`, `slate-700` |
| Borders | `slate-800` (default), `slate-700` (hover), `slate-600` (focus) |
| Primary accent | `violet-600`/`violet-500` (buttons, active), `violet-400`/`violet-300` (text) |
| Success | `emerald-400`/`emerald-500` |
| Warning / processing | `amber-400`/`amber-500` |
| Error | `red-400`/`red-500` |
| Primary text | `slate-100` |
| Secondary text | `slate-300` |
| Muted text | `slate-500` |
| Disabled | `slate-600` |

**Rounding:** `rounded-lg` for panels/cards/buttons, `rounded-xl` for upload zones and large surfaces, `rounded-full` for pills/badges.

**Icons (lucide-react):**
- Inline text icons: `size={13}` or `size={14}`
- Action icons in buttons: `size={15}` or `size={16}`
- Empty-state / hero icons: `size={32}` or `size={40}`
- Loading spinners: `<Loader2 size={N} className="animate-spin" />`

---

## 8. Adding a New Feature — Full-Stack Checklist

### Backend side
1. Add Pydantic request/response models in `main.py` near existing models
2. Add the route function (use existing routes as templates)
3. Add any new business logic in `app/services/` as a pure function
4. Add Celery tasks in `app/tasks/` if the work is async/background
5. Add new `.env` flags to `.env.example` with a comment and safe default

### Frontend side
1. **Types first**: add backend shape to `src/services/api.ts`, add frontend shape to `src/types/index.ts`
2. **API function**: add typed function to `src/services/api.ts`
3. **Hook** (if async state): create `src/hooks/useXxx.ts`, export `UseXxxReturn`
4. **Component**: create `src/components/XxxPanel.tsx` or add sub-component to existing file
5. **Wire into page**: connect state and callbacks in `WorkspacePage.tsx`

### Both sides
- Keep `ALLOWED_EXTENSIONS` in `main.py` and `src/services/api.ts` in sync
- When adding a backend status value, update `BackendDocStatus` and the `toDisplayStatus` mapper
- No tests unless explicitly requested
- No unrequested refactors — touch only files required for the feature

---

## 9. Running the Project

### Backend
```bash
cd backend

# Start FastAPI
uvicorn main:app --reload

# Start Celery worker (separate terminal)
celery -A celery_app worker --loglevel=info

# Start Redis (required by Celery)
redis-server
```

### Frontend
```bash
cd frontend
npm run dev        # development server
npm run build      # production build (tsc -b && vite build)
npm run lint       # ESLint
```

### Environment
- Frontend reads `VITE_API_BASE_URL` from `frontend/.env` (default `http://localhost:8000`)
- Backend reads all secrets from `backend/.env` (copy from `backend/.env.example`)

---

## 10. Mock Data vs. Real API

Navigation state (projects, conversations, messages, settings) is in `src/data/mockData.ts` while the backend grows. When connecting mock state to a real endpoint:
1. Create a hook following the `useDocuments` pattern
2. Replace the mock import in `WorkspacePage.tsx` with the hook
3. Replace `alert(…)` stubs with real handler logic
4. Leave the mock file in place until all consumers are migrated

---

## 11. Data Flow: User Question → Answer

This is the full path a user question takes — understand it before modifying any part:

```
User types question in CenterPanel
  → handleSend() → askQuestion({ question, document_id? })
  → POST /ask (FastAPI main.py)
  → ask_rag(question, document_id) (app/services/rag.py)
  → retrieve_candidates()
      → search_chunks()         (pgvector, match_document_chunks RPC)
      → search_keyword_chunks() (BM25, search_document_chunks RPC)
      → [search_summary_chunks()]   optional
      → [query expansion vector search]  optional
      → reciprocal_rank_fusion()   merges all lists
      → remove_duplicate_chunks()
  → rerank_chunks()  (Cohere rerank-v4.0-fast)
  → score threshold filter
  → generate_answer()  (Groq openai/gpt-oss-20b)
  → { answer, sources[] }
  → AskResponse (Pydantic)
  → frontend: setLocalMessages(…) + render ChatMessage with sources
```

Source score preference in frontend: `rerank_score` > `rrf_score` > `similarity`.

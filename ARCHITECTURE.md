# ARCHITECTURE.md — ArvyaX Journal System

> Engineering decisions, trade-offs, and scaling strategy.

---

## System Overview

```
┌──────────────┐       REST / SSE        ┌───────────────────┐
│   React SPA  │  ─────────────────────► │  Express API      │
│  (Frontend)  │                         │  (Node.js)        │
└──────────────┘                         └────────┬──────────┘
                                                  │
                              ┌───────────────────┼────────────────────┐
                              │                   │                    │
                    ┌─────────▼──────┐  ┌─────────▼──────┐  ┌────────▼────────┐
                    │   SQLite DB    │  │ Analysis Cache │  │ Anthropic API   │
                    │ (journal_entries)│ │ (SQLite table) │  │ (Claude Haiku)  │
                    └────────────────┘  └────────────────┘  └─────────────────┘
```

**Current data model (SQLite):**

```sql
journal_entries (
  id TEXT PK,           -- UUID v4
  user_id TEXT,         -- indexed
  ambience TEXT,        -- forest | ocean | mountain | desert | meadow
  text TEXT,
  emotion TEXT,         -- populated after analysis
  keywords TEXT,        -- JSON array string
  summary TEXT,
  analyzed_at TEXT,
  created_at TEXT       -- indexed
)

analysis_cache (
  text_hash TEXT PK,    -- SHA-256 of normalized text
  emotion TEXT,
  keywords TEXT,
  summary TEXT,
  created_at TEXT
)
```

---

## 1. How Would You Scale This to 100,000 Users?

### Phase 1 — Vertical + Minor Changes (0–10k users)
The current SQLite + single Node process handles ~10k users comfortably with WAL mode enabled. No changes needed initially.

### Phase 2 — Horizontal Scaling (10k–100k users)

**Replace SQLite with PostgreSQL**
- SQLite's write serialization becomes a bottleneck under concurrent load.
- Migrate to PostgreSQL (managed: AWS RDS, Supabase, or Neon) with connection pooling via `pg-pool` or `pgbouncer`.
- Add composite indexes: `(user_id, created_at DESC)` for paginated reads.

**Stateless API + Load Balancer**
- The Express app is already stateless (no in-memory session). Add a load balancer (AWS ALB or nginx) in front of 2–4 Node replicas.
- Use PM2 cluster mode (`pm2 start src/index.js -i max`) for multi-core utilization on a single box before going multi-instance.

**Separate LLM Worker Queue**
- Move `POST /analyze` to an async job queue (BullMQ + Redis) rather than blocking the HTTP thread.
- Dedicated worker pool processes analysis jobs, updates the DB, and notifies via WebSocket or polling.
- This prevents slow LLM calls (~1–3s) from blocking the event loop and consuming connection slots.

**CDN for Frontend**
- Deploy the React build to Cloudflare Pages or AWS S3 + CloudFront. Zero-cost scaling for static assets.

**Redis for Distributed Cache**
- Replace the SQLite `analysis_cache` table with Redis for sub-millisecond cache reads across all API instances.
- TTL: 7 days for analysis results (journal text rarely changes).

**Architecture at 100k:**
```
Internet → Cloudflare CDN (static)
         → ALB → [Node API × 3] → PostgreSQL (RDS)
                                 → Redis (ElastiCache)
                                 → BullMQ workers → Anthropic API
```

---

## 2. How Would You Reduce LLM Cost?

**a) Model Selection — Already Implemented**
We use `claude-haiku-4-5-20251001` (cheapest Claude model) instead of Sonnet or Opus. Haiku is ~20× cheaper than Sonnet for this structured extraction task with no quality loss.

**b) Aggressive Caching — Already Implemented**
SHA-256 hash of normalized text is stored in the cache table. Identical or repeat texts never hit the LLM. In a journaling app, users frequently write similar short entries ("I felt calm today"), so cache hit rates can be high.

**c) Batching**
Instead of analyzing entries one-by-one, queue multiple entries and send them in a single LLM call:
```json
{ "entries": ["text 1", "text 2", "text 3"] }
```
Respond with a JSON array. This reduces per-request overhead (auth, HTTP round-trips).

**d) Prompt Compression**
Keep system prompts short and instruct JSON-only responses (no preamble). The current prompt is already minimal (~120 tokens vs. 400+ for verbose prompts).

**e) User-Triggered vs Automatic**
Analysis is opt-in (user clicks "Analyze"). We never auto-analyze every entry. This alone eliminates a large % of potential LLM calls.

**f) Semantic Deduplication**
Beyond exact-match hashing, compute text embeddings (e.g., via Anthropic's embedding API or a local model) and skip analysis when cosine similarity > 0.95 with a cached result. This catches paraphrases of the same sentiment.

**g) Tiered Analysis**
Offer basic keyword extraction (regex/NLP, free) for all entries and full LLM analysis only for premium users or explicitly requested.

**Estimated savings at 100k MAU:**
With 5 entries/user/month = 500k entries. If cache hit rate = 40%, only 300k LLM calls. At ~$0.25/1M input tokens and ~200 tokens/call, that's ~$15/month. Even at 0% cache, it's only ~$25/month with Haiku.

---

## 3. How Would You Cache Repeated Analysis?

### Current Implementation
A `analysis_cache` table in SQLite with `text_hash TEXT PRIMARY KEY` (SHA-256). Before every LLM call, we check this table. On miss, we call the LLM and INSERT the result. The response includes `"cached": true/false` for transparency.

```js
const textHash = crypto.createHash('sha256')
  .update(text.trim().toLowerCase())
  .digest('hex');
const cached = db.prepare('SELECT * FROM analysis_cache WHERE text_hash = ?').get(textHash);
if (cached) return { ...cached, cached: true };
```

### Production Upgrade: Redis

```js
// Check Redis first
const cached = await redis.get(`analysis:${textHash}`);
if (cached) return { ...JSON.parse(cached), cached: true };

// On miss: call LLM, then cache for 7 days
const result = await callLLM(text);
await redis.setex(`analysis:${textHash}`, 604800, JSON.stringify(result));
```

**Redis advantages over SQLite cache:**
- Shared across all API instances (SQLite is local per process)
- Sub-millisecond reads
- Native TTL expiry
- Atomic operations prevent cache stampedes (use `SET NX` pattern)

### Cache Invalidation
Analysis results are immutable (same text → same emotion), so we use a long TTL (7 days) with no active invalidation. If prompts change, flush the cache namespace.

---

## 4. How Would You Protect Sensitive Journal Data?

Journal entries are deeply personal mental health data. Protection requires multiple layers:

### a) Encryption at Rest
- **Database**: Enable Transparent Data Encryption (TDE) on PostgreSQL (AWS RDS supports this with a toggle).
- **Application-level**: For highest sensitivity, encrypt the `text` column before storing using AES-256-GCM with a key stored in AWS KMS or HashiCorp Vault. The API encrypts before INSERT and decrypts after SELECT.

```js
const cipher = crypto.createCipheriv('aes-256-gcm', kmsKey, iv);
const encryptedText = cipher.update(entry.text, 'utf8', 'base64') + cipher.final('base64');
```

### b) Encryption in Transit
- All API traffic over HTTPS/TLS 1.3.
- Frontend served over HTTPS only (enforced via HSTS header).

### c) Authentication & Authorization
- Implement JWT-based authentication (or use Clerk/Auth0 for managed auth).
- Every route validates `req.user.id === req.params.userId` — users can only read their own entries.
- The current `userId` field is user-supplied (for prototype simplicity). In production, derive it from the verified JWT, never from the request body.

### d) Data Minimization
- Don't log journal text in application logs — log only entry IDs and user IDs.
- Strip PII before sending text to third-party LLM APIs: consider a local PII detection step (e.g., Microsoft Presidio) to redact names, locations before the text leaves your infrastructure.
- Alternatively, use Anthropic's zero-data-retention API tier (available on enterprise plans) where inputs are not used for training.

### e) Access Controls
- Database: use a least-privilege DB user (SELECT/INSERT/UPDATE only on `journal_entries`, no DROP/CREATE).
- API key rotation for ANTHROPIC_API_KEY via environment secrets (never hardcoded, never committed).
- Secrets managed via AWS Secrets Manager or Doppler in production.

### f) Audit Logging
- Log all data access events (who accessed which userId's entries, when) to an append-only audit log table.
- Alert on anomalous patterns (e.g., one user ID accessing data of 1000+ other users).

### g) Right to Erasure (GDPR/DPDP)
- Implement `DELETE /api/journal/user/:userId` that hard-deletes all entries + cache entries for a user.
- Provide a data export endpoint (`GET /api/journal/export/:userId`) returning all entries as JSON/CSV.

### h) Rate Limiting (Already Implemented)
- Prevents brute-force enumeration of userId values.
- 100 req/15min global, 10 req/min on analyze.

---

## Bonus: Decisions & Trade-offs

| Decision | Choice | Reason |
|----------|--------|--------|
| Database | SQLite | Zero-ops for prototype; trivial migration to Postgres |
| LLM model | Claude Haiku | 20× cheaper, fast, sufficient for structured extraction |
| Caching | SQLite table | Works locally without Redis setup; same interface |
| Streaming | SSE (Server-Sent Events) | Simpler than WebSocket for unidirectional LLM streaming |
| Auth | userId from body | Prototype simplicity; JWT in production |
| Frontend state | React useState | No Redux needed at this scale |
| CSS | Pure CSS variables | No Tailwind/MUI dependency; full control |

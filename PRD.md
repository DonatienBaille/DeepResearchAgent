# PRD: Deep Research Agent - Local Veille Technologique System

**Date**: February 25, 2026  
**Status**: In Development  
**Owner**: AI Development Team

---

## 1. Vision

Build a fully local, containerized automated research surveillance system ("Veille Technologique") that:

- Operates 100% on-premises with no cloud dependencies
- Wakes at scheduled times to research assigned tech topics
- Compiles findings into professional HTML reports with source attribution
- Distributes reports via email with multi-user SSO access to historical data
- Provides a secure web dashboard to manage topics and view research history

**Target Users**: Tech teams, security researchers, competitive intelligence teams

---

## 2. Scope & Requirements

### 2.1 Core Features

#### Agent Orchestration (index.ts + Cron)

- **Scheduling**: Node-cron based scheduling (e.g., daily at 9 AM)
- **Topic Management**: Read from SQLite database (seeded from sujets.json)
- **Sequential Processing**: Execute research for each topic, aggregate reports
- **Report Archival**: Save generated HTML + markdown to SQLite with timestamp
- **Email Distribution**: Send compiled multi-topic report via nodemailer SMTP

#### Deep Research Agent (LangGraph + agent.ts)

- **3-Node Workflow**:
  1. **Planner**: LLM analyzes topic → generates 4-5 targeted search queries
  2. **Researcher**: Executes Tavily searches via TavilySearchAPIRetriever → aggregates documents with URLs and deduplicates
  3. **Synthesis**: LLM reads search results → produces clean HTML paragraph with inline citations and source attribution
- **Conditional Routing**: Router checks if synthesis is informative (>100 words); loop up to 3 iterations if not
- **State Management**: Uses LangGraph `Annotation.Root()` pattern (typed state without `as any` casts)
- **Search Integration**: Uses `@langchain/community/retrievers/tavily_search_api` (TavilySearchAPIRetriever)
- **Parallel Search**: Executes all search queries concurrently via `Promise.allSettled()`
- **Lazy Initialization**: LLM and retriever created on first use (not at module import)
- **Output Format**:
  - HTML: Rendered paragraph with `<a>` tags for source attribution
  - Markdown: Alternative format for storage/archival
  - Both formats preserve document structure and citations

#### Web Dashboard (Hono + Frontend)

- **Authentication**: OIDC SSO via Authentik (openid-client v6 functional API)
- **Access Level**: Login required when OIDC enabled; dev mode allows unauthenticated access
- **Dev Mode**: When `AUTHENTIK_OIDC_DISCOVERY` is not set, dashboard is accessible without auth
- **Features**:
  - View all past reports (paginated, filterable by topic)
  - View recent 50 reports on dashboard
  - Admin topic management (add/edit/delete/toggle active status)
  - Single-page app or server-rendered pages

#### Database (SQLite + sql.js)

- **Technology**: sql.js (pure JavaScript SQLite implementation) for cross-platform compatibility
- **Async Pattern**: All database operations return Promises (async/await compatible)
- **Query Helpers**: `queryRows<T>()`, `queryOne<T>()`, `execute()` for type-safe DB access
- **Test Isolation**: `resetDb()` function clears module-level DB singleton between tests
- **Error Handling**: Custom errors (`NotFoundError`, `ValidationError`, `ConflictError`) for proper HTTP mapping
- **Schema**:
  - `topics`: id (UUID), name (UNIQUE), active (BOOLEAN), created_at (TIMESTAMP), updated_at (TIMESTAMP)
  - `reports`: id (UUID), topic (TEXT), html_content (TEXT), markdown_content (TEXT), created_at (TIMESTAMP)
  - **Indexes**: active/name on topics; topic/created_at on reports for query performance
- **Operations**: Full CRUD support for topics and reports; pagination with limit/offset; filtering by topic or search_results.length
- **Persistence**: File-based storage with configurable path (default: `./research.db`)

#### Deployment (Docker + Docker Compose)

- **Container**: Bun runtime with all dependencies
- **Multi-Process**: Separate cron agent and web server (can scale independently)
- **Volumes**:
  - `sujets.json` (read-only seed file)
  - `.env` file (secrets)
  - `research.db` (persistent SQLite data)
- **Environment**: Authentik integration (external or docker service)

---

### 2.2 Non-Functional Requirements

| NFR               | Requirement              | Target                                  |
| ----------------- | ------------------------ | --------------------------------------- |
| **Performance**   | Dashboard load time      | < 2 seconds (first load), <500ms cached |
| **Availability**  | 99% uptime per month     | Automatic restart on crash via Docker   |
| **Latency**       | Report generation time   | < 30 seconds (avg 15s)                  |
| **Scalability**   | Concurrent users         | 10-50 (web tier)                        |
| **Security**      | No hardcoded secrets     | Use .env + Docker secrets               |
| **Scalability**   | Handle 100+ past reports | SQLite with indexes                     |
| **Code Quality**  | TypeScript strict mode   | 0 type errors                           |
| **Testing**       | Unit + Integration tests | 40+ tests passing (unit + integration)  |
| **Documentation** | Setup + API docs         | README + inline comments                |

---

## 3. Technical Stack

| Layer                | Technology                        | Justification                                            |
| -------------------- | --------------------------------- | -------------------------------------------------------- |
| **Runtime**          | Bun                               | Native TypeScript, simpler packaging, better perf        |
| **LLM/AI**           | @langchain/langgraph              | State machine for multi-step research, structured output |
| **LLM Model**        | OpenAI gpt-4o-mini                | Balance: cost & quality for planning/synthesis           |
| **Search**           | Tavily (@langchain/community)     | Structured JSON results, better for AI synthesis         |
| **Web Framework**    | Hono                              | Lightweight, TypeScript, optimized for Bun               |
| **Database**         | SQLite + sql.js                   | Pure JS SQLite, cross-platform, async-compatible         |
| **Auth**             | Authentik OIDC (openid-client v6) | Enterprise SSO, self-hosted, functional API              |
| **Scheduling**       | node-cron                         | Simple, reliable, built-in logic                         |
| **Email**            | nodemailer                        | Flexible SMTP support, local or cloud                    |
| **Testing**          | bun:test (native)                 | Built-in Bun test runner, no extra dependencies          |
| **Containerization** | Docker + Docker Compose           | Standard, reproducible deployments                       |

---

## 4. Architecture

### 4.1 File Structure

```
deep-agent/
├── PRD.md                           (this file)
├── package.json
├── bun.lock
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── sujets.json                      (initial topic seed)
├── README.md
│
├── src/
│   ├── index.ts                     (cron orchestration)
│   ├── agent.ts                     (LangGraph deep research)
│   ├── db.ts                        (SQLite layer)
│   ├── web.ts                       (Hono server entry)
│   ├── types.ts                     (shared interfaces)
│   │
│   ├── web/
│   │   ├── middleware/
│   │   │   └── auth.ts              (OIDC + session validation)
│   │   ├── routes/
│   │   │   ├── auth.ts              (login/callback/logout)
│   │   │   └── api.ts               (REST: reports, topics)
│   │   └── public/
│   │       └── dashboard.html       (frontend SPA)
│   │
│   └── utils/
│       └── errors.ts                (custom error classes + helpers)
│
├── tests/
│   ├── unit/
│   │   ├── agent.test.ts            (24 tests: routing, HTML, report gen)
│   │   ├── db.test.ts               (26 tests: CRUD, validation, stats)
│   │   ├── types.test.ts            (8 describe blocks: all interfaces)
│   │   └── errors.test.ts           (error classes, formatters, sanitizer)
│   ├── integration/
│   │   ├── auth.test.ts             (middleware, JWT, auth routes)
│   │   └── api.test.ts              (full HTTP workflow tests)
│   └── fixtures/
│       └── sample-data.ts           (shared test data & factories)
│
└── docs/
    └── AUTHENTIK_SETUP.md            (SSO configuration guide)
```

### 4.2 Data Flow

```
sujets.json (seed)
    ↓
[Startup: Load into DB if empty]
    ↓
┌─── CRON (9 AM daily) ───────────────────────────┐
│                                                   │
│  1. Read active topics from DB                   │
│  2. For each topic:                              │
│  │   a. Call runDeepResearchAgent(topic)         │
│  │   b. Receive HTML report                      │
│  │   c. Save to reports table                    │
│  │   d. Log timestamp                            │
│  3. Compile all reports                          │
│  4. Send email via SMTP                          │
│                                                   │
└─── Agent (LangGraph) ─────────────────────────────┘
     Planner → Tavily Search → Synthesis
     (loop if needed, max 3x)

┌─── WEB SERVER (Hono, port 3000) ────────────────┐
│                                                   │
│  /auth/login → Authentik OIDC start              │
│  /auth/callback → Exchange code, set session     │
│  /dashboard → Verify auth → Serve HTML           │
│  /api/reports → Fetch from DB (paginated)        │
│  /api/topics → Create/update/delete              │
│                                                   │
└──────────────────────────────────────────────────┘
        ↓ (SQLite)
    research.db (local persistence)
```

---

## 5. Feature Details

### 5.1 Agent Workflow (agent.ts)

**Function**: `runDeepResearchAgent(topic: string): Promise<string>`

**State**:

```typescript
interface ResearchState {
  topic: string;
  search_queries: string[];
  search_results: SearchResult[];
  synthesis: string;
  iterations: number;
  messages: BaseMessage[];
}
```

**Nodes**:

1. **Planner Node**
   - Input: Topic (string)
   - LLM Prompt: "Given this tech topic, generate 3-5 specific, actionable search queries that would help compile a comprehensive brief."
   - Output: Array of search queries
   - Tool: None (LLM only)

2. **Search Node**
   - Input: Search queries
   - Tool: TavilySearchResults (from @langchain/community)
   - Aggregation: Combine all results, deduplicate by URL
   - Output: Structured list of {title, snippet, url, date}
   - Timeout: 30s per query (fail gracefully)

3. **Synthesis Node**
   - Input: Aggregated search results
   - LLM Prompt: "Based on these research results, write a professional 150-250 word HTML paragraph summarizing the key findings. Include inline <a href> links to 2-3 most relevant sources."
   - Output: HTML string like `<div class="report-item"><p>...</p><p>Sources: <a href="...">Title</a></p></div>`
   - Tool: None (LLM only)

**Conditional Logic**:

- After Synthesis, check word count of output
- If < 100 words OR iteration < 2: loop back to Planner with "Need more information" feedback
- If >= 100 words OR iteration >= 3: exit and return HTML

**LLM Config**:

- Model: gpt-4o-mini
- Temperature: 0.5 (balanced creativity + consistency)
- Max tokens: 500 per call

---

### 5.2 Database Schema

**reports table**:

```sql
CREATE TABLE reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  topic TEXT NOT NULL,
  html_content TEXT NOT NULL,
  markdown_content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(topic) REFERENCES topics(name)
);

CREATE INDEX idx_reports_topic ON reports(topic);
CREATE INDEX idx_reports_created ON reports(created_at DESC);
```

**topics table**:

```sql
CREATE TABLE topics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_topics_active ON topics(active);
```

---

### 5.3 Web Dashboard Features

**Public Pages** (after login):

- `GET /dashboard`: Main page with recent reports + topic list
- `GET /api/reports?page=1&limit=20`: Paginated report list
- `GET /api/reports/:id`: Single report view with HTML rendering
- `GET /api/topics`: All topics (active + inactive)

**Admin Features** (all authenticated users):

- `POST /api/topics`: Create topic
  - Body: `{ name: "TypeScript 5.4", active: true }`
  - Returns: Created topic object
- `PATCH /api/topics/:id`: Update topic
  - Body: `{ name: "...", active: boolean }`
  - Returns: Updated topic
- `DELETE /api/topics/:id`: Delete topic (cascades to reports)
  - Returns: `{ success: true }`
- `DELETE /api/reports/:id`: Delete single report
- `DELETE /api/topics/:name/reports`: Clear all reports for a topic
- `GET /api/topics/active`: Get only active topics
- `GET /api/topics/:name/reports`: Get reports filtered by topic name

**Frontend HTML**:

- Header: User name + logout button
- Left sidebar: Navigation (Dashboard, All Reports)
- Main area:
  - Recent reports cards (topic, date, excerpt)
  - Topic management section (list, toggle, delete)
  - Add topic form
- Report detail modal: Full HTML content rendering
- Styling: Clean, minimal (no heavy framework)

---

## 6. Security & Compliance

### 6.1 Authentication

- **Method**: OIDC via Authentik
- **Flow**: Authorization Code flow (most secure)
- **Session**: Secure HTTP-only cookie with signed JWT
- **Token Validation**: Verify signature + expiry on each dashboard request

### 6.2 Secrets Management

- All secrets in `.env` file (never in code)
- Required secrets:
  - `OPENAI_API_KEY`
  - `TAVILY_API_KEY`
  - `AUTHENTIK_CLIENT_ID`
  - `AUTHENTIK_CLIENT_SECRET`
  - `AUTHENTIK_OIDC_DISCOVERY`
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - `SESSION_SECRET` (for signing cookies)
  - `DATABASE_PATH` (default: "./research.db")

### 6.3 Data Protection

- Reports stored in local SQLite (encrypted at rest recommended)
- No PII stored except Authentik user sub + email (from OIDC token)
- Reports can be manually exported/deleted via API
- Audit: Optional logging of topic modifications (future)

---

## 7. Testing Strategy

### 7.1 Unit Tests

- **agent.ts**: Mock LLM responses, test planner/synthesis logic
- **db.ts**: SQLite CRUD operations, schema validation
- **types.ts**: Type narrowing, interface compliance

### 7.2 Integration Tests

- **Auth flow**: Login → callback → session creation
- **API endpoints**: Create topic → Schedule cron → Check report in DB
- **Agent → DB**: Run agent, verify report saved with correct schema

### 7.3 Test Tools

- **Test Runner**: Bun's native test support or Vitest
- **Mocks**: Hono test utilities for HTTP endpoints
- **Fixtures**: Sample Tavily responses, LLM mock completions

### 7.4 Coverage Goals

- Minimum 70% overall coverage
- 100% coverage for critical paths (auth, database serialization)

---

## 8. Deployment & Operations

### 8.1 Local Development

```bash
# Setup
bun install
cp .env.example .env          # Configure secrets
nano .env                     # Add API keys

# Run
bun run src/index.ts          # Cron + one iteration
bun run src/web.ts            # Web server

# Test
bun test
```

### 8.2 Docker Deployment

```bash
docker-compose up             # Starts agent + web + Authentik (if included)
docker-compose logs -f        # Watch logs
```

### 8.3 Operations Checklist

- [ ] Authentik instance configured + app registered
- [ ] SMTP credentials valid + tested
- [ ] Tavily API key active
- [ ] OpenAI API key active with gpt-4o-mini access
- [ ] sujets.json seeded with initial topics
- [ ] .env file loaded with all required secrets
- [ ] research.db created + schema initialized
- [ ] Dashboard loads on first login
- [ ] Cron schedules correctly

---

## 9. Success Metrics

| Metric                | Target                  | Measurement                       |
| --------------------- | ----------------------- | --------------------------------- |
| **Report Quality**    | > 150 words avg         | Manual review of HTML output      |
| **Uptime**            | 99.5%                   | Docker restart policy, logs       |
| **Time-to-Report**    | < 2 min per topic       | Timestamp diff in reports table   |
| **User Adoption**     | Successful login + view | Authentik logs + dashboard access |
| **Execution Success** | 95%+ cron success       | Error logs + email delivery       |

---

## 10. Future Enhancements

- [x] Report comparison (track topic evolution over time)
- [x] Advanced search filters (date range, keyword)
- [x] Notifications programmées (alertes quand un nouveau rapport est généré, via WebSocket ou polling)
- [x] Tags / Catégories (organiser les topics en catégories — Security, AI, DevOps… — avec filtrage multi-critères)
- [x] Favoris / Bookmarks (marquer des rapports importants pour y revenir rapidement)
- [x] Résumé automatique multi-topics (synthèse hebdomadaire cross-topics avec les points saillants)
- [x] Memory / Novelty tracking (évite de re-notifier les mêmes sujets, détection de contenu nouveau via hashing)

---

## 11. Glossary

| Term                     | Definition                                                                  |
| ------------------------ | --------------------------------------------------------------------------- |
| **Veille Technologique** | Systematic monitoring of tech topics to stay informed                       |
| **LangGraph**            | Framework for building multi-step AI agent workflows                        |
| **Tavily**               | API for real-time web search with structured JSON output                    |
| **OIDC**                 | OpenID Connect, industry standard for authentication + identity             |
| **Authentik**            | Self-hosted identity provider supporting OIDC, SAML, OAuth                  |
| **Better-SQLite3**       | Synchronous SQLite binding for Node.js/Bun (not used; sql.js used instead)  |
| **sql.js**               | Pure JavaScript SQLite implementation, async-compatible                     |
| **openid-client v6**     | OIDC client library with functional API (discovery, authorizationCodeGrant) |
| **Hono**                 | Lightweight web framework optimized for edge + Bun runtime                  |
| **Sub-Agent**            | Specialized Claude skill set focused on one domain (e.g., security)         |
| **State Machine**        | Workflow with defined nodes/states and transitions (LangGraph)              |
| **Synthesis**            | LLM summarization of search results into coherent narrative                 |

---

**Document Version**: 2.0  
**Last Updated**: 2026-02-25

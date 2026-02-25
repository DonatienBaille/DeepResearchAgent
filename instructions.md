# Instructions pour Agents de Code

> Guide de référence rapide pour comprendre la structure, les conventions et les patterns du projet **Deep Research Agent**.

---

## 1. Vue d'ensemble

Système automatisé de veille technologique qui :

- Exécute un agent IA (LangGraph) à horaire planifié pour rechercher des sujets tech
- Génère des rapports HTML/Markdown avec attribution de sources
- Expose un dashboard web (SPA) pour consulter et gérer les topics/rapports
- Authentification SSO via Authentik (OIDC) — optionnelle en dev

---

## 2. Stack technique

| Couche          | Technologie                             | Notes                                              |
| --------------- | --------------------------------------- | -------------------------------------------------- |
| Runtime         | **Bun**                                 | TypeScript natif, test runner intégré (`bun test`) |
| Web             | **Hono**                                | Framework léger, optimisé Bun, port 3000           |
| Base de données | **SQLite** via **sql.js**               | Pure JS, async-compatible, fichier `research.db`   |
| Agent IA        | **LangGraph** + **OpenAI gpt-5-mini**   | Workflow 3 nœuds : Planner → Search → Synthesis    |
| Recherche       | **Tavily** (`TavilySearchAPIRetriever`) | Résultats JSON structurés                          |
| Auth            | **openid-client v6** (fonctionnel)      | OIDC avec Authentik, PKCE intégré                  |
| Scheduling      | **node-cron**                           | Par défaut : 9h quotidien                          |
| Email           | **nodemailer**                          | SMTP configurable                                  |
| Container       | **Docker** + **Docker Compose**         | Image `oven/bun:latest`, multi-stage build         |

---

## 3. Arborescence du projet

```
deep-agent/
├── src/
│   ├── index.ts              # Point d'entrée : cron orchestration + web server startup
│   ├── agent.ts              # Agent LangGraph (Planner → Search → Synthesis)
│   ├── db.ts                 # Couche SQLite : CRUD topics/reports, helpers typés
│   ├── web.ts                # Serveur Hono : routes, middleware, dashboard
│   ├── types.ts              # Interfaces partagées (Report, Topic, AuthUser, etc.)
│   ├── utils/
│   │   └── errors.ts         # Classes d'erreur custom (AppError, NotFoundError, etc.)
│   └── web/
│       ├── middleware/
│       │   └── auth.ts       # Middleware OIDC (discovery, session, JWT)
│       ├── routes/
│       │   ├── api.ts        # REST API : /api/topics, /api/reports
│       │   └── auth.ts       # Routes auth : /auth/login, /auth/callback, /auth/logout
│       └── public/
│           └── dashboard.html  # Frontend SPA (~1700 lignes, CSS+HTML+JS inline)
├── tests/
│   ├── unit/                 # Tests unitaires (agent, db, types, errors)
│   ├── integration/          # Tests d'intégration (API HTTP, auth)
│   └── fixtures/
│       └── sample-data.ts    # Données de test partagées
├── docs/
│   └── AUTHENTIK_SETUP.md    # Guide de configuration SSO
├── sujets.json               # Seed initial des topics (tableau JSON de strings)
├── PRD.md                    # Product Requirements Document
├── package.json
├── tsconfig.json             # TypeScript strict mode activé
├── Dockerfile                # Multi-stage build, Bun
└── docker-compose.yml        # Services : deep-agent (+ Authentik optionnel)
```

---

## 4. Commandes essentielles

```bash
# Installer les dépendances
bun install

# Lancer le serveur web + cron agent
bun dev                      # alias de bun run src/index.ts

# Lancer le serveur web seul
bun dev:web                  # bun run src/web.ts

# Tests
bun test                     # Tous les tests
bun test:unit                # Tests unitaires seulement
bun test:integration         # Tests d'intégration seulement
bun test --watch             # Mode watch
bun test --coverage          # Avec couverture

# Build
bun run build                # Production build → dist/
```

---

## 5. Architecture des modules

### 5.1 `index.ts` — Orchestration

- Démarre le serveur web (`startWebServer()`)
- Configure le cron job (`node-cron`)
- Pour chaque topic actif : appelle `runDeepResearchAgent(topic)` → sauvegarde le rapport → envoie un email compilé
- Seed les topics depuis `sujets.json` si la DB est vide

### 5.2 `agent.ts` — Agent LangGraph

- **Workflow** : `Planner → Researcher → Synthesis` avec routing conditionnel
- **State** : `ResearchStateAnnotation` (pattern Annotation.Root de LangGraph)
- **Boucle** : Si synthèse < 100 mots, retour au Planner (max 3 itérations)
- **Export principal** : `runDeepResearchAgent(topic: string): Promise<string>`
- **Lazy init** : LLM et retriever créés au premier appel
- **Config** : `OPENAI_MODEL` (défaut: `gpt-5-mini`), max tokens 500

### 5.3 `db.ts` — Couche base de données

Singleton SQLite avec persistence fichier. Fonctions exportées :

| Fonction                                                         | Description                                |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `getDb()`                                                        | Initialise et retourne l'instance DB       |
| `resetDb()`                                                      | Reset le singleton (pour tests)            |
| `closeDb()`                                                      | Ferme la DB proprement                     |
| `getTopics()`                                                    | Tous les topics                            |
| `getActiveTopics()`                                              | Topics avec `active = 1`                   |
| `getTopicById(id)`                                               | Topic par UUID                             |
| `getTopicByName(name)`                                           | Topic par nom (UNIQUE)                     |
| `createTopic(name)`                                              | Crée un topic (UUID auto, vérifie unicité) |
| `updateTopic(id, updates)`                                       | Met à jour nom/active                      |
| `deleteTopic(id)`                                                | Supprime topic + rapports associés         |
| `getReports(limit, offset, topic?, dateFrom?, dateTo?, search?)` | Rapports paginés avec filtres              |
| `getReportById(id)`                                              | Rapport par UUID                           |
| `getReportsByTopic(topic, limit?)`                               | Rapports d'un topic                        |
| `saveReport(topic, html, markdown?)`                             | Crée un rapport                            |
| `deleteReport(id)`                                               | Supprime un rapport                        |
| `clearTopicReports(topic)`                                       | Supprime tous les rapports d'un topic      |
| `getDbStats()`                                                   | Compteurs topics/rapports                  |

**Helpers internes** : `queryRows<T>()`, `queryOne<T>()`, `execute()` pour des requêtes typées.

**Pattern de test** : `DATABASE_PATH=":memory:"` + `resetDb()` entre chaque test.

### 5.4 `web.ts` — Serveur Hono

- Route `/health` publique (santé + stats DB)
- Middleware auth global (`authMiddleware`)
- Routes : `/auth/*`, `/api/*`, `/dashboard`
- Dev mode : si `AUTHENTIK_OIDC_DISCOVERY` absent, tout est accessible sans auth
- Dashboard servi comme fichier HTML statique

### 5.5 `types.ts` — Types partagés

Interfaces principales :

- `Report` : `{ id, topic, html_content, markdown_content?, created_at }`
- `Topic` : `{ id, name, active, created_at, updated_at }`
- `SearchResult` : `{ title, snippet, url, publication_date?, source? }`
- `ResearchState` : State LangGraph (topic, queries, results, synthesis, iterations, messages)
- `AuthUser` : `{ sub, email, name, groups? }`
- `SessionData` : `{ userId, email, accessToken, refreshToken?, expiresAt }`
- `ApiResponse<T>` : `{ success, data?, error?, timestamp }`
- `PaginatedResponse<T>` : `{ items, total, page, limit, hasMore }`
- `RequestContext` : `{ user?, sessionData?, isAuthenticated }`

### 5.6 `utils/errors.ts` — Gestion d'erreurs

Hiérarchie basée sur `AppError` (code, statusCode, isOperational) :

| Classe                 | HTTP | Usage                                |
| ---------------------- | ---- | ------------------------------------ |
| `NotFoundError`        | 404  | Ressource introuvable                |
| `ValidationError`      | 400  | Input invalide (+ champ optionnel)   |
| `ConflictError`        | 409  | Doublon (ex: topic existant)         |
| `AuthenticationError`  | 401  | Auth requise                         |
| `ForbiddenError`       | 403  | Permissions insuffisantes            |
| `ExternalServiceError` | 502  | Erreur service externe (LLM, Tavily) |
| `AgentError`           | 500  | Erreur agent (topic + itération)     |
| `DatabaseError`        | 500  | Erreur DB (opération + message)      |

Helpers : `formatErrorResponse(error)`, `getErrorStatusCode(error)`, `sanitizeErrorForLog(error)` (masque API keys).

---

## 6. API REST

Base URL : `http://localhost:3000/api`

### Topics

| Méthode  | Route                | Description                              |
| -------- | -------------------- | ---------------------------------------- |
| `GET`    | `/api/topics`        | Liste tous les topics                    |
| `GET`    | `/api/topics/active` | Topics actifs uniquement                 |
| `GET`    | `/api/topics/:id`    | Topic par ID                             |
| `POST`   | `/api/topics`        | Créer un topic (`{ name, active? }`)     |
| `PATCH`  | `/api/topics/:id`    | Modifier un topic (`{ name?, active? }`) |
| `DELETE` | `/api/topics/:id`    | Supprimer un topic + ses rapports        |

### Reports

| Méthode  | Route                                         | Description                   |
| -------- | --------------------------------------------- | ----------------------------- |
| `GET`    | `/api/reports?page=&limit=&from=&to=&search=` | Rapports paginés avec filtres |
| `GET`    | `/api/reports/:id`                            | Rapport par ID                |
| `GET`    | `/api/topics/:name/reports?limit=`            | Rapports d'un topic           |
| `DELETE` | `/api/reports/:id`                            | Supprimer un rapport          |
| `DELETE` | `/api/topics/:name/reports`                   | Vider les rapports d'un topic |

### Réponse standard

```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-02-25T..."
}
```

---

## 7. Dashboard (SPA)

**Fichier unique** : `src/web/public/dashboard.html` (~1700 lignes)

- CSS, HTML et JavaScript inline dans un seul fichier
- **Thème** : Dark/Light avec toggle (persiste dans `localStorage`, respecte `prefers-color-scheme`)
- **CSS Variables** : Toutes les couleurs via custom properties (`--bg`, `--text`, `--card`, `--border`, etc.)
- **Icônes** : SVG inline (style Lucide), pas d'emoji
- **Scrollbars** : Personnalisées (6px, WebKit + Firefox)
- **Fonctionnalités** :
  - Gestion des topics (ajout, édition, toggle actif, suppression)
  - Liste des rapports avec filtres avancés (date, recherche par mot-clé)
  - Visualisation des rapports en modal
  - Comparaison de rapports (évolution d'un topic dans le temps)

> **⚠️ Important** : Toujours relire `dashboard.html` avant de l'éditer — le fichier peut être modifié par un formatteur ou l'utilisateur entre les interventions.

---

## 8. Schéma de base de données

```sql
-- Topics
CREATE TABLE topics (
  id TEXT PRIMARY KEY,       -- UUID
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_topics_active ON topics(active);

-- Reports
CREATE TABLE reports (
  id TEXT PRIMARY KEY,       -- UUID
  topic TEXT NOT NULL,
  html_content TEXT NOT NULL,
  markdown_content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(topic) REFERENCES topics(name)
);
CREATE INDEX idx_reports_topic ON reports(topic);
CREATE INDEX idx_reports_created ON reports(created_at DESC);
```

---

## 9. Variables d'environnement

| Variable                   | Requis | Défaut                                | Description                                         |
| -------------------------- | ------ | ------------------------------------- | --------------------------------------------------- |
| `OPENAI_API_KEY`           | Oui    | —                                     | Clé API OpenAI                                      |
| `OPENAI_MODEL`             | Non    | `gpt-5-mini`                          | Modèle LLM                                          |
| `TAVILY_API_KEY`           | Oui    | —                                     | Clé API Tavily (recherche web)                      |
| `DATABASE_PATH`            | Non    | `./research.db`                       | Chemin fichier SQLite (`:memory:` pour tests)       |
| `PORT`                     | Non    | `3000`                                | Port du serveur web                                 |
| `CRON_SCHEDULE`            | Non    | `0 9 * * *`                           | Planning cron (défaut : 9h)                         |
| `AUTHENTIK_OIDC_DISCOVERY` | Non    | —                                     | URL discovery OIDC (si absent → dev mode sans auth) |
| `AUTHENTIK_CLIENT_ID`      | Non    | —                                     | Client ID OIDC                                      |
| `AUTHENTIK_CLIENT_SECRET`  | Non    | —                                     | Client secret OIDC                                  |
| `AUTHENTIK_REDIRECT_URI`   | Non    | `http://localhost:3000/auth/callback` | URI de callback                                     |
| `SESSION_SECRET`           | Non    | —                                     | Secret pour signer les cookies                      |
| `SMTP_HOST`                | Non    | —                                     | Hôte SMTP                                           |
| `SMTP_PORT`                | Non    | `587`                                 | Port SMTP                                           |
| `SMTP_SECURE`              | Non    | `true`                                | TLS                                                 |
| `SMTP_USER`                | Non    | —                                     | Utilisateur SMTP                                    |
| `SMTP_PASS`                | Non    | —                                     | Mot de passe SMTP                                   |
| `SMTP_FROM`                | Non    | `research-agent@example.com`          | Expéditeur                                          |
| `SMTP_TO`                  | Non    | —                                     | Destinataire(s)                                     |

---

## 10. Conventions et patterns

### TypeScript

- **Strict mode** activé (toutes les options strict dans `tsconfig.json`)
- Imports avec extension `.js` (convention ESM Bun) : `import { foo } from "./bar.js"`
- Types séparés dans `types.ts`, erreurs dans `utils/errors.ts`
- Pas de `as any` sauf nécessité absolue — préférer les types explicites

### Base de données

- Pattern singleton (`let db: SqlJsDb | null = null`)
- `saveDb()` appelé uniquement après les opérations d'écriture
- UUID générés avec `uuid` package (v4)
- Erreurs custom mappées aux codes HTTP (NotFoundError → 404, etc.)

### Tests

- Runner : `bun:test` natif
- Isolation : `DATABASE_PATH=":memory:"` + `resetDb()` dans `beforeEach`
- Fixtures partagées dans `tests/fixtures/sample-data.ts`
- Structure : `tests/unit/` pour les modules, `tests/integration/` pour les endpoints HTTP

### API

- Toutes les réponses wrappées dans `ApiResponse<T>` : `{ success, data?, error?, timestamp }`
- Auth conditionnel : vérifié seulement quand OIDC est activé
- Erreurs formatées via `formatErrorResponse()` avec sanitization des secrets

### Frontend (dashboard.html)

- Vanilla JS — pas de framework
- Toutes les couleurs via CSS custom properties (thème dynamique)
- Icônes SVG inline (pas de CDN, pas d'emoji)
- Appels API via `fetch()` avec gestion d'erreur centralisée

---

## 11. Problèmes connus (pre-existants)

- **Hono `ContentfulStatusCode`** : Erreurs de type dans `api.ts` — mismatch des types génériques Hono (cosmétique, n'affecte pas le runtime)
- **CSS `line-clamp`** : Warning lint dans `dashboard.html` (propriété non-standard, fonctionne dans tous les navigateurs modernes)
- **Test flaky `db.test.ts`** : Un test peut échouer car `updated_at === created_at` quand exécuté dans la même milliseconde

---

## 12. Features en cours / planifiées

Voir la section **Future Enhancements** dans [PRD.md](PRD.md) :

- [ ] Notifications programmées (WebSocket/polling)
- [ ] Tags / Catégories (filtrage multi-critères)
- [ ] Favoris / Bookmarks (marquer des rapports)
- [ ] Résumé automatique multi-topics (synthèse hebdomadaire)

<div align="center">

# Deep Research Agent 🔬

**Système automatisé de veille technologique propulsé par des agents IA**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.0+-black?logo=bun&logoColor=white)](https://bun.sh/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.1-green?logo=langchain&logoColor=white)](https://langchain-ai.github.io/langgraphjs/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Getting Started](#-getting-started) · [Architecture](#-architecture) · [API](#-api-reference) · [Deployment](#-deployment) · [Contributing](#-contributing)

</div>

---

Deep Research Agent est un système de veille technologique 100% local et conteneurisé. Il utilise un agent LangGraph multi-étapes pour rechercher automatiquement des sujets tech, synthétiser les résultats en rapports HTML professionnels avec citations, et les distribuer par email.

### Pourquoi Deep Research Agent ?

- **Automatique** — Planifie des recherches via cron (ex: tous les jours à 9h)
- **Intelligent** — Agent IA à 3 nœuds : planification → recherche web → synthèse
- **Local** — Aucune donnée ne quitte votre infrastructure (SQLite + Docker)
- **Sécurisé** — Authentification SSO via Authentik (OIDC)
- **Actionnable** — Dashboard web interactif + rapports envoyés par email

---

## ✨ Fonctionnalités

| Fonctionnalité            | Description                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- |
| 🤖 **Agent IA LangGraph** | Workflow à 3 nœuds (Planner → Researcher → Synthesis) avec routage conditionnel |
| 🔍 **Recherche Web**      | Intégration Tavily pour la recherche web temps réel                             |
| 📅 **Planification Cron** | Exécution programmable (expression cron configurable)                           |
| 🌐 **Dashboard Web**      | Interface complète pour consulter les rapports et gérer les sujets              |
| 🔐 **SSO Authentik**      | Authentification OIDC (auto-hébergé ou externe)                                 |
| 📧 **Rapports Email**     | Envoi automatique des rapports compilés via SMTP                                |
| 💾 **SQLite Local**       | Persistance locale sans dépendance cloud                                        |
| 🐳 **Docker Ready**       | Déploiement en une commande avec docker-compose                                 |
| 🌙 **Dark Mode**          | Dashboard avec thème clair/sombre                                               |

---

## 🚀 Getting Started

### Prérequis

- [Bun](https://bun.sh/) 1.0+ (ou Node.js 18+)
- [Docker](https://www.docker.com/) & Docker Compose (pour le déploiement conteneurisé)
- Clé API [OpenAI](https://platform.openai.com/) (gpt-5-mini)
- Clé API [Tavily](https://tavily.com/) (recherche web)

### Installation

```bash
git clone https://github.com/your-username/deep-research-agent.git
cd deep-research-agent
bun install
```

### Configuration

Créez un fichier `.env` à la racine du projet :

```bash
cp .env.example .env
```

Variables requises :

```env
# LLM
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini          # Optionnel, défaut: gpt-5-mini

# Recherche Web
TAVILY_API_KEY=tvly-...

# Planification
CRON_SCHEDULE=0 9 * * *           # Défaut: tous les jours à 9h

# Base de données
DATABASE_PATH=./research.db       # Défaut: ./research.db

# Serveur web
PORT=3000                         # Défaut: 3000
```

Variables optionnelles (SSO & Email) :

```env
# Authentik OIDC (optionnel — sans config, le dashboard est accessible sans auth)
AUTHENTIK_OIDC_DISCOVERY=https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration
AUTHENTIK_CLIENT_ID=...
AUTHENTIK_CLIENT_SECRET=...
AUTHENTIK_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=your-32-char-min-random-secret

# Email SMTP (optionnel — sans config, les rapports sont seulement sauvegardés en DB)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=research-agent@example.com
SMTP_TO=team@example.com
```

### Lancer en développement

```bash
# Serveur web (dashboard)
bun run dev:web

# Agent + Cron (exécute une recherche au démarrage puis planifie)
bun run dev:agent
```

Ouvrez http://localhost:3000/dashboard dans votre navigateur.

### Lancer avec Docker

```bash
docker-compose up -d
```

```bash
# Voir les logs
docker-compose logs -f deep-agent

# Arrêter
docker-compose down
```

---

## 🏗 Architecture

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────┐
│                   Cron Scheduler                     │
│              (configurable, ex: 9h/jour)             │
└────────────────────┬────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │  Lire sujets actifs  │
          │     (SQLite DB)      │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │   Pour chaque sujet  │
          │                      │
          │  ┌────────────────┐  │
          │  │   🧠 Planner   │  │  LLM génère 4-5 requêtes
          │  └───────┬────────┘  │
          │          ▼           │
          │  ┌────────────────┐  │
          │  │  🔍 Researcher │  │  Tavily recherche web
          │  └───────┬────────┘  │
          │          ▼           │
          │  ┌────────────────┐  │
          │  │  📝 Synthesis  │──┼──→ Boucle si < 100 mots (max 3x)
          │  └───────┬────────┘  │
          │          ▼           │
          │  Sauvegarde en DB    │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │  📧 Envoi email      │
          │  (rapport compilé)   │
          └─────────────────────┘
```

### Agent LangGraph — Workflow à 3 nœuds

| Nœud           | Entrée                 | Sortie                          | Détails                                      |
| -------------- | ---------------------- | ------------------------------- | -------------------------------------------- |
| **Planner**    | Sujet de recherche     | 4-5 requêtes ciblées            | LLM avec température 0.5                     |
| **Researcher** | Requêtes de recherche  | Résultats dédupliqués avec URLs | Tavily API, exécution parallèle              |
| **Synthesis**  | Résultats de recherche | HTML avec citations inline      | Boucle conditionnelle si contenu insuffisant |

### Structure du projet

```
src/
├── index.ts          # Orchestration + cron scheduling
├── agent.ts          # Workflow LangGraph (planner → search → synthesis)
├── db.ts             # Couche données SQLite (sql.js)
├── web.ts            # Serveur web Hono
├── memory.ts         # Gestion mémoire agent
├── summary.ts        # Génération de résumés
├── types.ts          # Interfaces TypeScript partagées
├── utils/
│   └── errors.ts     # Erreurs custom (NotFound, Validation, Conflict)
└── web/
    ├── middleware/
    │   └── auth.ts   # Middleware OIDC Authentik
    ├── routes/
    │   ├── api.ts    # REST API (topics + reports)
    │   └── auth.ts   # Routes login/logout/callback
    └── public/
        └── dashboard.html  # SPA frontend
```

### Stack technique

| Composant        | Technologie                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Runtime          | [Bun](https://bun.sh/)                                                                            |
| Langage          | TypeScript (strict mode)                                                                          |
| Agent IA         | [LangGraph](https://langchain-ai.github.io/langgraphjs/) + [LangChain](https://js.langchain.com/) |
| LLM              | OpenAI gpt-5-mini                                                                                 |
| Recherche web    | [Tavily](https://tavily.com/)                                                                     |
| Serveur web      | [Hono](https://hono.dev/)                                                                         |
| Base de données  | SQLite via [sql.js](https://sql.js.org/)                                                          |
| Authentification | OIDC via [Authentik](https://goauthentik.io/)                                                     |
| Email            | [Nodemailer](https://nodemailer.com/)                                                             |
| Conteneurisation | Docker + Docker Compose                                                                           |

---

## 📡 API Reference

> Tous les endpoints (sauf `/health` et `/auth/*`) nécessitent une authentification lorsque OIDC est configuré.

### Santé

```
GET /health
```

### Authentification

```
GET  /auth/login       # Redirige vers Authentik
GET  /auth/callback    # Callback OIDC
GET  /auth/logout      # Déconnexion
GET  /auth/user        # → { authenticated, user: { id, email, name, groups } }
```

### Topics (Sujets)

```
GET    /api/topics              # Liste tous les sujets
POST   /api/topics              # Créer un sujet        { "name": "..." }
PATCH  /api/topics/:id          # Modifier un sujet     { "name": "...", "active": false }
DELETE /api/topics/:id          # Supprimer un sujet (+ ses rapports)
```

### Reports (Rapports)

```
GET  /api/reports                          # Rapports paginés (?page=1&limit=20&topic=...)
GET  /api/reports/:id                      # Un rapport par ID
GET  /api/topics/:name/reports?limit=10    # Rapports d'un sujet
```

Réponse paginée :

```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 42,
    "page": 1,
    "limit": 20,
    "hasMore": true
  }
}
```

---

## 🗄 Base de données

SQLite via sql.js (implémentation JavaScript pure, compatible toutes plateformes).

```sql
-- Sujets de veille
CREATE TABLE topics (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME
);

-- Rapports générés
CREATE TABLE reports (
  id TEXT PRIMARY KEY,           -- UUID
  topic TEXT NOT NULL,
  html_content TEXT NOT NULL,
  markdown_content TEXT,
  created_at DATETIME
);
```

Le fichier de base de données est stocké à `./research.db` (configurable via `DATABASE_PATH`).

---

## 🐳 Deployment

### Docker Compose (recommandé)

```bash
# Démarrer
docker-compose up -d

# Logs
docker-compose logs -f deep-agent

# Reconstruire après modification
docker-compose build && docker-compose up -d

# Arrêter
docker-compose down
```

Le conteneur expose le port `3000` et utilise un volume Docker pour persister la base de données.

### Checklist Production

- [ ] Reverse proxy HTTPS (nginx, Caddy, Traefik...)
- [ ] `SESSION_SECRET` fort (32+ caractères aléatoires)
- [ ] `NODE_ENV=production`
- [ ] Volume persistant pour `research.db`
- [ ] Limites de ressources CPU/mémoire dans docker-compose
- [ ] Certificat SSL valide pour Authentik
- [ ] Sauvegardes régulières de la base SQLite
- [ ] Monitoring des logs applicatifs

### Expressions Cron

| Expression    | Fréquence           |
| ------------- | ------------------- |
| `0 9 * * *`   | Tous les jours à 9h |
| `0 9 * * 1-5` | Jours ouvrés à 9h   |
| `0 */6 * * *` | Toutes les 6 heures |
| `0 3 * * 0`   | Dimanche à 3h       |

---

## 🧪 Tests

```bash
# Tous les tests
bun test

# Tests unitaires
bun test tests/unit

# Tests d'intégration
bun test tests/integration

# Watch mode
bun test --watch

# Couverture
bun test --coverage
```

---

## 🔐 Authentik (SSO)

L'authentification OIDC via Authentik est **optionnelle**. Sans configuration OIDC, le dashboard est accessible sans authentification (mode développement).

Pour configurer Authentik, consultez le guide détaillé : [docs/AUTHENTIK_SETUP.md](docs/AUTHENTIK_SETUP.md)

---

## 🛠 Troubleshooting

<details>
<summary><strong>OIDC client not initialized</strong></summary>

L'URL de découverte Authentik est inaccessible. Vérifiez `AUTHENTIK_OIDC_DISCOVERY` et testez :

```bash
curl https://authentik.example.com/application/o/deep-agent/.well-known/openid-configuration
```

</details>

<details>
<summary><strong>SMTP authentication failed</strong></summary>

Pour Gmail, utilisez un [mot de passe d'application](https://support.google.com/accounts/answer/185833) (pas le mot de passe du compte). Vérifiez `SMTP_USER`, `SMTP_PASS` et `SMTP_SECURE`.

</details>

<details>
<summary><strong>Tavily search returns no results</strong></summary>

Vérifiez que `TAVILY_API_KEY` est valide et que votre quota n'est pas épuisé sur [tavily.com](https://tavily.com/).

</details>

<details>
<summary><strong>Agent runs but report is empty</strong></summary>

Vérifiez la validité de `OPENAI_API_KEY` et que le modèle gpt-5-mini est accessible. Consultez les logs pour les messages d'erreur LLM.

</details>

<details>
<summary><strong>Dashboard shows "Report not found"</strong></summary>

Vérifiez que le fichier `research.db` existe et a les bonnes permissions. Consultez les logs pour les erreurs de base de données.

</details>

---

## 🗺 Roadmap

- [ ] Synthèse multilingue (Français ↔ Anglais)
- [ ] Analyse de tendances et comparaison de rapports
- [ ] Templates de rapports personnalisables
- [ ] Intégration Slack / Teams (webhooks)
- [ ] Contrôle d'accès par rôles (Admin / Viewer)
- [ ] Export PDF
- [ ] Recherche full-text dans les rapports
- [ ] Rate limiting sur les endpoints API

---

## 🤝 Contributing

Les contributions sont les bienvenues ! Voici comment participer :

1. **Fork** le repository
2. Créez une branche feature : `git checkout -b feature/ma-feature`
3. Développez et ajoutez des tests
4. Vérifiez que tous les tests passent : `bun test`
5. Commit : `git commit -m 'feat: description de la feature'`
6. Push : `git push origin feature/ma-feature`
7. Ouvrez une **Pull Request**

Merci de respecter le style de code existant (TypeScript strict, pas de `any`).

---

## 📄 License

[MIT](LICENSE) — libre d'utilisation, modification et distribution.

---

<div align="center">

[Report Bug](../../issues) · [Request Feature](../../issues)

</div>

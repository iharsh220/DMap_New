# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

D-Map API (`dmap-api`) is the Node.js/Express backend for Digilabs' work-request / task / issue tracking system. It also serves a set of static admin HTML dashboards from `public/`. Plain CommonJS JavaScript: no build step, no TypeScript, no linter, no test suite.

## Commands

```bash
npm install
npm run dev     # nodemon server.js (ignores uploads/*)
npm start       # node server.js
```

There are no automated tests. `Testing.js` is an ad-hoc script that calls the production admin APIs (`node Testing.js`); it is not a test runner. API requests for manual testing are in `D-Map-API.postman_collection.json`.

Runtime dependencies that must be reachable: **MySQL** (Sequelize), **Redis** (token blacklist, admin cache, BullMQ queues), and optionally **Elasticsearch** and an SMTP server. Config comes from `.env` (gitignored); see `.env` for the expected keys.

## Architecture

**Request path.** `server.js` mounts everything under `BASE_ROUTE` (default `/digilabs/uat/dmap/api/`, which includes the environment name). `routes/indexRoute.js` mounts the feature routers (`/auth`, `/work-requests`, `/manager/assigned-work-requests`, `/users`, `/issue-register`, `/salesusers`, `/datatable`, …). Routes → `controller/` → Sequelize models. The controllers are big single files (`adminController.js` and `managerAssignedController.js` are over 6k lines each), so search them rather than reading them top to bottom.

**Auth.** Tokens are **encrypted JWE** (`jose`, `alg: dir`, `enc: A256GCM`), not signed JWTs. The keys are base64 `JWT_ENCRYPTION_KEY` / `REFRESH_ENCRYPTION_KEY`. `middleware/jwtMiddleware.js` decrypts the token into `req.user` and checks a Redis blacklist (`blacklist:<token>`) used for logout and one-time email tokens. `req.user.jobRole.id` drives authorization via `checkRole([ids])` in `middleware/roleMiddleware.js` (e.g. `[1,2,3]` for manager routes).

**List endpoints.** List routes chain `filterMiddleware`, `paginationMiddleware` and `searchMiddleware`, which put `req.filters`, `req.pagination` (`limit=-1` means all rows) and `req.search` on the request for controllers to turn into queries.

**Models.** One file per model in `models/<Name>/<Name>.js` using `sequelize.define`. **All associations live in `models/index.js`**, so add new models and relations there. There is no `sequelize.sync()` and no migration runner: schema changes are hand-written SQL files in `migrations/`, applied to the DB by hand. Several tables use soft deletes (`paranoid`). The DB timezone is fixed at `+05:30` with `dateStrings: true`.

**Admin dashboards (`/datatable/admin/*`).** `routes/adminRoutes.js` serves the HTML pages in `public/` (login, projectsdetails/admin, clients, taskdetails, issuedetails, workrequesttasks, leaves, master-card, feedback, powerbi) along with their `/data` JSON endpoints. These endpoints mostly use raw SQL (`sequelize.query`) in `adminController.js`. GET data endpoints are wrapped in `cachedAdminData(handler)` (`services/adminCacheService.js`), which caches any `res.json` payload that has a `data` key in Redis under `admin:data:*` for `ADMIN_CACHE_TTL_SECONDS` (default 60). **Mutating admin routes must include `invalidateAdminCache`**, or the dashboards will show stale data. The pages share `public/dmap-theme.css` and `public/admin-theme.js`. The site root redirects to `/datatable/admin/login`.

**Background work (BullMQ + Redis).**
- `services/mailService.js`: `mail-queue`. Emails are queued, never sent inline. Bodies are Handlebars templates from `email-templates/`, rendered by `services/templateService.js` (with an `eq` helper and images inlined as base64).
- `services/taskSchedulerService.js`: `task-scheduler-queue`. `node-cron` runs at 00:01 every day to move tasks and issues forward based on `start_date`. The PM-review reminder cron is currently commented out. Workers start inside the API process.

**Audit history.** `services/historyService.js` (`recordWorkRequestHistory`, `recordTaskHistory`, `recordIssueHistory`, …) stores before/after diffs in the `*_history` tables. Call it when changing the status or fields of work requests, tasks or issues.

**Socket.IO.** Namespace `/socket`, path `${BASE_ROUTE}socket.io`. The instance is available as `req.app.get('apiIo')`. It is mainly used to push email-verification results to the client socket whose id travels in the token's `session_id`.

**Uploads.** Files go to `uploads/<sanitized_project_name>/`; the work-request routes create that folder before the controller runs. They are served at `/uploads/*`, with a path-traversal check in `indexRoute.js`. `services/fileUploadService.js` handles the uploads, and the master-card Excel/CSV import reports progress over SSE (`/admin/master-card/upload/progress/:jobId`).

## Gotchas

- `ioredis` is required by `config/redisConfig.js` but is not listed in `package.json`; it is only installed because BullMQ depends on it. The `redis` package in `package.json` is not what the app uses.
- The root-level `.sql` and `sandesh_*.txt` files are reference queries, not part of the app.
- Rate limiting and request logging middleware exist but are commented out in `server.js`.

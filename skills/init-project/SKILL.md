---
name: init-project
description: Scan the current project, detect its full tech stack, and generate AGENTS.md with structured context for future Claude agents. Use when starting work on a new or unfamiliar codebase.
allowed-tools: Glob Read Grep Write
effort: medium
---

# init-project

Scan the current project and detect its full tech stack, then generate an `AGENTS.md` file with structured context so future Claude agents have everything they need to work effectively in this codebase.

## Steps

### 1. Scan for stack indicators

Search the project root and subdirectories for the following files and patterns. Use Glob and Read tools — do not guess.

**Languages & runtimes**
- `package.json` → Node.js / JavaScript / TypeScript
- `tsconfig.json` → TypeScript
- `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile` → Python
- `Cargo.toml` → Rust
- `go.mod` → Go
- `pom.xml`, `build.gradle`, `build.gradle.kts` → Java / Kotlin
- `*.csproj`, `*.sln` → C# / .NET
- `Gemfile` → Ruby
- `composer.json` → PHP
- `pubspec.yaml` → Dart / Flutter

**Frameworks**
- In `package.json` dependencies/devDependencies: look for `next`, `react`, `vue`, `svelte`, `angular`, `express`, `fastify`, `hono`, `remix`, `astro`, `nuxt`, `gatsby`
- In Python files: look for `django`, `flask`, `fastapi`, `sqlalchemy`
- In `Cargo.toml`: look for `axum`, `actix-web`, `rocket`
- In `go.mod`: look for `gin`, `echo`, `fiber`
- In `composer.json` require/require-dev: look for `laravel/framework`, `symfony/framework-bundle`, `slim/slim`, `cakephp/cakephp`, `yiisoft/yii2`
- `artisan` at the project root → **Laravel**. Read `composer.json` for the exact
  `laravel/framework` version; do not infer it from the directory layout.
- In `composer.json`: `livewire/livewire` → Livewire; `inertiajs/inertia-laravel` → Inertia;
  `filament/filament` → Filament; `laravel/nova` → Nova

**Databases & ORMs**
- In dependency files: look for `prisma`, `drizzle-orm`, `typeorm`, `sequelize`, `mongoose`, `pg`, `mysql2`, `sqlite3`, `redis`, `supabase`, `@planetscale`, `@neon`
- Config files: `prisma/schema.prisma`, `drizzle.config.*`
- PHP: Eloquent ships with Laravel — check `app/Models/` and `database/migrations/`.
  `doctrine/orm` in `composer.json` → Doctrine. The engine is in `.env`/`.env.example`
  under `DB_CONNECTION` (`sqlite`, `mysql`, `pgsql`), **not** in `composer.json`.

**Styling**
- `tailwind.config.*` → Tailwind CSS
- In `package.json`: `styled-components`, `@emotion`, `sass`, `less`, `@mui`, `@chakra-ui`, `@radix-ui`, `shadcn`
- `resources/views/**/*.blade.php` → Blade templates. Check whether they actually use
  Tailwind classes: in Laravel, Tailwind is often a leftover dependency of the starter
  kit while the real styling lives in plain CSS under `public/` or `resources/css/`.
  Report what the views use, not what `package.json` declares.

**Build tools & bundlers**
- `vite.config.*` → Vite
- `webpack.config.*` → Webpack
- `turbo.json` → Turborepo
- `nx.json` → Nx
- `rollup.config.*` → Rollup
- `.swcrc` → SWC

**Testing**
- In `package.json`: `jest`, `vitest`, `@testing-library`, `playwright`, `cypress`, `mocha`
- `pytest.ini`, `conftest.py` → pytest
- `phpunit.xml` / `phpunit.xml.dist` → PHPUnit. Read the `<testsuites>` block: it names
  the suites and their directories, and a declared directory that does not exist makes
  PHPUnit abort before running anything.
- `pestphp/pest` in `composer.json` → Pest
- `tests/Feature/`, `tests/Unit/` → Laravel's default test layout
- `jest.config.*`, `vitest.config.*`

**Infrastructure & deployment**
- `Dockerfile`, `docker-compose.*` → Docker
- `.github/workflows/` → GitHub Actions
- `vercel.json`, `.vercel/` → Vercel
- `netlify.toml` → Netlify
- `fly.toml` → Fly.io
- `terraform/`, `*.tf` → Terraform
- `kubernetes/`, `k8s/`, `*.yaml` with `kind: Deployment` → Kubernetes

**Monorepo**
- `pnpm-workspace.yaml` → pnpm workspaces
- `turbo.json` → Turborepo
- `nx.json` → Nx
- `lerna.json` → Lerna
- `packages/`, `apps/` directories → likely monorepo

**Package manager**
- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → Yarn
- `bun.lockb` → Bun
- `package-lock.json` → npm
- `composer.lock` → Composer. Check `config.platform.php` in `composer.json`. Two failure
  modes, both common:
  - **Key absent.** The lock was resolved against whatever PHP the person who ran
    `composer update` had locally. If that was newer than CI or the container, the lock
    pins packages that refuse to install there.
  - **Key set, but higher than the runtime.** Resolution targets a PHP the environment
    does not have.

  Record the declared `require.php` range, the `config.platform.php` value if present,
  and whether they agree with the PHP the project actually runs on.

**Environment & config**
- `.env`, `.env.example`, `.env.local` → environment variables (list keys only, never values)
- `*.config.ts`, `*.config.js` at root

### 2. Read key files in full

After identifying which files exist, read:
- `package.json` (full)
- `tsconfig.json` (full)
- `prisma/schema.prisma` or `drizzle.config.*` if present
- `README.md` if present (first 80 lines)
- `.env.example` if present (keys only)

### 3. Infer project type

Based on findings, classify the project as one or more of:
- `web-app` (frontend UI)
- `api` (backend/REST/GraphQL)
- `fullstack` (frontend + backend in same repo, including server-rendered apps such as
  Laravel + Blade, Rails + ERB, or Django + templates)
- `cli` (command-line tool)
- `library` (npm/pip/cargo package)
- `mobile` (React Native, Flutter, Expo)
- `monorepo` (multiple apps/packages)
- `infrastructure` (IaC, DevOps-only)

### 4. Generate AGENTS.md

Write `AGENTS.md` at the project root with the following structure. Be specific — list actual package versions from dependency files, not guesses. If something is uncertain, omit it rather than guess.

```markdown
# Project Context

## Project Type
<!-- e.g., fullstack web-app, monorepo -->

## Stack

### Language & Runtime
<!-- e.g., TypeScript 5.4, Node.js 20 -->

### Framework
<!-- e.g., Next.js 14 (App Router) -->

### Styling
<!-- e.g., Tailwind CSS 3.4, shadcn/ui -->

### Database & ORM
<!-- e.g., PostgreSQL via Prisma 5.x -->

### Testing
<!-- e.g., Vitest, Playwright for E2E -->

### Build & Tooling
<!-- e.g., Vite, Turborepo, pnpm workspaces -->

### Deployment
<!-- e.g., Vercel (frontend), Docker (API) -->

## Project Structure
<!-- Brief description of top-level directories and their purpose -->

## Environment Variables
<!-- List .env keys (no values) and what they're for if inferable -->

## Development Commands
<!-- Where the commands actually live depends on the stack:
     - Node: package.json "scripts"
     - PHP/Laravel: composer.json "scripts" AND the artisan console
       (php artisan serve / test / migrate / migrate --seed / tinker)
     - Python: pyproject.toml, Makefile, or the README
     - Docker: docker compose up, docker compose run --rm <svc> <cmd>
     List the commands that genuinely work in THIS project. If the project ships a
     Dockerfile or compose file, lead with the containerized form — it is the one
     that works without a local runtime. -->
```

### 5. Confirm to the user

After writing `AGENTS.md`, report:
- What stack was detected
- Where the file was written
- Any ambiguities or gaps that could not be determined automatically

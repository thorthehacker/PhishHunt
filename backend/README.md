# Phish Hunt — Backend (FastAPI)

The backend is the **brain of Phish Hunt**. It is a Python FastAPI application
that stores everything in **PostgreSQL**, serves the API the dashboard talks to,
clones real websites into phishing pages, injects the credential-capture
script, records every capture, and computes all the live metrics.

- Default address: **http://localhost:8000**
- API docs (Swagger UI): **http://localhost:8000/docs**
- Start command (from project root): `.\start-backend.ps1`

---

## How to run it

```powershell
# PostgreSQL must be running first (see root README for DB setup)
.\start-backend.ps1
```

The script creates/activates a Python virtual environment, installs
`requirements.txt`, then starts `uvicorn main:app`. On **first startup** it will:

1. Auto-create every database table.
2. Auto-apply small schema migrations.
3. Create the default **admin / admin** account (password change forced on
   first login).
4. Seed the starter template (#0) on a completely fresh database.

---

## Folders & Files — what each one does

```
backend/
├── main.py                # App entry point. Registers routers, CORS, startup:
│                          #   creates tables, runs migrations, creates admin.
├── database.py            # PostgreSQL engine + session factory (DATABASE_URL in .env)
├── config.py              # pydantic-settings: reads .env (DATABASE_URL, JWT, allowed domains)
├── requirements.txt       # Version-pinned Python dependencies
├── seed/                  # .phe files installed as templates on FIRST startup
│                          #   (contains the starter flow → page #743, template #0)
├── clone-assets/          # Images/fonts/HTML downloaded when cloning real websites,
│                          #   one folder per landing-page id      (victim-facing files)
├── campaigns/             # Campaign management
│   ├── models.py          #   Campaign table (sent/clicked/submitted counters)
│   └── router.py          #   /campaigns — list & create campaigns, /campaigns/metrics
│                          #   (live Links Clicked + Data Submitted + risk level),
│                          #   /campaigns/timeline (daily clicks & submissions)
├── captures/              # The heart of the data side
│   ├── models.py          # Capture row: ip, email, password hash/flag, session, raw json
│   └── router.py          # POST /captures/submit  (public — this is what victims hit)
│                          # GET /captures/        (dashboard: recent captures list)
│                          # GET /captures/{id}    (full detail for the user modal)
├── landing_pages/         # Everything about phishing pages
│   ├── models.py          # LandingPage (html_content, capture_fields, state) + Flow
│   ├── router.py          # CRUD, URL import/cloning, upload, template build,
│                          #   serve page/assets, flow save/load, .phe export/import,
│                          #   seeding of template #0
│   └── __init__.py
├── cloner/                # The real-website cloning engine
│   ├── fetcher.py         # Downloads the site + its assets (httpx + Playwright render)
│   ├── template.py        # HTML templating helpers
│   ├── renderer.py        # Renders JS-driven pages so clones look pixel-perfect
│   ├── localizer.py       # Rewrites/re-localises asset links so the clone is self-hosted
│   └── security.py        # Sanitisation helpers for imported HTML
├── auth/                  # Login & user management
│   ├── models.py          # User table (argon2 password hash, must_change_password)
│   ├── utils.py           # JWT cookie creation, get_current_user dependency
│   └── router.py          # /auth/login, /auth/me (+update), /auth/change-password
├── tracking/              # Link-click tracking (live "Links Clicked" metric)
│   ├── models.py          # LinkVisit row: one per open of /build/:id
│   └── router.py          # POST /tracking/page-visit (public — called by the frontend)
└── venv/                  # Python virtual environment (created by start-backend.ps1)
```

---

## How the pieces work together (simple words)

1. **A victim opens `http://localhost:3000/build/743`.** The *frontend* (Next.js)
   asks the backend for `landing_pages/743/page` + `/flow`, assembles the flow,
   and records a visit via `POST /tracking/page-visit` → this is what makes
   **Links Clicked** live.
2. **The page contains an injected capture script.** It watches all
   inputs/buttons, and sends what the victim typed to
   `POST /captures/submit` (email/username, password or "password entered"
   flag, OTP, IP, user-agent…). Each submission **also increments the
   Data Submitted metric** (counted straight from the captures table, so the
   dashboard and Recent Captures are always in sync).
3. **The dashboard polls every 5 seconds** for
   `/campaigns/metrics`, `/captures/`, and `/campaigns/timeline`
   (daily click/submission buckets — the Engagement Timeline).
4. **Authentication is cookie-based JWT** (HTTP-only cookie, `withCredentials`
   on the frontend). Public (unauthenticated) endpoints exist only for
   victim-facing things: serving cloned pages/assets, `/captures/submit`,
   `/tracking/page-visit`, flow fetching and `.phe`-related helpers.

---

## Environment (backend/.env)

```
DATABASE_URL=postgresql+asyncpg://phishhunt:phishhunt_password@localhost:5432/phishhunt
JWT_SECRET=change-me-in-production
ALLOWED_IMPORT_DOMAINS=...   # optional whitelist for URL imports
```

## Key dependencies (requirements.txt)

| Package | Why |
|---------|-----|
| fastapi / uvicorn | The API framework & server |
| sqlalchemy[asyncio] / asyncpg | Async PostgreSQL access |
| argon2-cffi / passlib | Secure password hashing |
| python-jose | JWT auth cookies |
| playwright | Renders real sites (incl. JS) for perfect clones |
| httpx / brotli | Downloading pages & assets |
| beautifulsoup4 / lxml | HTML parsing while injecting the capture script |
| alembic / python-multipart / pydantic | Migrations, form uploads, validation |

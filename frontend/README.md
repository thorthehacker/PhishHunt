# Phish Hunt — Frontend (Next.js)

The frontend is everything you **see and click**: the phishing-simulation
operator's dashboard, the Landing Pages manager with the **Visual Editor**, the
victim-facing `/build/:id` page server, and the real-time metrics you watch
while a simulation is running.

- Default address: **http://localhost:3000**
- Start command (from project root): `.\start-frontend.ps1`
- Talks to the backend at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`,
  set in `.env.local`).

---

## How to run it

```powershell
# Requires npm install once (the start script does it for you)
.\start-frontend.ps1     # → npm install + npm run dev
```

---

## Folders & Files — what each one does

```
frontend/
├── src/
│   ├── app/                     # Next.js App Router — every page & route
│   │   ├── page.tsx            → redirects to the dashboard
│   │   ├── login/              → the login screen (React Bits "Light Rays"
│   │                             & interactive backgrounds, 2px border card)
│   │   ├── change-password/    → forced first-login password change
│   │   ├── dashboard/          → Campaign Dashboard: live metric cards, polling
│   │                           → every 5 s, Engagement Timeline (daily data),
│   │                           → Recent Captures (opened right below the graph)
│   │   ├── landing-pages/      → Landing Pages manager: template picker,
│   │                           → upload/custom HTML, capture fields, live
│   │                           → preview, .phe import/export, page CRUD
│   │   ├── build/[id]/route.ts        → VICTIM-FACING server route: serves the
│   │                                   → phishing page for /build/743, records
│   │                                   → the link-click (tracking/metrics)
│   │   ├── build/[id]/[slug]/route.ts → same, for the multi-page flow subpages
│   │   ├── reports/            → Awareness Reports: per-user scores, risk
│   │                           → heatmap, PDF export
│   │   ├── settings/           → change username / password
│   │   ├── layout.tsx          → root layout, fonts, metadata
│   │   └── globals.css         → Tailwind v4 styling + global design tokens
│   ├── components/
│   │   ├── VisualEditor.tsx    → THE Visual Editor: big canvas, drag panels,
│   │                           → button wiring, New Pages, Notes, URLs, locks,
│   │                           → Dynamic Fetching marks & value pipes
│   │   ├── Sidebar.tsx         → left panel: Dashboard, Landing Pages, Reports,
│   │                           → Settings, Logout (+ active highlight)
│   │   ├── MetricCard.tsx      → animated dashboard metric card
│   │   ├── LightRays.tsx       → React Bits "Light Rays" background (login)
│   │   └── Squares.tsx         → React Bits "Squares" canvas background
│   ├── lib/
│   │   ├── api.ts              → axios instance (cookie auth, 401 → /login)
│   │   └── flowRuntime.ts     → compiles your saved Visual Editor flow into a
│   │                             runtime script + serves the right page node:
│   │                             button wiring, capture actions, DF piping
│   └── (globals)               → typescript/tailwind/eslint configs live here
├── public/
│   ├── logo.png               → the fish-on-a-hook logo
│   └── templates/             → built-in login templates (instagram.html …)
│       └── builds/<page-id>/   → per-page copies created by the template build
├── package.json               → dependencies & scripts (dev/build/start/lint)
└── next.config.ts             → Next.js configuration
```

---

## How the pieces work together (simple words)

1. **Operator side:** after login, the Sidebar drives you between
   dashboard, landing pages, reports and settings. All data comes from the
   backend over axios with an HTTP-only auth cookie.
2. **The Visual Editor** (opened from Landing Pages → Edit → Visual Editor)
   stores a *flow*: page panels + button connections. When you hit **Save**,
   this flow goes to the backend and the frontend becomes able to *serve* it.
3. **Victim side:** opening `/build/743` runs a Next.js *server route* that
   fetches the page HTML + flow from the backend, picks the entry page, and
   injects the runtime script from `flowRuntime.ts`. This script:
   - wires buttons to actions (Capture / New Page / URL / Do Nothing),
   - silently reads credentials into fields and posts them to the backend,
   - pipes **Dynamic Fetching** values from page to page via sessionStorage,
   - unlocks disabled wired buttons so nothing "does nothing".
4. **Real time:** opening any `/build/:id` link also calls
   `POST /tracking/page-visit` on the backend — this feeds the live
   **Links Clicked** metric. The dashboard then polls metrics, captures and
   the daily timeline every **5 seconds**, so new captures and clicks show up
   without refreshing.

## Key dependencies (package.json)

| Package | Why |
|---------|-----|
| next 16 / react 19 | App framework |
| axios | Backend API calls |
| tailwindcss v4 | All styling |
| framer-motion | Animations (cards, modals, login screen) |
| recharts | Engagement Timeline & reporting charts |
| lucide-react | Icons |
| ogl | React Bits Light Rays WebGL background |


# Engineering Efficiency

A small, local dashboard for engineering-team efficiency metrics sourced from
[Linear](https://linear.app). Data is downloaded from the Linear API and stored
in a local SQLite database; the dashboard reads only from that database.

**Scope:** configuration, Linear download, SQLite storage, per-team refresh,
computed efficiency metrics (planning efficiency, velocity, bandwidth) and
TanStack Charts visualisations.

## Efficiency model

- A day's work is **2 points**; no issue should exceed 4 points.
- A cycle is **10 working days** (20 points per person), adjustable per cycle for
  holidays.
- Capacity for a person = `(working_days − unavailable_days) × 2` points.
- Only members with **Counts toward capacity** enabled contribute capacity. This
  defaults to active, assignable Linear members (guests and deactivated users are
  excluded automatically) and is editable per member. Non-counting assignees
  still contribute their points to *taken*, with zero capacity.
- **Planning efficiency** = `planned ÷ taken`, where *planned* is work attached to
  the cycle **on or before its first day**. Work attached after the first day is
  **adhoc**.
- **Velocity** = `done ÷ (progress × taken)`, where `progress` is the fraction of
  the cycle's working days elapsed so far (only `completed` states count as
  done). At cycle end this reduces to `done ÷ taken`; 100% means on pace.
- The **velocity trend** replots that formula at the end of each elapsed working
  day (points completed *by* that day ÷ points expected *by* that day), showing
  how pace has moved through the cycle. It is returned per team and per role.
- **Bandwidth efficiency** = `taken ÷ capacity`.
- Members can be tagged with a **role** (`DEV` or `QA`). The dashboard groups the
  metrics above by role (team totals are recomputed per group), so DEV and QA can
  be compared side by side. Untagged members appear under *Unspecified*.
- Team-level values are the ratio of team totals (not sums of ratios).
- Issues with no estimate count as 0 points (flagged as *unestimated*); unassigned
  work is included in team totals under an *Unassigned* row.

## Stack

| Layer     | Choice                                                                 |
| --------- | ---------------------------------------------------------------------- |
| Backend   | Python 3.11+, FastAPI, SQLAlchemy 2.0, SQLite, httpx (Linear GraphQL)  |
| Frontend  | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, TanStack Router / Query / Table / Charts |
| Packaging | `uv` (Python), `pnpm` (Node)                                           |

The UI uses [shadcn/ui](https://ui.shadcn.com) (Base UI primitives) with Tailwind
CSS v4 and an Inter-based amber theme defined in `frontend/src/index.css`. The
preset is tracked in `frontend/components.json`; re-apply it with
`pnpm dlx shadcn@latest apply --preset b6FTt6ua8`.

FastAPI serves both the JSON API under `/api` and the built React SPA.

## Repository layout

```
engineering-efficiency/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app + SPA hosting
│   │   ├── config.py         # settings (EE_* env vars)
│   │   ├── database.py       # SQLite engine / sessions
│   │   ├── models.py         # LinearConfig, Team, Issue, CycleSettings, ...
│   │   ├── schemas.py        # Pydantic API schemas
│   │   ├── linear_client.py  # Linear GraphQL client
│   │   ├── metrics.py        # efficiency metric computation
│   │   ├── sync.py           # download + upsert logic
│   │   └── routers/          # config, teams, stats endpoints
│   ├── data/                 # SQLite database (gitignored)
│   └── pyproject.toml
└── frontend/
    ├── src/
    │   ├── api.ts            # typed API client
    │   ├── router.tsx        # TanStack Router routes
    │   ├── index.css         # Tailwind v4 + shadcn theme tokens
    │   ├── pages/            # DashboardPage, ConfigPage
    │   ├── components/       # MetricCharts, MetricsTable, CycleSettingsPanel, ...
    │   └── components/ui/    # shadcn/ui primitives (button, card, select, ...)
    ├── components.json       # shadcn configuration / preset
    ├── vite.config.ts        # dev proxy /api -> :8000, Tailwind, @ alias
    └── package.json
```

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/) and Python 3.11+
- Node.js 20+ and [`pnpm`](https://pnpm.io/)

## Getting started (development)

Run the backend and the Vite dev server in two terminals.

**Terminal 1 — backend:**

```sh
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — frontend:**

```sh
cd frontend
pnpm install
pnpm dev
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the backend on `:8000`.

## Running as a single server (production-style)

```sh
cd frontend && pnpm install && pnpm build
cd ../backend && uv sync && uv run uvicorn app.main:app --port 8000
```

Open <http://localhost:8000>. FastAPI serves the built SPA from
`frontend/dist`, with a fallback to `index.html` for client-side routes.

## Using the app

1. Create a Linear **personal API key**: Linear → *Settings* → *Security & access*
   → *Personal API keys*.
2. Open **Configuration**, paste the key, and click **Save & validate**. The key
   is stored only in your local SQLite database.
3. Click **Import teams from Linear** to fetch the team list.
4. Click **Refresh** on a team to download its **current cycle's** issues and
   membership into SQLite. Refreshing replaces the stored issues, so only the
   active cycle is ever kept.
5. In **Configuration → Cycle & availability**, confirm the cycle dates pulled
   from Linear, override the number of working days if the cycle contains
   holidays, tag each person as **DEV** or **QA**, untick anyone who shouldn't
   count toward capacity (non-developers, people not on this cycle), and set
   **unavailable days** (planned leave) per person.
6. Open **Dashboard**, pick a team, and review the metric cards, charts
   (capacity vs taken, velocity, planned vs adhoc), the **role breakdown** table
   and the per-person table (which can be filtered by role).

> Only issues from each team's **active cycle** are downloaded and stored. Each
> issue records the cycle it belongs to (`cycle_id`, `cycle_name`,
> `cycle_number`) and when it was attached (`added_to_cycle_at`), which is how
> adhoc work is detected.

## API reference

| Method | Path                        | Description                                  |
| ------ | --------------------------- | -------------------------------------------- |
| GET    | `/api/health`               | Liveness check                               |
| GET    | `/api/config`               | Current Linear connection status             |
| PUT    | `/api/config`               | Save + validate a Linear API key             |
| POST   | `/api/config/test`          | Re-test the saved connection                 |
| GET    | `/api/teams`                | List locally stored teams                    |
| POST   | `/api/teams/import`         | Fetch the team list from Linear              |
| POST   | `/api/teams/{id}/refresh`   | Download the team's current-cycle issues    |
| DELETE | `/api/teams/{id}`           | Delete a team and its locally stored data   |
| GET    | `/api/teams/{id}/issues`    | List stored issues (paginated)               |
| GET    | `/api/teams/{id}/sync-runs` | Recent sync history for a team               |
| GET    | `/api/teams/{id}/cycle`     | Current cycle dates, working days, members   |
| PUT    | `/api/teams/{id}/cycle`     | Update working days, dates, member leave/counting/role |
| GET    | `/api/teams/{id}/stats`     | Computed efficiency metrics (team, per-role, per-person, velocity trend) |

Interactive docs are available at `/docs` while the backend is running.

## Database

The SQLite file lives at `backend/data/engineering_efficiency.db` (gitignored).
Tables:

- `linear_config` — the saved API key and resolved viewer/org info (singleton).
- `teams` — teams imported from Linear, with issue counts and last-synced time.
- `issues` — the **current cycle's** issues per team, with state, assignee,
  project, cycle (`cycle_id` / `cycle_name` / `cycle_number`), when each issue
  was added to the cycle (`added_to_cycle_at`), estimates, Linear timestamps, and
  the raw JSON payload.
- `cycle_settings` — per team/cycle start & end dates, the working-days override
  and whether the dates were edited manually.
- `team_members` — the team's Linear membership, with active/assignable flags,
  whether each member counts toward capacity, and the optional `DEV`/`QA` role tag.
- `member_unavailability` — planned leave (days) per member per cycle.
- `sync_runs` — audit log of every import/refresh.

> Refreshing a team deletes its previously stored issues and inserts the active
> cycle's set, so the database only ever holds each team's current cycle. Cycle
> settings and per-member availability/counting flags are preserved across
> refreshes; members no longer returned by Linear are dropped.

## Configuration

Backend settings are overridable via `EE_`-prefixed environment variables (see
`backend/.env.example`), e.g. `EE_DATABASE_URL`, `EE_FRONTEND_DIST`.

## Notes

- Metrics use the **current** cycle only. Historical cycles are not retained.
- A null estimate counts as 0 points but is surfaced as *unestimated*.
- Two-way sync is out of scope: this app only reads from Linear.

# Engineering Efficiency

A small, local dashboard for engineering-team efficiency metrics sourced from
[Linear](https://linear.app). Data is downloaded from the Linear API and stored
in a local SQLite database; the dashboard reads only from that database.

**Scope:** configuration, Linear download, SQLite storage, per-team refresh and
delete, fluid member groups, computed efficiency metrics (planning efficiency,
velocity, velocity trend, bandwidth) and TanStack Charts visualisations.

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
  done). The current day only counts once the configured end-of-day cutoff has
  passed in the configured working timezone, so a partial day is not treated as
  elapsed. At cycle end this reduces to `done ÷ taken`; 100% means on pace.
- The **velocity trend** plots the same metric at the end of each elapsed working
  day: cumulative points done ÷ **fractional points**, where fractional points =
  `(taken ÷ working_days) × passed_days`. Days only appear once their cutoff has
  passed, so the last point equals the headline velocity. It is returned per
  team and per group.
- **Bandwidth efficiency** = `taken ÷ capacity`.
- Members can be assigned to one **group** per team. Groups are fluid: add,
  rename or delete any number of them. The dashboard recomputes the metrics above
  per group (ratios of the group's totals) so groups can be compared side by
  side, and the filter can combine any selection of groups. Members without a
  group roll up under *Unassigned*.
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
│   │   ├── app_settings.py   # working timezone / cutoff preferences
│   │   ├── database.py       # SQLite engine / sessions
│   │   ├── models.py         # LinearConfig, Team, Issue, CycleSettings, ...
│   │   ├── schemas.py        # Pydantic API schemas
│   │   ├── linear_client.py  # Linear GraphQL client
│   │   ├── metrics.py        # efficiency metric computation
│   │   ├── sync.py           # download + upsert logic
│   │   └── routers/          # config, settings, teams, stats endpoints
│   ├── data/                 # SQLite database (gitignored)
│   └── pyproject.toml
└── frontend/
    ├── src/
    │   ├── api.ts            # typed API client
    │   ├── types.ts          # shared API types
    │   ├── router.tsx        # TanStack Router routes
    │   ├── index.css         # Tailwind v4 + shadcn theme tokens
    │   ├── lib/              # formatting, timezone + group helpers
    │   ├── hooks/            # app settings + shared config team selection
    │   ├── pages/            # DashboardPage, ConfigLayout (+ per-section config routes)
    │   ├── components/       # charts, tables, LinearSetupPanel, CycleConfigurationPanel, GroupsPanel, ...
    │   └── components/ui/    # shadcn/ui primitives (button, card, select, switch, alert-dialog, ...)
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
2. Open **Configuration**, pick **Linear Setup** in the side panel, paste the key,
   and click **Save & validate**. The key is stored only in your local SQLite
   database.
3. Still in **Linear Setup**, click **Import teams** to fetch the team list. Teams
   that Linear reports as archived/deleted, or that have cycles disabled, are
   skipped. Then **Refresh** a team to download its **current cycle's** issues and
   membership into SQLite. Refreshing replaces the stored issues, so only the
   active cycle is ever kept. **Delete** removes a team and all of its local data
   (Linear is untouched).
4. In **Configuration → Time Configuration**, set the **working timezone** and
   the **hour after which the current day counts as elapsed** (default 7 PM). A
   day is only treated as elapsed once that local time has passed, so velocity
   isn't measured against a day that is still in progress.
5. In **Configuration → Cycle Configuration**, confirm the cycle dates pulled
   from Linear and override the number of working days if the cycle contains
   holidays.
6. In **Configuration → Groups**, add as many **groups** as you need (e.g.
   Backend, Frontend, QA).
7. In **Configuration → Team Configuration**, assign each person to one of those
   groups, untick anyone who shouldn't count toward capacity (non-developers,
   people not on this cycle), and set **unavailable days** (planned leave) per
   person.
8. Open **Dashboard**, pick a team, and use the **group filter** (All groups or
   any combination) at the top to scope the cards, charts and tables. Review the
   metric cards, the **velocity trend** line, the per-person charts (capacity vs
   taken, velocity, planned vs adhoc), the **group breakdown** table, the
   per-person table, and the **Issues** table (tick **Show done** to include
   completed issues).

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
| GET    | `/api/settings`             | Working timezone + end-of-day cutoff         |
| PUT    | `/api/settings`             | Update the working timezone / cutoff         |
| GET    | `/api/teams`                | List locally stored teams                    |
| POST   | `/api/teams/import`         | Fetch the team list from Linear              |
| POST   | `/api/teams/{id}/refresh`   | Download the team's current-cycle issues    |
| DELETE | `/api/teams/{id}`           | Delete a team and its locally stored data   |
| GET    | `/api/teams/{id}/issues`    | List stored issues (paginated)               |
| GET    | `/api/teams/{id}/sync-runs` | Recent sync history for a team               |
| GET    | `/api/teams/{id}/cycle`     | Current cycle dates, working days, groups, members |
| PUT    | `/api/teams/{id}/cycle`     | Update working days, dates, member leave/counting/group |
| GET    | `/api/teams/{id}/groups`    | List a team's member groups                  |
| POST   | `/api/teams/{id}/groups`    | Add a member group                           |
| PUT    | `/api/teams/{id}/groups/{groupId}` | Rename a member group                 |
| DELETE | `/api/teams/{id}/groups/{groupId}` | Delete a group (unassigns its members)        |
| GET    | `/api/teams/{id}/stats`     | Computed efficiency metrics (team, per-group, per-person, velocity trend) |

Interactive docs are available at `/docs` while the backend is running.

## Database

The SQLite file lives at `backend/data/engineering_efficiency.db` (gitignored).
Tables:

- `linear_config` — the saved API key and resolved viewer/org info (singleton).
- `app_settings` — the working timezone and end-of-day cutoff used by the metrics
  (singleton).
- `teams` — teams imported from Linear, with issue counts and last-synced time.
- `issues` — the **current cycle's** issues per team, with state, assignee,
  project, cycle (`cycle_id` / `cycle_name` / `cycle_number`), when each issue
  was added to the cycle (`added_to_cycle_at`), estimates, Linear timestamps, and
  the raw JSON payload.
- `cycle_settings` — per team/cycle start & end dates, the working-days override
  and whether the dates were edited manually.
- `team_members` — the team's Linear membership, with active/assignable flags,
  whether each member counts toward capacity, and the optional group assignment.
- `member_groups` — the per-team groups members can be assigned to.
- `member_unavailability` — planned leave (days) per member per cycle.
- `sync_runs` — audit log of every import/refresh.

> Refreshing a team deletes its previously stored issues and inserts the active
> cycle's set, so the database only ever holds each team's current cycle. Cycle
> settings and per-member availability/counting flags are preserved across
> refreshes; members no longer returned by Linear are dropped.

> Deleting a team removes its row and all of its child data (issues, cycle
> settings, members, leave); its sync history is kept but detached. Linear is not
> affected — re-import and refresh to bring the team back.

## Configuration

Backend settings are overridable via `EE_`-prefixed environment variables (see
`backend/.env.example`), e.g. `EE_DATABASE_URL`, `EE_FRONTEND_DIST`.

Metric timing — the working timezone and the hour after which the current day
counts as elapsed — is configured in the app under **Configuration → Time
Configuration** and stored in the `app_settings` table. The timezone is used for
every date-based calculation and for displaying dates/times across the dashboard,
including the cycle start/end date pickers.

## Notes

- Metrics use the **current** cycle only. Historical cycles are not retained.
- A null estimate counts as 0 points but is surfaced as *unestimated*.
- Two-way sync is out of scope: this app only reads from Linear.

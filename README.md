# Engineering Efficiency

A small, local dashboard for engineering-team efficiency metrics sourced from
[Linear](https://linear.app). Data is downloaded from the Linear API and stored
in a local SQLite database; the dashboard reads only from that database.

**Scope:** Linear download, SQLite storage, per-team refresh and delete, fluid
member groups, cycle history, computed cycle metrics (planning efficiency,
velocity, velocity trend, bandwidth, available points, adhoc and unutilized
cost), a **Projects** view with point/cost totals, and TanStack Charts
visualisations.

The app has three top-level pages: **Cycles**, **Projects**, and **Settings**.

## Efficiency model

- A day's work is **2 points**; no issue should exceed 4 points.
- A cycle is **10 working days** (20 points per person) by default, or the
  weekday count between the cycle's start and end. Working days and dates are
  adjustable per cycle (holidays, local calendar). Once dates are edited they
  are marked overridden and a later Linear refresh will not overwrite them.
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
- **Available points** = leftover capacity (`capacity − taken`). Shown as points
  plus an approximate day count (`points ÷ 2`).
- **Cost of adhoc work** = `(adhoc_points ÷ 2) × man_day_cost`: since a man-day is
  2 points, the adhoc points are converted to man-days and valued at the team's
  man-day cost.
- **Unutilized capacity cost** = `(max(capacity − taken, 0) ÷ 2) × man_day_cost`:
  the value of capacity points that were not allocated to work.
- **Project cost** = `(project_points ÷ 2) × man_day_cost`. Project points exclude
  canceled issues. Projects are synced independently of cycles, so the total can
  include work that spans (or never sat in) a stored cycle.
- Members can be assigned to one **group** per cycle. Groups are fluid team-level
  names with a colour (add, rename, recolour or delete). Group assignment and
  “counts toward capacity” are snapshotted on each cycle and **copied forward**
  when a new cycle is created; planned leave starts at zero on the new cycle.
  The Cycles page recomputes the metrics above per group for the selected cycle.
  Members without a group roll up under *Unassigned*.
- Team-level values are the ratio of team totals (not sums of ratios).
- Issues with no estimate count as 0 points (flagged as *unestimated*); unassigned
  work is included in team totals under an *Unassigned* row.
- **Sub-issues** (Linear issues with a parent) are dropped on both cycle and
  project refresh so nested work is not double-counted.

In the group and per-person tables:

- **Velocity** is orange above 100%, red below 85%, and otherwise neutral.
- **Bandwidth** and **planning efficiency** show the percentage plus the matching
  fraction (`taken/capacity` and `planned/taken`). Values below 100% are amber;
  values above 100% are red; exactly 100% is neutral.

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
│   │   ├── database.py       # SQLite engine / sessions / migrations
│   │   ├── models.py         # LinearConfig, Team, Issue, Cycle, Project, ...
│   │   ├── schemas.py        # Pydantic API schemas
│   │   ├── linear_client.py  # Linear GraphQL client
│   │   ├── metrics.py        # cycle efficiency metric computation
│   │   ├── projects.py       # project point / cost totals
│   │   ├── sync.py           # download + upsert (teams, cycles, projects)
│   │   ├── transfer.py       # secret-free DB snapshot export / import
│   │   ├── cycles.py         # cycle settings + membership snapshots
│   │   ├── costs.py          # per-team currency / man-day cost
│   │   ├── group_colors.py   # group colour palette + hex validation
│   │   └── routers/          # config, settings, teams, cycles, groups, costs, stats, projects
│   ├── data/                 # SQLite database (gitignored)
│   └── pyproject.toml
└── frontend/
    ├── src/
    │   ├── api.ts            # typed API client
    │   ├── types.ts          # shared API types
    │   ├── router.tsx        # TanStack Router routes (Cycles, Projects, Settings)
    │   ├── index.css         # Tailwind v4 + shadcn theme tokens
    │   ├── lib/              # formatting, timezone, groups, project-state, table helpers
    │   ├── hooks/            # app settings + shared config team selection
    │   ├── pages/            # DashboardPage (Cycles), ProjectsPage, ConfigLayout
    │   ├── components/       # charts, tables, settings panels, ...
    │   └── components/ui/    # shadcn/ui primitives
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
2. Open **Settings**, pick **Linear Setup** in the side panel, paste the key,
   and click **Save & validate**. The key is stored only in your local SQLite
   database.
3. Still in **Linear Setup**, click **Import teams** to fetch the team list. Teams
   that Linear reports as archived/deleted, or that have cycles disabled, are
   skipped. Then **Refresh** a team to download its **current cycle's** issues and
   membership into SQLite. Refreshing replaces the stored issues for that cycle,
   so only the active cycle is rewritten. **Delete** removes a team and all of
   its local data, including projects (Linear is untouched).
4. In **Settings → Time Configuration**, set the **working timezone** and
   the **hour after which the current day counts as elapsed** (default 7 PM). A
   day is only treated as elapsed once that local time has passed, so velocity
   isn't measured against a day that is still in progress.
5. In **Settings → Cycle Configuration**, confirm the cycle dates pulled
   from Linear (or override them) and the number of working days if the cycle
   contains holidays. When Linear moves a team on to a new cycle, **Refresh** is
   blocked until its current cycle is finalized: use **Finalize Cycle** on this
   page to freeze it (the data is kept for history), then refresh the team to
   download its new cycle. Each team is finalized independently. Finalized cycle
   dates, working days and member snapshots are locked.
6. In **Settings → Groups**, add as many **groups** as you need (e.g.
   Backend, Frontend, QA) and pick a colour for each. A group still referenced
   by a finalized cycle cannot be deleted.
7. In **Settings → Team Configuration**, set the team's **Cost
   Configuration** (currency symbol — `€`, `$` or `₹` — and man-day cost), then
   under **Team Members** assign each person to one of those groups, untick
   anyone who shouldn't count toward capacity (non-developers, people not on
   this cycle), and set **unavailable days** (planned leave) for the current
   cycle. The next cycle copies groups and capacity; leave starts at zero.
8. Open **Cycles**, pick a team and a **cycle** (defaults to the current one;
   finalized cycles stay available for history). Use the **group filter** (All
   groups or any combination) at the top to scope the cards, charts and tables.
   Review the metric cards (**planning**, **velocity**, **bandwidth**, **adhoc
   points**, **cost of adhoc work**, **unutilized capacity cost**), the
   per-person charts (capacity vs taken, velocity with 100% / 85% guides,
   planned vs adhoc), the **velocity trend** line, the **group breakdown**
   table, the **per-person** table, and the **Issues** table (tick **Show done**
   to include completed issues; the Project column is shown here). Click any
   column header to sort a table. Shared metric columns are bandwidth, velocity,
   available points, completed points, adhoc points and planning efficiency.
   Zero unavailable days and non-positive available points render as a dash.
9. Open **Projects** and pick a team. **Refresh** downloads that team's Linear
   projects and their issues (a separate sync from cycle refresh; archived
   projects are not kept). Headline cards show project count, points and total
   cost. Filter by Linear project state (defaults to **started** and
   **completed**). The bar chart and table list cost, points and done points;
   select a row to inspect that project's issues (**Show done** defaults on).
   Canceled issues stay in the issue list but are excluded from points and cost.
10. To share a local copy, open **Settings → Import / Export**. **Download
    export** writes a zip containing a JSON snapshot of teams, cycles, issues,
    groups, costs, projects and settings. The Linear API key (and any other
    secrets) is never included. The other person imports that zip — or an
    older unpacked `.json` file — on the same page. Their existing Linear key
    is left alone, and they can save their own under **Linear Setup**. Import
    replaces shareable local data. The file must match this app's schema
    version (currently 4).

> Cycle refresh downloads only the team's **active** Linear cycle. Earlier
> finalized cycles stay stored and can be opened from the cycle picker. Each
> issue points at a `cycles` row and records when it was attached
> (`added_to_cycle_at`), which is how adhoc work is detected.
>
> Project refresh is independent: it rewrites `projects` / `project_issues` and
> does not touch cycle history.

## API reference

| Method | Path                        | Description                                  |
| ------ | --------------------------- | -------------------------------------------- |
| GET    | `/api/health`               | Liveness check                               |
| GET    | `/api/config`               | Current Linear connection status             |
| PUT    | `/api/config`               | Save + validate a Linear API key             |
| POST   | `/api/config/test`          | Re-test the saved connection                 |
| GET    | `/api/config/export`        | Download a zip snapshot (Linear key omitted) |
| POST   | `/api/config/import`        | Replace shareable local data from JSON or zip |
| GET    | `/api/settings`             | Working timezone + end-of-day cutoff         |
| PUT    | `/api/settings`             | Update the working timezone / cutoff         |
| GET    | `/api/teams`                | List locally stored teams                    |
| POST   | `/api/teams/import`         | Fetch the team list from Linear              |
| POST   | `/api/teams/{id}/refresh`   | Download the team's current-cycle issues    |
| DELETE | `/api/teams/{id}`           | Delete a team and its locally stored data   |
| GET    | `/api/teams/{id}/issues`    | List stored issues (paginated; `?cycle_id=` to pick a cycle) |
| GET    | `/api/teams/{id}/sync-runs` | Recent sync history for a team               |
| GET    | `/api/teams/{id}/cycles`    | List stored cycles (name, dates, current/finalized) |
| GET    | `/api/teams/{id}/cycle`     | Cycle dates, working days, groups, members (`?cycle_id=`) |
| PUT    | `/api/teams/{id}/cycle`     | Update working days, dates, member leave/counting/group |
| POST   | `/api/teams/{id}/cycle/finalize` | Finalize (freeze) the team's current cycle for history |
| GET    | `/api/teams/{id}/groups`    | List a team's member groups                  |
| POST   | `/api/teams/{id}/groups`    | Add a member group (optional colour)         |
| PUT    | `/api/teams/{id}/groups/{groupId}` | Rename or recolour a member group     |
| DELETE | `/api/teams/{id}/groups/{groupId}` | Delete a group (blocked if a finalized cycle still uses it) |
| GET    | `/api/teams/{id}/cost`      | A team's currency symbol and man-day cost    |
| PUT    | `/api/teams/{id}/cost`      | Update a team's currency symbol and man-day cost |
| GET    | `/api/teams/{id}/stats`     | Computed efficiency metrics (`?cycle_id=` to pick a cycle) |
| GET    | `/api/teams/{id}/projects`  | Stored projects with points, cost and nested issues |
| POST   | `/api/teams/{id}/projects/refresh` | Download the team's Linear projects and their issues |

Omitting `cycle_id` uses the team's current cycle. Interactive docs are
available at `/docs` while the backend is running.

## Database

The SQLite file lives at `backend/data/engineering_efficiency.db` (gitignored).
On startup the app creates missing tables and applies one-shot migrations up to
schema version **4**. Tables:

- `linear_config` — the saved API key and resolved viewer/org info (singleton).
  Not included in export.
- `app_settings` — the working timezone and end-of-day cutoff used by the metrics
  (singleton).
- `teams` — teams imported from Linear, with last-synced time and a pointer to
  the current cycle. `issue_count` is the last refresh's current-cycle count.
- `cycles` — first-class per-team cycles (Linear id, name/number, dates,
  working-days override, `dates_overridden`, finalize timestamp).
- `issues` — issues per cycle, uniquely keyed by `(cycle_id, linear_id)` so
  carry-over work can exist on consecutive cycles. Each row stores state,
  assignee, project, `added_to_cycle_at`, estimates, Linear timestamps, and the
  raw JSON payload.
- `team_members` — the team's Linear membership (identity, active/assignable).
- `member_groups` — the per-team groups members can be assigned to, including a
  hex colour.
- `cycle_memberships` — per-cycle snapshot of group, capacity flag and leave.
  Group and capacity are copied into a new cycle; leave starts at zero.
- `team_costs` — the per-team currency symbol and man-day cost used to value
  work.
- `projects` — Linear projects for a team (non-archived). Synced independently
  of cycles.
- `project_issues` — the current issue snapshot on each project. Separate from
  cycle `issues` so a project refresh never rewrites cycle history.
- `sync_runs` — audit log of every import/refresh (`teams`, `issues`, or
  `projects`).
- `schema_version` — records the applied local schema version. Not included in
  export.

> Refreshing a team replaces only its **active cycle's** issues; earlier cycles are
> retained. Cycle settings and per-member availability/counting flags are
> preserved across refreshes; members no longer returned by Linear are dropped.
> Project refresh replaces that team's project snapshot only.

> Cycle refresh is **blocked** when Linear's active cycle differs from the cycle
> stored locally and that cycle has not been finalized, so work can't be silently
> discarded. Finalize it first (below).

### Cycle history and finalization

Cycles are finalized **per team**, since teams can be on different cycle
schedules. **Settings → Cycle Configuration → Finalize Cycle** marks the
selected team's current cycle (`cycles.archived_at`) as finished and keeps its
issues, cycle row, planned leave and sync history in the same database. Once a
team's cycle is finalized, refreshing it downloads the next active cycle;
earlier cycles stay queryable from the Cycles page cycle picker (`?cycle_id=` on
stats/issues). Finalized cycle dates, working days and leave are locked. No
files are copied and there is no app-wide switch.

> Deleting a team removes its row and all of its child data (issues, cycles,
> projects, members, groups, costs); its sync history is kept but detached.
> Linear is not affected — re-import and refresh to bring the team back.

## Configuration

Backend settings are overridable via `EE_`-prefixed environment variables (see
`backend/.env.example`), e.g. `EE_DATABASE_URL`, `EE_FRONTEND_DIST`,
`EE_LINEAR_API_URL`, `EE_CORS_ORIGINS`.

Metric timing — the working timezone and the hour after which the current day
counts as elapsed — is configured in the app under **Settings → Time
Configuration** and stored in the `app_settings` table. The timezone is used for
every date-based calculation and for displaying dates/times across the app,
including the cycle start/end date pickers.

## Notes

- Cycle metrics default to the team's current cycle. The Cycles page cycle
  picker can open a finalized cycle; groups and capacity still reflect that
  cycle's snapshot. Each team rolls over independently.
- A null estimate counts as 0 points but is surfaced as *unestimated*.
- Two-way sync is out of scope: this app only reads from Linear.
- Cycle refresh and project refresh are separate downloads. Neither writes back
  to Linear.
- **Import / Export** shares the local SQLite snapshot, not a live Linear
  connection. Downloads are a zip containing JSON; import accepts that zip or
  a plain `.json` file. The Linear API key is never written into the file; the
  importer keeps whatever key they already saved. Exports that do not match
  schema version 4 are rejected.

import { useMemo } from 'react'
import { formatMoney, formatPoints } from '../lib/format'
import type { ProjectOut } from '../types'
import { StatCard } from './StatCard'

/** Headline project totals: count, points, and cost across non-excluded projects. */
export function ProjectStats({ projects }: { projects: ProjectOut[] }) {
  const included = useMemo(
    () => projects.filter((project) => !project.excluded),
    [projects],
  )
  const totals = useMemo(
    () =>
      included.reduce(
        (acc, project) => ({
          points: acc.points + project.points,
          cost: acc.cost + project.cost,
          issues: acc.issues + project.issue_count,
        }),
        { points: 0, cost: 0, issues: 0 },
      ),
    [included],
  )
  const excludedCount = projects.length - included.length
  const currency = included[0]?.currency ?? projects[0]?.currency ?? '$'
  const manDayCost = included[0]?.man_day_cost ?? projects[0]?.man_day_cost ?? 0

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Projects"
        value={included.length}
        hint={
          excludedCount > 0
            ? `${totals.issues} issue(s) · ${excludedCount} excluded`
            : `${totals.issues} issue(s) across all projects`
        }
      />
      <StatCard
        label="Points"
        value={formatPoints(totals.points)}
        hint="Canceled issues and excluded projects are omitted"
      />
      <StatCard
        label="Total cost"
        value={formatMoney(totals.cost, currency)}
        hint={
          manDayCost > 0
            ? `${formatMoney(manDayCost, currency)}/day`
            : 'Set a man-day cost in Settings'
        }
      />
    </div>
  )
}

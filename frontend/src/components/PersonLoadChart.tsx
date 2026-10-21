import { useMemo, type CSSProperties } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatPoints } from '../lib/format'
import { buildPersonLoad, type CountedPerson, type PersonLoadBar } from '../lib/personLoad'
import type { ProjectOut } from '../types'
import { GroupBadge } from './GroupBadge'

const PERSON_GRID =
  'grid grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]'

function pointTicks(max: number): number[] {
  if (max <= 0) return [0]
  if (max <= 2) return [0, max]
  return [0, max / 2, max]
}

function tickStyle(tick: number, max: number): CSSProperties {
  if (max <= 0 || tick <= 0) return { left: 0 }
  if (tick >= max) return { right: 0 }
  return { left: `${(tick / max) * 100}%`, transform: 'translateX(-50%)' }
}

function pointShare(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0
  return Math.min(100, (value / max) * 100)
}

function pointsLabel(bar: PersonLoadBar): string {
  const points = `${formatPoints(bar.done)}/${formatPoints(bar.total)}`
  const unestimated = bar.unestimated > 0 ? ` · ${bar.unestimated} unestimated` : ''
  const more = bar.moreQueued > 0 ? ` +${bar.moreQueued}` : ''
  return `${points}${unestimated}${more}`
}

function BarTrack({ bar, max }: { bar: PersonLoadBar; max: number }) {
  const done = pointShare(bar.done, max)
  const remaining = pointShare(bar.remaining, max)
  if (done === 0 && remaining === 0) return null
  return (
    <div className="relative h-3">
      {done > 0 ? (
        <div
          className={`absolute inset-y-0 left-0 bg-primary ${remaining > 0 ? 'rounded-l-sm' : 'rounded-sm'}`}
          style={{ width: `${done}%` }}
        />
      ) : null}
      {remaining > 0 ? (
        <div
          className={`absolute inset-y-0 bg-foreground/15 ${done > 0 ? 'rounded-r-sm' : 'rounded-sm'}`}
          style={{ left: `${done}%`, width: `${remaining}%` }}
        />
      ) : null}
    </div>
  )
}

function BarTooltip({ bar }: { bar: PersonLoadBar }) {
  if (bar.role === 'available') {
    return <span>No project work in progress or queued</span>
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{bar.project}</span>
      <span className="tabular-nums">
        {formatPoints(bar.done)}/{formatPoints(bar.total)} done · {formatPoints(bar.remaining)}{' '}
        left
      </span>
      {bar.unestimated > 0 ? (
        <span>
          {bar.unestimated} open {bar.unestimated === 1 ? 'issue' : 'issues'} without an estimate
        </span>
      ) : null}
      {bar.moreQueued > 0 ? (
        <span>
          {bar.moreQueued} more queued {bar.moreQueued === 1 ? 'project' : 'projects'}
        </span>
      ) : null}
    </span>
  )
}

export function PersonLoadChart({
  projects,
  countedPeople,
}: {
  projects: readonly ProjectOut[]
  countedPeople: readonly CountedPerson[]
}) {
  const groups = useMemo(
    () =>
      buildPersonLoad(
        projects.map((project) => ({
          id: project.id,
          name: project.name,
          excluded: project.excluded,
          state: project.state,
          startDate: project.start_date,
          targetDate: project.target_date,
          issues: project.issues.map((issue) => ({
            assigneeName: issue.assignee_name,
            stateType: issue.state_type,
            estimate: issue.estimate,
          })),
        })),
        countedPeople,
      ),
    [countedPeople, projects],
  )
  const maxPoints = Math.max(0, ...groups.flatMap((group) => group.bars.map((bar) => bar.total)))
  const ticks = pointTicks(maxPoints)

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody on the current cycle is counted toward capacity.
      </p>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col divide-y divide-border">
          {groups.map((group) => (
            <div key={group.person} className={`${PERSON_GRID} py-4 first:pt-0 last:pb-0`}>
              <div className="flex min-w-0 items-center gap-2" title={group.person}>
                <span className="min-w-0 truncate text-sm font-medium leading-5">{group.person}</span>
                <span className="shrink-0">
                  <GroupBadge name={group.groupName} color={group.groupColor} />
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {group.bars.map((bar) => (
                  <Tooltip key={bar.key}>
                    <TooltipTrigger
                      delay={200}
                      type="button"
                      className="flex w-full min-w-0 cursor-default flex-col gap-1 text-left"
                    >
                      {bar.role === 'available' ? (
                        <span className="text-sm leading-5 text-muted-foreground">Available</span>
                      ) : (
                        <>
                          <span className="flex items-baseline gap-3 text-sm leading-5">
                            <span className="min-w-0 flex-1 truncate font-medium">{bar.project}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {pointsLabel(bar)}
                            </span>
                          </span>
                          <BarTrack bar={bar} max={maxPoints} />
                        </>
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      <BarTooltip bar={bar} />
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className={PERSON_GRID}>
          <div className="hidden sm:block" />
          <div className="flex flex-col gap-1">
            <div className="relative h-4 text-[11px] text-muted-foreground">
              {ticks.map((tick) => (
                <span key={tick} className="absolute tabular-nums" style={tickStyle(tick, maxPoints)}>
                  {formatPoints(tick)}
                </span>
              ))}
            </div>
            <p className="text-center text-[11px] text-muted-foreground">Points</p>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

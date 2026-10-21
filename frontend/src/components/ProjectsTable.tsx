import { createColumnHelper } from '@tanstack/react-table'
import { CheckIcon, EllipsisVerticalIcon, TriangleAlertIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTimezone } from '../hooks/useAppSettings'
import { DEFAULT_POINTS_PER_DAY } from '../lib/capacity'
import { formatCalendarDate, formatPercent, formatPoints } from '../lib/format'
import {
  calculatedProjectDueDate,
  dueDateOffsetWorkingDays,
  formatWorkingDayOffset,
  workingDaysForPoints,
} from '../lib/projectSchedule'
import { calendarDaysLate, parseIsoDate, weekdaysUntil } from '../lib/timezone'
import { badgeVariantForState } from '../lib/issueState'
import {
  formatProjectHealth,
  projectHealthClassName,
  projectHealthSortRank,
} from '../lib/projectHealth'
import { EXCLUDED_PROJECT_STATE, formatProjectState, projectStateKey } from '../lib/projectState'
import { appTableFeatures } from '../lib/table'
import type { ProjectOut } from '../types'
import { DataTable, type AppColumnDef } from './DataTable'

const helper = createColumnHelper<typeof appTableFeatures, ProjectOut>()
const DONE_PERCENT_DIGITS = 1
const COMPLETE_TONE = 'text-emerald-600 dark:text-emerald-400'
const ALERT_TONE = 'text-amber-500 dark:text-amber-400'
const MISSING_START_TONE = 'text-red-600 dark:text-red-400'
const LATE_TONE = 'text-red-700 dark:text-red-400'
const DUE_OFFSET_GREEN_DAYS = 2
const DUE_OFFSET_ORANGE_DAYS = 7

/** ±2 working days is on estimate. Beyond that, 3–7 is a warning and 8+ is late. */
function calculatedDueTone(offset: number): string {
  const days = Math.abs(offset)
  if (days <= DUE_OFFSET_GREEN_DAYS) return COMPLETE_TONE
  if (days <= DUE_OFFSET_ORANGE_DAYS) return ALERT_TONE
  return LATE_TONE
}

function calculatedDueExplanation(offset: number): string | null {
  if (offset < 0) {
    return 'Before the due date: points may be missing, or the due date includes a release buffer.'
  }
  if (offset > 0) {
    return 'After the due date: the points exceed the estimate, so the project could be delayed.'
  }
  return null
}

function doneRatio(done: number, total: number): number | null {
  if (total <= 0) return null
  return done / total
}

function isPointsComplete(done: number, total: number): boolean {
  const ratio = doneRatio(done, total)
  if (ratio === null) return false
  return Number((ratio * 100).toFixed(DONE_PERCENT_DIGITS)) === 100
}

function isCompletedState(state: string | null): boolean {
  return projectStateKey(state) === 'completed'
}

function isStartedState(state: string | null): boolean {
  return projectStateKey(state) === 'started'
}

/** In progress and planned projects are expected to have a start date. */
function expectsStartDate(state: string | null): boolean {
  const key = projectStateKey(state)
  return key === 'started' || key === 'planned'
}

function calendarSortValue(value: string | null): number {
  const parsed = parseIsoDate(value)
  if (!parsed) return Number.POSITIVE_INFINITY
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day)
}

function dueDateSortValue(project: ProjectOut): number {
  if (!isStartedState(project.state)) return Number.POSITIVE_INFINITY
  if (!project.target_date) return Number.NEGATIVE_INFINITY
  return calendarSortValue(project.target_date)
}

function dueOffsetSortValue(project: ProjectOut): number | undefined {
  if (isCompletedState(project.state)) return undefined
  const offset = dueDateOffsetWorkingDays(
    calculatedProjectDueDate(project.start_date, project.points),
    project.target_date,
  )
  return offset === null ? undefined : offset
}

/** Displayed Done percent; missing totals sort last. */
function doneSortValue(project: ProjectOut): number | undefined {
  const ratio = doneRatio(project.done_points, project.points)
  if (ratio === null || Number.isNaN(ratio)) return undefined
  return Number((ratio * 100).toFixed(DONE_PERCENT_DIGITS))
}

function ProjectDoneCell({
  done,
  total,
  state,
}: {
  done: number
  total: number
  state: string | null
}) {
  if (isPointsComplete(done, total)) {
    if (isCompletedState(state)) {
      return (
        <span className={`inline-flex justify-center ${COMPLETE_TONE}`}>
          <CheckIcon className="size-4" aria-label="Complete" />
        </span>
      )
    }
    return (
      <span className="inline-flex items-center justify-center gap-1">
        <Tooltip>
          <TooltipTrigger delay={200} className={`inline-flex ${ALERT_TONE}`}>
            <TriangleAlertIcon className="size-4" aria-label="Done but not completed" />
          </TooltipTrigger>
          <TooltipContent>Points are done but the project is not Completed</TooltipContent>
        </Tooltip>
        <span className="text-muted-foreground tabular-nums">
          ({formatPoints(done)}/{formatPoints(total)})
        </span>
      </span>
    )
  }
  const ratio = doneRatio(done, total)
  const displayed =
    ratio === null || Number.isNaN(ratio) ? null : Number((ratio * 100).toFixed(DONE_PERCENT_DIGITS))
  const percent = displayed === null ? '—' : formatPercent(ratio, DONE_PERCENT_DIGITS)
  const tone =
    displayed === null
      ? 'text-muted-foreground'
      : displayed > 100
        ? 'text-destructive'
        : 'text-amber-600 dark:text-amber-400'
  const weight = displayed !== null ? 'font-bold' : 'font-normal'
  return (
    <span className="tabular-nums">
      <span className={`${weight} ${tone}`}>{percent}</span>{' '}
      <span className="text-muted-foreground">
        ({formatPoints(done)}/{formatPoints(total)})
      </span>
    </span>
  )
}

function ProjectDueDateCell({
  targetDate,
  state,
}: {
  targetDate: string | null
  state: string | null
}) {
  const timezone = useTimezone()
  if (!isStartedState(state)) {
    return <span className="text-muted-foreground">—</span>
  }
  if (!targetDate) {
    return (
      <Tooltip>
        <TooltipTrigger delay={200} className={`inline-flex justify-center ${ALERT_TONE}`}>
          <TriangleAlertIcon className="size-4" aria-label="Due date is missing" />
        </TooltipTrigger>
        <TooltipContent>Due date is missing</TooltipContent>
      </Tooltip>
    )
  }
  const formattedDate = formatCalendarDate(targetDate)
  const chipClass =
    'inline-flex h-5 cursor-default items-center rounded-4xl px-2 text-xs font-medium'
  const daysLate = calendarDaysLate(targetDate, timezone)
  if (daysLate !== null) {
    return (
      <Tooltip>
        <TooltipTrigger
          delay={200}
          className={`${chipClass} bg-red-800 text-white dark:bg-red-900 dark:text-red-50`}
        >
          {daysLate} {daysLate === 1 ? 'day' : 'days'} late
        </TooltipTrigger>
        <TooltipContent>{formattedDate}</TooltipContent>
      </Tooltip>
    )
  }
  const daysAway = weekdaysUntil(targetDate, timezone)
  if (daysAway !== null && daysAway < 7) {
    if (daysAway === 0) {
      return (
        <Tooltip>
          <TooltipTrigger
            delay={200}
            className={`${chipClass} ${projectHealthClassName('lagging')}`}
          >
            Today
          </TooltipTrigger>
          <TooltipContent>{formattedDate}</TooltipContent>
        </Tooltip>
      )
    }
    if (daysAway === 1) {
      return (
        <Tooltip>
          <TooltipTrigger
            delay={200}
            className={`${chipClass} ${projectHealthClassName('ahead')}`}
          >
            Tomorrow
          </TooltipTrigger>
          <TooltipContent>{formattedDate}</TooltipContent>
        </Tooltip>
      )
    }
    return (
      <Tooltip>
        <TooltipTrigger delay={200}>
          In {daysAway} Days
        </TooltipTrigger>
        <TooltipContent>{formattedDate}</TooltipContent>
      </Tooltip>
    )
  }
  return <span className="tabular-nums text-muted-foreground">{formattedDate}</span>
}

function ProjectCalculatedDueCell({
  startDate,
  points,
  targetDate,
  unestimatedIssues,
  state,
}: {
  startDate: string | null
  points: number
  targetDate: string | null
  unestimatedIssues: number
  state: string | null
}) {
  if (isCompletedState(state)) {
    return (
      <Tooltip>
        <TooltipTrigger delay={200} className="cursor-default text-muted-foreground">
          —
        </TooltipTrigger>
        <TooltipContent>Not calculated for completed projects</TooltipContent>
      </Tooltip>
    )
  }
  const due = calculatedProjectDueDate(startDate, points)
  if (!due || !startDate) {
    return <span className="text-muted-foreground">—</span>
  }
  const offset = dueDateOffsetWorkingDays(due, targetDate)
  const workingDays = workingDaysForPoints(points)
  const tone = offset === null ? 'text-muted-foreground' : calculatedDueTone(offset)
  const explanation = offset === null ? null : calculatedDueExplanation(offset)
  return (
    <Tooltip>
      <TooltipTrigger delay={200} className={`cursor-default tabular-nums font-medium ${tone}`}>
        {offset === null ? formatCalendarDate(due) : formatWorkingDayOffset(offset)}
      </TooltipTrigger>
      <TooltipContent>
        <span className="block">Calculated Due Date</span>
        <span className="block font-medium tabular-nums">{formatCalendarDate(due)}</span>
        <span className="mt-0.5 block text-background/70">
          {formatCalendarDate(startDate)} + {formatPoints(workingDays)} working{' '}
          {workingDays === 1 ? 'day' : 'days'} ({formatPoints(points)} pts ÷{' '}
          {formatPoints(DEFAULT_POINTS_PER_DAY)})
        </span>
        {offset !== null && targetDate ? (
          <span className="block text-background/70">
            Due {formatCalendarDate(targetDate)} {offset >= 0 ? '+' : '−'}{' '}
            {Math.abs(offset)} working {Math.abs(offset) === 1 ? 'day' : 'days'}
          </span>
        ) : (
          <span className="block text-background/70">No due date to compare</span>
        )}
        {explanation ? <span className="mt-0.5 block">{explanation}</span> : null}
        {unestimatedIssues > 0 ? (
          <span className="mt-0.5 block text-background/70">
            {unestimatedIssues} unestimated{' '}
            {unestimatedIssues === 1 ? 'issue is' : 'issues are'} not included
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ProjectHealthCell({
  health,
  expectedDonePoints,
  points,
  workingDaysLeft,
  state,
}: {
  health: ProjectOut['health']
  expectedDonePoints: number | null
  points: number
  workingDaysLeft: number | null
  state: string | null
}) {
  if (isCompletedState(state)) {
    return <span className="text-muted-foreground">—</span>
  }
  if (!health) {
    return (
      <Tooltip>
        <TooltipTrigger delay={200} className="cursor-default text-muted-foreground">
          —
        </TooltipTrigger>
        <TooltipContent>No target date</TooltipContent>
      </Tooltip>
    )
  }
  const label = formatProjectHealth(health)
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        className={`inline-flex h-5 cursor-default items-center rounded-4xl px-2 text-xs font-medium ${projectHealthClassName(health)}`}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent>
        <span className="block">Expected Points to be Done</span>
        <span className="block font-medium tabular-nums">{formatPoints(expectedDonePoints)}</span>
        <span className="mt-0.5 block text-background/70">
          {formatPoints(points)} − {formatPoints(workingDaysLeft)} days ×{' '}
          {formatPoints(DEFAULT_POINTS_PER_DAY)}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function ProjectRowMenu({
  excluded,
  onToggleExcluded,
}: {
  excluded: boolean
  onToggleExcluded: () => void
}) {
  return (
    <div
      className="shrink-0"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={buttonVariants({ variant: 'ghost', size: 'icon-xs' })}
          aria-label="Project actions"
        >
          <EllipsisVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={onToggleExcluded}>
            {excluded ? 'Include' : 'Exclude'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function createColumns(
  onToggleExcluded: (project: ProjectOut) => void,
): AppColumnDef<ProjectOut>[] {
  return [
    helper.accessor('name', {
      header: 'Project',
      meta: { className: 'w-[33%] max-w-[33%] overflow-hidden' },
      cell: (ctx) => {
        const project = ctx.row.original
        return (
          <div className="flex min-w-0 items-center gap-1">
            <ProjectRowMenu
              excluded={project.excluded}
              onToggleExcluded={() => onToggleExcluded(project)}
            />
            <span className="min-w-0 flex-1 truncate font-medium" title={ctx.getValue()}>
              {ctx.getValue()}
            </span>
          </div>
        )
      },
    }),
    helper.accessor('state', {
      header: 'State',
      cell: (ctx) => {
        const project = ctx.row.original
        const value = project.excluded ? EXCLUDED_PROJECT_STATE : ctx.getValue()
        if (!value) {
          return <span className="text-muted-foreground">{formatProjectState(value)}</span>
        }
        return <Badge variant={badgeVariantForState(value)}>{formatProjectState(value)}</Badge>
      },
    }),
    helper.accessor((row) => calendarSortValue(row.start_date), {
      id: 'start_date',
      header: 'Start Date',
      cell: (ctx) => {
        const project = ctx.row.original
        const startDate = project.start_date
        if (!startDate) {
          if (!expectsStartDate(project.state)) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <Tooltip>
              <TooltipTrigger
                delay={200}
                className={`inline-flex justify-center ${MISSING_START_TONE}`}
              >
                <TriangleAlertIcon className="size-4" aria-label="Start date is missing" />
              </TooltipTrigger>
              <TooltipContent>Start date is missing</TooltipContent>
            </Tooltip>
          )
        }
        return (
          <span className="tabular-nums text-muted-foreground">
            {formatCalendarDate(startDate)}
          </span>
        )
      },
    }),
    helper.accessor((row) => dueDateSortValue(row), {
      id: 'due_date',
      header: 'Due Date',
      cell: (ctx) => (
        <ProjectDueDateCell
          targetDate={ctx.row.original.target_date}
          state={ctx.row.original.state}
        />
      ),
    }),
    helper.accessor((row) => dueOffsetSortValue(row), {
      id: 'calculated_due_date',
      header: 'Calculated Due',
      sortUndefined: 'last',
      cell: (ctx) => (
        <ProjectCalculatedDueCell
          startDate={ctx.row.original.start_date}
          points={ctx.row.original.points}
          targetDate={ctx.row.original.target_date}
          unestimatedIssues={ctx.row.original.unestimated_issues}
          state={ctx.row.original.state}
        />
      ),
    }),
    helper.accessor('unestimated_issues', {
      header: 'Unestimated Issues',
      cell: (ctx) => <span className="tabular-nums">{ctx.getValue()}</span>,
    }),
    helper.accessor('points', {
      header: 'Points',
      cell: (ctx) => <span className="tabular-nums">{formatPoints(ctx.getValue())}</span>,
    }),
    helper.accessor((row) => doneSortValue(row), {
      id: 'done_points',
      header: 'Done',
      sortUndefined: 'last',
      cell: (ctx) => (
        <ProjectDoneCell
          done={ctx.row.original.done_points}
          total={ctx.row.original.points}
          state={ctx.row.original.state}
        />
      ),
    }),
    helper.accessor((row) => projectHealthSortRank(row), {
      id: 'health',
      header: 'Health',
      cell: (ctx) => {
        const project = ctx.row.original
        return (
          <ProjectHealthCell
            health={project.health}
            expectedDonePoints={project.expected_done_points}
            points={project.points}
            workingDaysLeft={project.working_days_left}
            state={project.state}
          />
        )
      },
    }),
  ]
}

export function ProjectsTable({
  projects,
  selectedProjectId,
  onSelect,
  onToggleExcluded,
  emptyMessage = 'Refresh this team to load projects.',
}: {
  projects: ProjectOut[]
  selectedProjectId: number | null
  onSelect: (project: ProjectOut) => void
  onToggleExcluded: (project: ProjectOut) => void
  emptyMessage?: string
}) {
  const columns = useMemo(() => createColumns(onToggleExcluded), [onToggleExcluded])
  return (
    <TooltipProvider>
      <DataTable
        columns={columns}
        data={projects}
        centerExcept={['name']}
        emptyMessage={emptyMessage}
        onRowClick={onSelect}
        isRowSelected={(row) => row.id === selectedProjectId}
      />
    </TooltipProvider>
  )
}

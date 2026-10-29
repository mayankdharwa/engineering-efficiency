import { useMemo, useState } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useCycleSettings } from '../hooks/useCycleSettings'
import { durationExceedsManDays } from '../lib/projectSchedule'
import { DEFAULT_PROJECT_STATES, filterProjectsByState } from '../lib/projectState'
import type { Scope } from '../lib/scope'
import type { ProjectOut } from '../types'
import { ProjectSpanChart } from './ProjectSpanChart'
import { ProjectStateFilter } from './ProjectStateFilter'

/** Duration vs man-day bars, with its own state filter and duration toggle. */
export function ProjectSpanSection({
  projects,
  scope,
}: {
  projects: ProjectOut[]
  scope: Scope | null
}) {
  const cycleQuery = useCycleSettings(scope)
  const [states, setStates] = useState<Set<string>>(() => new Set(DEFAULT_PROJECT_STATES))
  const [durationExceeds, setDurationExceeds] = useState(false)

  const filtered = useMemo(
    () =>
      filterProjectsByState(projects, states).filter(
        (project) =>
          !durationExceeds ||
          durationExceedsManDays(project.start_date, project.target_date, project.points),
      ),
    [projects, states, durationExceeds],
  )
  const members = (cycleQuery.data?.members ?? []).map((member) => ({
    name: member.name,
    groupId: member.group_id,
  }))
  const groups = cycleQuery.data?.groups ?? []

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Project Duration vs Man Day Consumption</CardTitle>
        <CardDescription>
          Project Duration is the gray bar: weekdays from the start date
          through the end date. Man Days is the outlined bar on top, grouped
          by team. White is points with no team. The number after each bar is
          the gap between duration and man days. A check after that number
          means the project is completed. Projects missing either date are
          left out.
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Label
              htmlFor="span-duration-exceeds"
              className="font-normal text-muted-foreground"
            >
              <Checkbox
                id="span-duration-exceeds"
                checked={durationExceeds}
                onCheckedChange={(checked) => setDurationExceeds(checked === true)}
              />
              Duration exceeds man days
            </Label>
            <div className="w-52">
              <ProjectStateFilter
                id="span-state-filter"
                selected={states}
                onChange={setStates}
              />
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-4">
        {cycleQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <ProjectSpanChart projects={filtered} members={members} groups={groups} />
        )}
      </CardContent>
    </Card>
  )
}

import { useMemo, useState } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DEFAULT_PROJECT_STATES, filterProjectsByState } from '../lib/projectState'
import type { ProjectOut } from '../types'
import { ProjectDueDateTrajectory } from './ProjectDueDateTrajectory'
import { ProjectStateFilter } from './ProjectStateFilter'

/** Due-date trajectory bars, with its own state filter. */
export function ProjectTrajectorySection({ projects }: { projects: ProjectOut[] }) {
  const [states, setStates] = useState<Set<string>>(() => new Set(DEFAULT_PROJECT_STATES))
  const filtered = useMemo(() => filterProjectsByState(projects, states), [projects, states])

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Due date trajectory</CardTitle>
        <CardDescription>
          Each bar runs from the start date to the due dates. Green is the
          start through the first due date and amber is each later change; the
          bar ends at the current due date. A black dotted line marks a due
          date that was later pulled earlier, or one set before the project
          started, so a superseded plan is not mistaken for the finish. S is
          the start, D is the current due date, and open dots are earlier due
          dates. A check beside D means the project is completed.
        </CardDescription>
        <CardAction>
          <div className="w-52">
            <ProjectStateFilter
              id="trajectory-state-filter"
              selected={states}
              onChange={setStates}
            />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ProjectDueDateTrajectory projects={filtered} />
      </CardContent>
    </Card>
  )
}

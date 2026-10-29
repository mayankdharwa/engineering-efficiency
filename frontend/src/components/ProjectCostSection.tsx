import { useMemo, useState } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DEFAULT_PROJECT_STATES, filterProjectsByState } from '../lib/projectState'
import type { ProjectOut } from '../types'
import { ProjectCostChart } from './ProjectCostChart'
import { ProjectStateFilter } from './ProjectStateFilter'

/** Per-project cost bars, with its own state filter. */
export function ProjectCostSection({ projects }: { projects: ProjectOut[] }) {
  const [states, setStates] = useState<Set<string>>(() => new Set(DEFAULT_PROJECT_STATES))
  const filtered = useMemo(
    () =>
      filterProjectsByState(projects, states).filter((project) => !project.excluded),
    [projects, states],
  )

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Project costs</CardTitle>
        <CardAction>
          <div className="w-52">
            <ProjectStateFilter
              id="cost-state-filter"
              selected={states}
              onChange={setStates}
            />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ProjectCostChart projects={filtered} />
      </CardContent>
    </Card>
  )
}

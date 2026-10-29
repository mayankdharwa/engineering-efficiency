import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ProjectOut } from '../types'
import { ProjectStateFilter } from './ProjectStateFilter'
import { ProjectsTable } from './ProjectsTable'

interface ProjectDetailsSectionProps {
  /** The projects to list (already filtered by the caller). */
  projects: ProjectOut[]
  selectedStates: Set<string>
  onSelectedStatesChange: (next: Set<string>) => void
  selectedProjectId: number | null
  onSelect: (project: ProjectOut) => void
  onToggleExcluded: (project: ProjectOut) => void
  onSyncProject?: (project: ProjectOut) => void
}

/** State-filtered project table. */
export function ProjectDetailsSection({
  projects,
  selectedStates,
  onSelectedStatesChange,
  selectedProjectId,
  onSelect,
  onToggleExcluded,
  onSyncProject,
}: ProjectDetailsSectionProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Project details</CardTitle>
        <CardAction>
          <div className="w-52">
            <ProjectStateFilter selected={selectedStates} onChange={onSelectedStatesChange} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ProjectsTable
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={onSelect}
          onToggleExcluded={onToggleExcluded}
          onSyncProject={onSyncProject}
          emptyMessage={
            projects.length === 0 ? 'No projects match the current state filter.' : undefined
          }
        />
      </CardContent>
    </Card>
  )
}

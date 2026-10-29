import { useState } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatMoney, formatPoints } from '../lib/format'
import type { ProjectOut } from '../types'
import { IssuesTable } from './IssuesTable'

/** Issues for the selected project, with its own show-done toggle. */
export function ProjectDetailCard({ project }: { project: ProjectOut }) {
  const [showDone, setShowDone] = useState(true)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{project.name}</CardTitle>
        <CardDescription>
          {formatPoints(project.points)} pts · {formatMoney(project.cost, project.currency)}
          {project.unestimated_issues > 0
            ? ` · ${project.unestimated_issues} unestimated`
            : null}
        </CardDescription>
        <CardAction>
          <Label className="font-normal text-muted-foreground">
            Show done
            <Switch checked={showDone} onCheckedChange={setShowDone} />
          </Label>
        </CardAction>
      </CardHeader>
      <CardContent>
        <IssuesTable
          issues={project.issues}
          showDone={showDone}
          showProject={false}
          emptyMessage="No issues in this project."
        />
      </CardContent>
    </Card>
  )
}

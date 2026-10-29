import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCycleSettings } from '../hooks/useCycleSettings'
import type { Scope } from '../lib/scope'
import type { ProjectOut } from '../types'
import { PersonLoadChart } from './PersonLoadChart'

/** Load per counted person on the current cycle. */
export function PersonLoadSection({
  projects,
  scope,
}: {
  projects: ProjectOut[]
  scope: Scope | null
}) {
  const cycleQuery = useCycleSettings(scope)
  const groups = cycleQuery.data?.groups ?? []
  const countedPeople = (cycleQuery.data?.members ?? [])
    .filter((member) => member.counts_toward_capacity)
    .map((member) => ({
      name: member.name,
      groupName: member.group_name,
      groupColor:
        member.group_id == null
          ? null
          : (groups.find((group) => group.id === member.group_id)?.color ?? null),
    }))

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Who is on what</CardTitle>
        <CardDescription>
          Counted people on the current cycle. The filled part of each bar
          is points already done. The lighter part is still open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cycleQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : cycleQuery.isError ? (
          <p className="text-sm text-destructive">{cycleQuery.error.message}</p>
        ) : (
          <PersonLoadChart projects={projects} countedPeople={countedPeople} />
        )}
      </CardContent>
    </Card>
  )
}

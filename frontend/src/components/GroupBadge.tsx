import { Badge } from '@/components/ui/badge'

/** Small pill for a member's group name. */
export function GroupBadge({ name }: { name: string | null | undefined }) {
  if (!name) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Unassigned
      </Badge>
    )
  }
  return <Badge variant="secondary">{name}</Badge>
}

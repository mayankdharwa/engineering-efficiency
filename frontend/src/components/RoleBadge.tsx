import { Badge } from '@/components/ui/badge'

/** Small pill for a member's DEV/QA tag. Both roles share one colour. */
export function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Not set
      </Badge>
    )
  }
  return <Badge variant="secondary">{role}</Badge>
}

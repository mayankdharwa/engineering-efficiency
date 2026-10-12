import { Badge } from '@/components/ui/badge'
import { contrastText, parseHexColor } from '../lib/color'

/** Small pill for a member's group name, filled with the configured colour. */
export function GroupBadge({
  name,
  color,
}: {
  name: string | null | undefined
  color?: string | null
}) {
  if (!name) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Unassigned
      </Badge>
    )
  }
  const hex = parseHexColor(color)
  if (!hex) {
    return <Badge variant="secondary">{name}</Badge>
  }
  return (
    <Badge
      variant="secondary"
      className="border-transparent"
      style={{ backgroundColor: hex, color: contrastText(hex) }}
    >
      {name}
    </Badge>
  )
}

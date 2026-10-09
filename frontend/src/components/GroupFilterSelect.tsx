import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ALL_GROUPS_KEY, UNASSIGNED_KEY } from '../lib/groups'
import type { GroupOut } from '../types'

interface GroupFilterSelectProps {
  groups: GroupOut[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

/**
 * Multi-select group filter. An empty selection means "All groups"; the
 * "All groups" item shows as selected in that case and clears the filter when
 * chosen from a specific selection.
 */
export function GroupFilterSelect({ groups, selected, onChange }: GroupFilterSelectProps) {
  const allActive = selected.size === 0
  const items = [
    { label: 'All groups', value: ALL_GROUPS_KEY },
    ...groups.map((group) => ({ label: group.name, value: String(group.id) })),
    { label: 'Unassigned', value: UNASSIGNED_KEY },
  ]
  const value = allActive ? [ALL_GROUPS_KEY] : [...selected]

  function handleChange(next: string[]) {
    if (next.includes(ALL_GROUPS_KEY)) {
      // "All" was already active and specific groups were added -> keep those.
      // Otherwise the user picked "All" from a specific filter -> clear.
      onChange(allActive ? new Set(next.filter((key) => key !== ALL_GROUPS_KEY)) : new Set())
      return
    }
    onChange(new Set(next))
  }

  const labelFor = (key: string) =>
    key === UNASSIGNED_KEY
      ? 'Unassigned'
      : (groups.find((group) => String(group.id) === key)?.name ?? key)

  return (
    <Select multiple items={items} value={value} onValueChange={handleChange}>
      <SelectTrigger id="group-filter" className="w-full" aria-label="Group">
        <SelectValue>
          {(value) => {
            const keys = Array.isArray(value)
              ? (value as string[])
              : value
                ? [String(value)]
                : []
            const specific = keys.filter((key) => key !== ALL_GROUPS_KEY)
            if (specific.length === 0) return 'All groups'
            if (specific.length === 1) return labelFor(specific[0])
            return `${specific.length} groups`
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

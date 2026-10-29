import { ALL_GROUPS_KEY, UNASSIGNED_KEY } from '../lib/groups'
import type { GroupOut } from '../types'
import { GroupBadge } from './GroupBadge'
import { MultiSelectFilter } from './MultiSelectFilter'

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
  const groupFor = (key: string) => groups.find((group) => String(group.id) === key)

  return (
    <MultiSelectFilter
      id="group-filter"
      ariaLabel="Group"
      allKey={ALL_GROUPS_KEY}
      allLabel="All groups"
      options={[
        ...groups.map((group) => ({
          label: group.name,
          value: String(group.id),
          content: <GroupBadge name={group.name} color={group.color} />,
        })),
        { label: 'Unassigned', value: UNASSIGNED_KEY },
      ]}
      selected={selected}
      onChange={onChange}
      summarize={(specific) => {
        if (specific.length === 1) {
          const key = specific[0]
          const group = groupFor(key)
          if (group) return <GroupBadge name={group.name} color={group.color} />
          return key === UNASSIGNED_KEY ? 'Unassigned' : key
        }
        return `${specific.length} groups`
      }}
    />
  )
}

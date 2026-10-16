import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALL_PROJECT_STATES_KEY,
  EXCLUDED_PROJECT_STATE,
  PROJECT_STATES,
  UNKNOWN_PROJECT_STATE,
  formatProjectState,
  isAllProjectStates,
} from '../lib/projectState'

const STATE_OPTIONS = [...PROJECT_STATES, EXCLUDED_PROJECT_STATE, UNKNOWN_PROJECT_STATE] as const

interface ProjectStateFilterProps {
  selected: Set<string>
  onChange: (next: Set<string>) => void
  id?: string
}

/**
 * Multi-select project-state filter. An empty selection means "All states";
 * the "All states" item shows as selected in that case and clears the filter
 * when chosen from a specific selection.
 */
export function ProjectStateFilter({
  selected,
  onChange,
  id = 'project-state-filter',
}: ProjectStateFilterProps) {
  const allActive = isAllProjectStates(selected)
  const items = [
    { label: 'All states', value: ALL_PROJECT_STATES_KEY },
    ...STATE_OPTIONS.map((state) => ({
      label: formatProjectState(state),
      value: state,
    })),
  ]
  const value = allActive ? [ALL_PROJECT_STATES_KEY] : [...selected]

  function handleChange(next: string[]) {
    if (next.includes(ALL_PROJECT_STATES_KEY)) {
      onChange(allActive ? new Set(next.filter((key) => key !== ALL_PROJECT_STATES_KEY)) : new Set())
      return
    }
    onChange(new Set(next))
  }

  return (
    <Select multiple items={items} value={value} onValueChange={handleChange}>
      <SelectTrigger id={id} className="w-full" aria-label="State">
        <SelectValue>
          {(current) => {
            const keys = Array.isArray(current)
              ? (current as string[])
              : current
                ? [String(current)]
                : []
            const specific = keys.filter((key) => key !== ALL_PROJECT_STATES_KEY)
            if (specific.length === 0) return 'All states'
            if (specific.length <= 2) {
              return specific.map((key) => formatProjectState(key)).join(', ')
            }
            return `${specific.length} states`
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

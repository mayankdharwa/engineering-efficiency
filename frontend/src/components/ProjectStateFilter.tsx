import {
  ALL_PROJECT_STATES_KEY,
  EXCLUDED_PROJECT_STATE,
  PROJECT_STATES,
  UNKNOWN_PROJECT_STATE,
  formatProjectState,
} from '../lib/projectState'
import { MultiSelectFilter } from './MultiSelectFilter'

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
  return (
    <MultiSelectFilter
      id={id}
      ariaLabel="State"
      allKey={ALL_PROJECT_STATES_KEY}
      allLabel="All states"
      options={STATE_OPTIONS.map((state) => ({
        label: formatProjectState(state),
        value: state,
      }))}
      selected={selected}
      onChange={onChange}
      summarize={(specific) =>
        specific.length <= 2
          ? specific.map((key) => formatProjectState(key)).join(', ')
          : `${specific.length} states`
      }
    />
  )
}

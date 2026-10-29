import type { TeamOut } from '../types'
import { OptionSelect } from './OptionSelect'

/** Presentational team Select with `name (key)` labels. */
export function TeamPicker({
  teams,
  value,
  onChange,
  id,
  'aria-label': ariaLabel,
  placeholder = 'Select a team',
}: {
  teams: TeamOut[]
  value: number | null
  onChange: (teamId: number | null) => void
  id?: string
  'aria-label'?: string
  placeholder?: string
}) {
  return (
    <OptionSelect
      items={teams.map((team) => ({
        label: `${team.name} (${team.key})`,
        value: team.id,
      }))}
      value={value}
      onValueChange={onChange}
      id={id}
      className="w-full"
      aria-label={ariaLabel}
      placeholder={placeholder}
    />
  )
}

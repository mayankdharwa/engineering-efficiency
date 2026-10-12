import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TeamOut } from '../types'

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
    <Select
      items={teams.map((team) => ({
        label: `${team.name} (${team.key})`,
        value: team.id,
      }))}
      value={value}
      onValueChange={(next) => onChange(next as number | null)}
    >
      <SelectTrigger id={id} className="w-full" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {teams.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name} ({team.key})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

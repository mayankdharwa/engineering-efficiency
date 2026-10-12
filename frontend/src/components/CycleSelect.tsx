import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCycle } from '../lib/format'
import type { CycleOut } from '../types'

function cycleLabel(cycle: CycleOut): string {
  const name = formatCycle(cycle.name, cycle.number)
  if (cycle.is_current) return `${name} (current)`
  if (cycle.archived_at) return `${name} (finalized)`
  return name
}

/** Cycle picker used on the dashboard and Cycle Configuration. */
export function CycleSelect({
  cycles,
  value,
  onChange,
  disabled = false,
  labelled = true,
}: {
  cycles: CycleOut[]
  value: number | null
  onChange: (cycleId: number | null) => void
  disabled?: boolean
  labelled?: boolean
}) {
  if (cycles.length === 0) {
    return labelled ? (
      <p className="text-sm text-muted-foreground">No cycles stored for this team yet.</p>
    ) : null
  }

  return (
    <div className={labelled ? 'max-w-xs space-y-2' : 'w-56 shrink-0 sm:w-64'}>
      {labelled ? <Label htmlFor="cycle-select">Cycle</Label> : null}
      <Select
        items={cycles.map((cycle) => ({
          label: cycleLabel(cycle),
          value: cycle.id,
        }))}
        value={value}
        onValueChange={(next) => onChange(next as number | null)}
      >
        <SelectTrigger
          id="cycle-select"
          className="w-full"
          aria-label="Cycle"
          disabled={disabled}
        >
          <SelectValue placeholder="Select a cycle" />
        </SelectTrigger>
        <SelectContent>
          {cycles.map((cycle) => (
            <SelectItem key={cycle.id} value={cycle.id}>
              {cycleLabel(cycle)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

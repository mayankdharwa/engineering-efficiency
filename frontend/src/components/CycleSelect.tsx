import { Label } from '@/components/ui/label'
import { formatCycle } from '../lib/format'
import type { CycleOut } from '../types'
import { OptionSelect } from './OptionSelect'

function cycleLabel(cycle: CycleOut): string {
  const name = formatCycle(cycle.name, cycle.number)
  if (cycle.is_current) return `${name} (current)`
  if (cycle.archived_at) return `${name} (finalized)`
  return name
}

/** Cycle picker used on Cycles and Cycle Configuration. */
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
      <p className="text-sm text-muted-foreground">No cycles yet.</p>
    ) : null
  }

  return (
    <div className={labelled ? 'max-w-xs space-y-2' : 'w-56 shrink-0 sm:w-64'}>
      {labelled ? <Label htmlFor="cycle-select">Cycle</Label> : null}
      <OptionSelect
        items={cycles.map((cycle) => ({
          label: cycleLabel(cycle),
          value: cycle.id,
        }))}
        value={value}
        onValueChange={onChange}
        id="cycle-select"
        className="w-full"
        aria-label="Cycle"
        placeholder="Select a cycle"
        disabled={disabled}
      />
    </div>
  )
}

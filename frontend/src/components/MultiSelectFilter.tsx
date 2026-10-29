import type { ReactNode } from 'react'
import type { FilterSelection } from '../lib/filterSelection'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface MultiSelectOption {
  /** Plain-text label, also used for the trigger summary fallback. */
  label: string
  value: string
  /** Rich option row content; defaults to `label`. */
  content?: ReactNode
}

interface MultiSelectFilterProps {
  id: string
  ariaLabel: string
  /** Sentinel value for the "all" entry; an empty selection means all. */
  allKey: string
  allLabel: string
  options: MultiSelectOption[]
  selected: FilterSelection
  onChange: (next: Set<string>) => void
  /** Trigger summary for a non-empty specific selection. */
  summarize: (specific: string[]) => ReactNode
}

/**
 * Multi-select filter whose "all" item clears the selection. An empty
 * `selected` set reads as "all"; picking a group keeps the other picks.
 */
export function MultiSelectFilter({
  id,
  ariaLabel,
  allKey,
  allLabel,
  options,
  selected,
  onChange,
  summarize,
}: MultiSelectFilterProps) {
  const allActive = selected.size === 0
  const items = [
    { label: allLabel, value: allKey, content: allLabel },
    ...options.map((option) => ({ ...option, content: option.content ?? option.label })),
  ]
  const value = allActive ? [allKey] : [...selected]

  function handleChange(next: string[]) {
    if (next.includes(allKey)) {
      // "All" was already active and specific options were added -> keep those.
      // Otherwise the user picked "All" from a specific filter -> clear.
      onChange(allActive ? new Set(next.filter((key) => key !== allKey)) : new Set())
      return
    }
    onChange(new Set(next))
  }

  return (
    <Select multiple items={items} value={value} onValueChange={handleChange}>
      <SelectTrigger id={id} className="w-full" aria-label={ariaLabel}>
        <SelectValue>
          {(current) => {
            const keys = Array.isArray(current)
              ? (current as string[])
              : current
                ? [String(current)]
                : []
            const specific = keys.filter((key) => key !== allKey)
            if (specific.length === 0) return allLabel
            return summarize(specific)
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.content}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

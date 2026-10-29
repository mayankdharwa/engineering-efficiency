import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Option<Value> {
  label: ReactNode
  value: Value
}

/**
 * Single-select dropdown that renders its `items` as `SelectItem`s, so callers
 * assemble the option list once instead of for both `items` and the content.
 */
export function OptionSelect<Value extends string | number>({
  items,
  value,
  onValueChange,
  id,
  className,
  placeholder,
  size,
  disabled,
  'aria-label': ariaLabel,
}: {
  items: readonly Option<Value>[]
  value: Value | null
  onValueChange: (value: Value) => void
  id?: string
  className?: string
  placeholder?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <SelectValue placeholder={placeholder} />
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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PROJECT_RANGE_OPTIONS,
  isProjectRangeMonths,
  type ProjectRangeMonths,
} from '../lib/projectRange'

/** Chooses how far back completed projects are loaded for the projects page. */
export function ProjectRangeSelect({
  value,
  onChange,
}: {
  value: ProjectRangeMonths
  onChange: (months: ProjectRangeMonths) => void
}) {
  return (
    <div className="w-48 shrink-0">
      <Select
        items={PROJECT_RANGE_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        value={value}
        onValueChange={(next) => {
          if (typeof next === 'number' && isProjectRangeMonths(next)) onChange(next)
        }}
      >
        <SelectTrigger id="project-range" className="w-full" aria-label="Project range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROJECT_RANGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

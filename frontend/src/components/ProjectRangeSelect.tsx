import {
  PROJECT_RANGE_OPTIONS,
  type ProjectRangeMonths,
} from '../lib/projectRange'
import { OptionSelect } from './OptionSelect'

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
      <OptionSelect
        items={PROJECT_RANGE_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        }))}
        value={value}
        onValueChange={onChange}
        id="project-range"
        className="w-full"
        aria-label="Project range"
      />
    </div>
  )
}

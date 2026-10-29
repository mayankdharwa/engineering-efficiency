/**
 * A multi-select filter whose keys are strings: real ids plus local buckets
 * such as "unassigned". An empty selection means everything is selected.
 */
export type FilterSelection = ReadonlySet<string>

/** True when the selection is empty, i.e. "all". */
export function isAllSelected(selected: FilterSelection): boolean {
  return selected.size === 0
}

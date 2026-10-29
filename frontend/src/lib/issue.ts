/** The minimal issue fields the effort and load calculators need. */
export interface IssueLite {
  assigneeName: string | null
  stateType: string | null
  estimate: number | null
}

/** Narrow a full issue (snake_case API shape) to the calculator fields. */
export function toIssueLite(issue: {
  assignee_name: string | null
  state_type: string | null
  estimate: number | null
}): IssueLite {
  return {
    assigneeName: issue.assignee_name,
    stateType: issue.state_type,
    estimate: issue.estimate,
  }
}

export const LinearStateType = {
  completed: 'completed',
  started: 'started',
  canceled: 'canceled',
} as const

export type LinearStateType = (typeof LinearStateType)[keyof typeof LinearStateType]

export function isCompletedState(stateType: string | null): boolean {
  return stateType === LinearStateType.completed
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

export function badgeVariantForState(stateType: string | null): BadgeVariant {
  switch (stateType) {
    case LinearStateType.completed:
      return 'default'
    case LinearStateType.started:
      return 'secondary'
    case LinearStateType.canceled:
      return 'destructive'
    default:
      return 'outline'
  }
}

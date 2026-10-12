import type { ReactNode } from 'react'

/**
 * Shared loading → error → not-ready → ready body used by configuration panels.
 */
export function QueryPanelBody({
  isLoading,
  isError,
  error,
  ready = true,
  notReadyMessage,
  skeleton,
  children,
}: {
  isLoading: boolean
  isError: boolean
  error?: Error | null
  ready?: boolean
  notReadyMessage?: ReactNode
  skeleton: ReactNode
  children: ReactNode
}) {
  if (isLoading) return skeleton
  if (isError) {
    return <p className="text-sm text-destructive">{error?.message}</p>
  }
  if (!ready) {
    return <p className="text-sm text-muted-foreground">{notReadyMessage}</p>
  }
  return children
}

import { tableFeatures } from '@tanstack/react-table'

/**
 * Shared TanStack Table v9 feature set.
 *
 * Kept at module scope so column definitions and `useTable` calls across the
 * app share one stable reference (required for table model caching).
 */
export const appTableFeatures = tableFeatures({})

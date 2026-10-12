import { toast } from '@/components/ui/toast'

const DISMISS_MS = 4000

/** Brief success toast for configuration mutations. */
export function notifySuccess(title: string) {
  toast.add({ type: 'success', title, timeout: DISMISS_MS })
}

/** Brief error toast for failed configuration mutations. */
export function notifyError(title: string) {
  toast.add({ type: 'error', title, timeout: DISMISS_MS })
}

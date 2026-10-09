import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { APP_SETTINGS_QUERY_KEY, useAppSettings } from '../hooks/useAppSettings'

/** Format a 0-23 hour as a localized time label (e.g. "7:00 PM"). */
function formatHour(hour: number): string {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** IANA timezone names, always including UTC and the currently saved value. */
function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : []
  const options = new Set<string>(supported)
  options.add('UTC')
  if (current) options.add(current)
  return Array.from(options).sort()
}

export function MetricSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useAppSettings()
  const [timezone, setTimezone] = useState('UTC')
  const [cutoffHour, setCutoffHour] = useState(19)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  )

  useEffect(() => {
    const data = settingsQuery.data
    if (!data) return
    setTimezone(data.timezone)
    setCutoffHour(data.day_cutoff_hour)
  }, [settingsQuery.data])

  const zones = useMemo(() => timezoneOptions(timezone), [timezone])
  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), [])

  const saveMutation = useMutation({
    mutationFn: () => api.updateSettings({ timezone, day_cutoff_hour: cutoffHour }),
    onSuccess: (data) => {
      setFeedback({ type: 'success', message: 'Timing settings saved.' })
      setTimezone(data.timezone)
      setCutoffHour(data.day_cutoff_hour)
      queryClient.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Metrics timing</CardTitle>
        <CardDescription>
          The working timezone and the local hour after which the current day counts as elapsed.
          Until that hour passes, a partial day is not counted, so velocity isn&apos;t measured
          against work that hasn&apos;t happened yet.
        </CardDescription>
        {settingsQuery.data && (
          <CardAction>
            <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="gap-4">
        {settingsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-9 w-full max-w-xs" />
          </div>
        ) : settingsQuery.isError ? (
          <p className="text-sm text-destructive">{settingsQuery.error.message}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="metrics-timezone">Working timezone</Label>
                <Select
                  items={zones.map((zone) => ({ label: zone, value: zone }))}
                  value={timezone}
                  onValueChange={(value) => {
                    setFeedback(null)
                    setTimezone(value as string)
                  }}
                >
                  <SelectTrigger id="metrics-timezone" className="w-full max-w-md">
                    <SelectValue placeholder="Select a timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="metrics-cutoff">Day counts as elapsed after</Label>
                <Select
                  items={hours.map((hour) => ({
                    label: formatHour(hour),
                    value: hour,
                  }))}
                  value={cutoffHour}
                  onValueChange={(value) => {
                    setFeedback(null)
                    setCutoffHour(value as number)
                  }}
                >
                  <SelectTrigger id="metrics-cutoff" className="w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hours.map((hour) => (
                      <SelectItem key={hour} value={hour}>
                        {formatHour(hour)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {feedback && (
              <p
                className={
                  feedback.type === 'error'
                    ? 'text-sm text-destructive'
                    : 'text-sm text-muted-foreground'
                }
              >
                {feedback.message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

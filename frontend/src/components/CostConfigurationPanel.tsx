import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { useConfigTeam } from '../hooks/useConfigTeam'

/** Currency symbols the app can display, with their names for the dropdown. */
const CURRENCIES = [
  { value: '€', label: '€ Euro' },
  { value: '$', label: '$ Dollar' },
  { value: '₹', label: '₹ INR' },
]

interface Feedback {
  type: 'success' | 'error'
  message: string
}

/** Per-team cost configuration: currency symbol and man-day cost. */
export function CostConfigurationPanel() {
  const queryClient = useQueryClient()
  const { teamId } = useConfigTeam()

  const [currency, setCurrency] = useState('$')
  const [manDayCost, setManDayCost] = useState('0')
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const costQuery = useQuery({
    queryKey: ['team-cost', teamId],
    queryFn: () => api.getTeamCost(teamId as number),
    enabled: teamId !== null,
  })

  useEffect(() => {
    const data = costQuery.data
    if (!data) return
    setCurrency(data.currency)
    setManDayCost(String(data.man_day_cost))
  }, [costQuery.data])

  const saveMutation = useMutation({
    mutationFn: (payload: { currency: string; man_day_cost: number }) =>
      api.updateTeamCost(teamId as number, payload),
    onSuccess: (data) => {
      setFeedback({ type: 'success', message: 'Cost configuration saved.' })
      setCurrency(data.currency)
      setManDayCost(String(data.man_day_cost))
      queryClient.invalidateQueries({ queryKey: ['team-cost', teamId] })
      queryClient.invalidateQueries({ queryKey: ['stats', teamId] })
    },
    onError: (error: Error) => setFeedback({ type: 'error', message: error.message }),
  })

  function handleSave() {
    const value = Number(manDayCost)
    if (!Number.isInteger(value) || value < 0) {
      setFeedback({ type: 'error', message: 'Man day cost must be a whole number of 0 or more.' })
      return
    }
    saveMutation.mutate({ currency, man_day_cost: value })
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Cost Configuration</CardTitle>
        <CardDescription>
          The currency and cost of a single man-day for this team. These are used to value
          capacity and work on the Dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-4">
        {teamId === null ? (
          <p className="text-sm text-muted-foreground">Select a team to configure its costs.</p>
        ) : costQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-9 w-full max-w-xs" />
          </div>
        ) : costQuery.isError ? (
          <p className="text-sm text-destructive">{costQuery.error.message}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cost-currency">Currency</Label>
                <Select
                  items={CURRENCIES}
                  value={currency}
                  onValueChange={(value) => {
                    setFeedback(null)
                    setCurrency(value as string)
                  }}
                >
                  <SelectTrigger id="cost-currency" className="w-full max-w-md">
                    <SelectValue placeholder="Select a currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost-man-day">Man Day Cost</Label>
                <Input
                  id="cost-man-day"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className="w-full max-w-xs"
                  value={manDayCost}
                  onChange={(event) => {
                    setFeedback(null)
                    setManDayCost(event.target.value)
                  }}
                />
              </div>
            </div>
            {feedback && (
              <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
      {teamId !== null && costQuery.data && (
        <CardFooter className="justify-end">
          <Button
            type="button"
            className="min-w-32"
            disabled={saveMutation.isPending}
            onClick={handleSave}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

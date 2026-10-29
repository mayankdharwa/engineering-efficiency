import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '../api'
import { useSelectedTeam } from '../hooks/useSelectedTeam'
import { notifyError, notifySuccess } from '../lib/notify'
import { invalidateTeamData, queryKeys } from '../lib/queryKeys'
import { requireTeamId } from '../lib/scope'
import { OptionSelect } from './OptionSelect'
import { QueryPanelBody } from './QueryPanelBody'

/** Currency symbols the app can display, with their names for the dropdown. */
const CURRENCIES = [
  { value: '€', label: '€ Euro' },
  { value: '$', label: '$ Dollar' },
  { value: '₹', label: '₹ INR' },
]

/** Per-team cost configuration: currency symbol and man-day cost. */
export function CostConfigurationPanel() {
  const queryClient = useQueryClient()
  const { teamId } = useSelectedTeam()

  const [currency, setCurrency] = useState('$')
  const [manDayCost, setManDayCost] = useState('0')

  const costQuery = useQuery({
    queryKey: queryKeys.teamCost(teamId),
    queryFn: teamId === null ? skipToken : () => api.getTeamCost(teamId),
  })

  useEffect(() => {
    const data = costQuery.data
    if (!data) return
    setCurrency(data.currency)
    setManDayCost(String(data.man_day_cost))
  }, [costQuery.data])

  const saveMutation = useMutation({
    mutationFn: (payload: { currency: string; man_day_cost: number }) =>
      api.updateTeamCost(requireTeamId(teamId), payload),
    onSuccess: (data) => {
      notifySuccess('Cost configuration saved.')
      setCurrency(data.currency)
      setManDayCost(String(data.man_day_cost))
      if (teamId !== null) invalidateTeamData(queryClient, teamId)
    },
  })

  function handleSave() {
    const value = Number(manDayCost)
    if (!Number.isInteger(value) || value < 0) {
      notifyError('Man day cost must be a whole number of 0 or more.')
      return
    }
    saveMutation.mutate({ currency, man_day_cost: value })
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Cost Configuration</CardTitle>
        <CardDescription>Currency and cost of one man-day.</CardDescription>
      </CardHeader>
      <CardContent className="gap-4">
        {teamId === null ? (
          <p className="text-sm text-muted-foreground">Select a team first.</p>
        ) : (
          <QueryPanelBody
            isLoading={costQuery.isLoading}
            isError={costQuery.isError}
            error={costQuery.error}
            skeleton={
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-9 w-full max-w-md" />
                <Skeleton className="h-9 w-full max-w-xs" />
              </div>
            }
          >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cost-currency">Currency</Label>
              <OptionSelect
                items={CURRENCIES}
                value={currency}
                onValueChange={setCurrency}
                id="cost-currency"
                className="w-full max-w-md"
                placeholder="Select a currency"
              />
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
                onChange={(event) => setManDayCost(event.target.value)}
              />
            </div>
          </div>
          </QueryPanelBody>
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

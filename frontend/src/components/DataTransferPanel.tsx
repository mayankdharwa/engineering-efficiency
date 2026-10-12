import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { api } from '../api'
import { notifyError, notifySuccess } from '../lib/notify'

function formatCounts(result: {
  teams: number
  cycles: number
  issues: number
  members: number
}): string {
  const parts = [
    `${result.teams} team${result.teams === 1 ? '' : 's'}`,
    `${result.cycles} cycle${result.cycles === 1 ? '' : 's'}`,
    `${result.issues} issue${result.issues === 1 ? '' : 's'}`,
    `${result.members} member${result.members === 1 ? '' : 's'}`,
  ]
  return parts.join(', ')
}

export function DataTransferPanel() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const exportMutation = useMutation({
    mutationFn: api.downloadExport,
    onSuccess: () =>
      notifySuccess('Export downloaded. The Linear API key was not included.'),
    onError: (error: Error) => notifyError(error.message),
  })

  const importMutation = useMutation({
    mutationFn: (selected: File) => api.importData(selected),
    onSuccess: (result) => {
      notifySuccess(
        `Imported ${formatCounts(result)}. Your Linear API key was left unchanged.`,
      )
      setFile(null)
      setFileInputKey((key) => key + 1)
      void queryClient.invalidateQueries()
    },
    onError: (error: Error) => notifyError(error.message),
  })

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Download a JSON snapshot of the teams, cycles, issues, groups, costs and
            settings stored locally. The Linear API key and any other secrets are
            omitted so the file is safe to share.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            type="button"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? 'Preparing…' : 'Download export'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Import</CardTitle>
          <CardDescription>
            Replace the shareable data on this machine with a previously exported
            snapshot. Your Linear API key stays as it is — save one separately under
            Linear Setup if you want to refresh from Linear afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <div className="max-w-md space-y-2">
            <Label htmlFor="import-file">Export file</Label>
            <Input
              key={fileInputKey}
              id="import-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            disabled={!file || importMutation.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {importMutation.isPending ? 'Importing…' : 'Import snapshot'}
          </Button>
        </CardFooter>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace local data with this file?</AlertDialogTitle>
            <AlertDialogDescription>
              Teams, cycles, issues, groups, costs and time settings on this
              machine will be replaced. The Linear API key already saved here is
              kept. This cannot be undone unless you have your own export.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                if (file) importMutation.mutate(file)
              }}
            >
              Import and replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

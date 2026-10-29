import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
import { notifySuccess } from '../lib/notify'
import { ConfirmDialog } from './ConfirmDialog'

function formatCounts(result: {
  teams: number
  cycles: number
  issues: number
  members: number
  projects: number
}): string {
  const parts = [
    `${result.teams} team${result.teams === 1 ? '' : 's'}`,
    `${result.cycles} cycle${result.cycles === 1 ? '' : 's'}`,
    `${result.issues} issue${result.issues === 1 ? '' : 's'}`,
    `${result.members} member${result.members === 1 ? '' : 's'}`,
    `${result.projects} project${result.projects === 1 ? '' : 's'}`,
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
      notifySuccess('Export downloaded.'),
  })

  const importMutation = useMutation({
    mutationFn: (selected: File) => api.importData(selected),
    onSuccess: (result) => {
      notifySuccess(`Imported ${formatCounts(result)}.`)
      setFile(null)
      setFileInputKey((key) => key + 1)
      void queryClient.invalidateQueries()
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Download teams, cycles, projects, issues, groups, costs, and settings.
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
            Replace local data with an exported zip or JSON file.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <div className="max-w-md space-y-2">
            <Label htmlFor="import-file">Export file</Label>
            <Input
              key={fileInputKey}
              id="import-file"
              type="file"
              accept="application/json,.json,application/zip,.zip"
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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Replace local data with this file?"
        description="This replaces local teams, cycles, issues, groups, costs, and time settings. It cannot be undone."
        confirmLabel="Import and replace"
        onConfirm={() => {
          if (file) importMutation.mutate(file)
        }}
      />
    </div>
  )
}

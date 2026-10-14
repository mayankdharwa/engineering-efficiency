import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '../api'
import { notifyError, notifySuccess } from '../lib/notify'
import { queryKeys } from '../lib/queryKeys'
import type { UserOut, UserRole } from '../types'
import { QueryPanelBody } from './QueryPanelBody'

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'reader', label: 'Reader' },
]

function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'Admin' : 'Reader'
}

export function AppUsersPanel() {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('reader')
  const [pendingDelete, setPendingDelete] = useState<UserOut | null>(null)

  const authQuery = useQuery({ queryKey: queryKeys.auth, queryFn: api.getAuthStatus })
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: api.listUsers })
  const users = usersQuery.data ?? []
  const currentUsername = authQuery.data?.username
  const adminCount = users.filter((user) => user.role === 'admin').length

  const createMutation = useMutation({
    mutationFn: api.createUser,
    onSuccess: (created) => {
      notifySuccess(`Added ${created.username}.`)
      setUsername('')
      setPassword('')
      setRole('reader')
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ userId, nextRole }: { userId: number; nextRole: UserRole }) =>
      api.updateUser(userId, { role: nextRole }),
    onSuccess: (updated) => {
      notifySuccess(`${updated.username} is now a ${roleLabel(updated.role).toLowerCase()}.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      queryClient.invalidateQueries({ queryKey: queryKeys.auth })
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => api.deleteUser(userId),
    onSuccess: (_result, userId) => {
      const removed = users.find((user) => user.id === userId)
      notifySuccess(removed ? `Deleted ${removed.username}.` : 'User deleted.')
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
    },
    onError: (error: Error) => notifyError(error.message),
  })

  const onCreate = (event: FormEvent) => {
    event.preventDefault()
    createMutation.mutate({ username, password, role })
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>App Users</CardTitle>
        <CardDescription>
          Admins can open Settings. Readers can view Cycles and Projects only.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-6">
        <form
          className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,12rem)_auto]"
          onSubmit={onCreate}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="new-user-name">Username</Label>
            <Input
              id="new-user-name"
              name="username"
              autoComplete="off"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="new-user-password">Password</Label>
            <Input
              id="new-user-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="new-user-role">Role</Label>
            <Select
              items={ROLES}
              value={role}
              onValueChange={(value) => setRole(value as UserRole)}
            >
              <SelectTrigger id="new-user-role" className="h-9 !w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="h-9" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Adding…' : 'Add user'}
          </Button>
        </form>

        <QueryPanelBody
          isLoading={usersQuery.isLoading}
          isError={usersQuery.isError}
          error={usersQuery.error}
          skeleton={<Skeleton className="h-32 w-full" />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isSelf = user.username === currentUsername
                const lastAdmin = user.role === 'admin' && adminCount <= 1
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <span className="font-medium">{user.username}</span>
                      {isSelf ? (
                        <Badge variant="secondary" className="ml-2">
                          You
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Select
                        items={ROLES}
                        value={user.role}
                        onValueChange={(value) =>
                          updateMutation.mutate({
                            userId: user.id,
                            nextRole: value as UserRole,
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-32"
                          aria-label={`Role for ${user.username}`}
                          disabled={updateMutation.isPending || lastAdmin}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSelf || lastAdmin || deleteMutation.isPending}
                        onClick={() => setPendingDelete(user)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </QueryPanelBody>
      </CardContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be able to sign in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

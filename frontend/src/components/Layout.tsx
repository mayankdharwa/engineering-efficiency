import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '../api'
import { queryKeys } from '../lib/queryKeys'

const navBase =
  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors'
const navIdle = `${navBase} text-muted-foreground hover:bg-muted hover:text-foreground`
const navActive = `${navBase} bg-secondary text-secondary-foreground`

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const authQuery = useQuery({ queryKey: queryKeys.auth, queryFn: api.getAuthStatus })

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      queryClient.clear()
      await navigate({ to: '/login' })
    },
  })

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/cycles" className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-5 rounded-md bg-gradient-to-br from-primary to-amber-600" />
            Engineering Efficiency
          </Link>
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1">
              <Link
                to="/cycles"
                className={navIdle}
                activeProps={{ className: navActive }}
                activeOptions={{ exact: true }}
              >
                Cycles
              </Link>
              <Link to="/projects" className={navIdle} activeProps={{ className: navActive }}>
                Projects
              </Link>
              {authQuery.data?.role === 'admin' ? (
                <Link to="/config" className={navIdle} activeProps={{ className: navActive }}>
                  Settings
                </Link>
              ) : null}
            </nav>
            {authQuery.data?.username ? (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {authQuery.data.username}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="w-full flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  )
}

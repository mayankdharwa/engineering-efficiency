import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

const navBase =
  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors'
const navIdle = `${navBase} text-muted-foreground hover:bg-muted hover:text-foreground`
const navActive = `${navBase} bg-secondary text-secondary-foreground`

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-5 rounded-md bg-gradient-to-br from-primary to-amber-600" />
            Engineering Efficiency
          </Link>
          <nav className="flex items-center gap-1">
            <Link to="/" className={navIdle} activeProps={{ className: navActive }}>
              Dashboard
            </Link>
            <Link to="/config" className={navIdle} activeProps={{ className: navActive }}>
              Configuration
            </Link>
          </nav>
        </div>
      </header>
      <main className="w-full flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  )
}

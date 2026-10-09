import { Link, Outlet } from '@tanstack/react-router'
import { ConfigTeamProvider } from '../hooks/useConfigTeam'

const navBase = 'block shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors'
const navIdle = `${navBase} text-muted-foreground hover:bg-muted hover:text-foreground`
const navActive = `${navBase} bg-secondary text-secondary-foreground`

const SECTIONS = [
  { to: '/config/linear', label: 'Linear Setup' },
  { to: '/config/time', label: 'Time Configuration' },
  { to: '/config/cycle', label: 'Cycle Configuration' },
  { to: '/config/groups', label: 'Groups' },
  { to: '/config/team', label: 'Team Configuration' },
] as const

export function ConfigLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Connect to Linear and manage the teams and cycle settings stored locally.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav
          aria-label="Configuration sections"
          className="flex gap-1 overflow-x-auto pb-1 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {SECTIONS.map((section) => (
            <Link
              key={section.to}
              to={section.to}
              className={navIdle}
              activeProps={{ className: navActive }}
              activeOptions={{ exact: true }}
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <ConfigTeamProvider>
            <Outlet />
          </ConfigTeamProvider>
        </div>
      </div>
    </div>
  )
}

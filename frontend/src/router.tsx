import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  retainSearchParams,
} from '@tanstack/react-router'
import { Toaster } from '@/components/ui/toast'
import { Layout } from './components/Layout'
import { AppUsersPanel } from './components/AppUsersPanel'
import { CycleConfigurationPanel } from './components/CycleConfigurationPanel'
import { DataTransferPanel } from './components/DataTransferPanel'
import { GroupsPanel } from './components/GroupsPanel'
import { LinearSetupPanel } from './components/LinearSetupPanel'
import { TeamConfigurationPanel } from './components/TeamConfigurationPanel'
import { TimeConfigurationPanel } from './components/TimeConfigurationPanel'
import { api } from './api'
import { SelectedTeamProvider } from './hooks/useSelectedTeam'
import { parseTeamSearch } from './lib/teamSearch'
import { ConfigLayout } from './pages/ConfigLayout'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: async () => {
    const status = await api.getAuthStatus()
    if (status.authenticated) {
      throw redirect({ to: '/cycles', replace: true })
    }
  },
  component: LoginPage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  validateSearch: parseTeamSearch,
  search: {
    middlewares: [retainSearchParams(['team'])],
  },
  beforeLoad: async () => {
    const status = await api.getAuthStatus()
    if (!status.authenticated) {
      throw redirect({ to: '/login' })
    }
  },
  component: () => (
    <Layout>
      <SelectedTeamProvider>
        <Outlet />
      </SelectedTeamProvider>
    </Layout>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/cycles', search, replace: true })
  },
})

const cyclesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/cycles',
  component: DashboardPage,
})

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: ProjectsPage,
})

const configRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/config',
  beforeLoad: async ({ search }) => {
    const status = await api.getAuthStatus()
    if (status.role !== 'admin') {
      throw redirect({ to: '/cycles', search, replace: true })
    }
  },
  component: ConfigLayout,
})

const configIndexRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/',
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/config/linear', search, replace: true })
  },
})

const linearRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/linear',
  component: LinearSetupPanel,
})

const timeRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/time',
  component: TimeConfigurationPanel,
})

const cycleRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/cycle',
  component: CycleConfigurationPanel,
})

const groupsRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/groups',
  component: GroupsPanel,
})

const teamRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/team',
  component: TeamConfigurationPanel,
})

const dataRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/data',
  component: DataTransferPanel,
})

const usersRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/users',
  component: AppUsersPanel,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    cyclesRoute,
    projectsRoute,
    configRoute.addChildren([
      configIndexRoute,
      linearRoute,
      timeRoute,
      cycleRoute,
      groupsRoute,
      teamRoute,
      dataRoute,
      usersRoute,
    ]),
  ]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

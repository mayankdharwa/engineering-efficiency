import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  retainSearchParams,
} from '@tanstack/react-router'
import { Toaster } from '@/components/ui/toast'
import { Layout } from './components/Layout'
import { api } from './api'
import { SelectedTeamProvider } from './hooks/useSelectedTeam'
import { parseTeamSearch } from './lib/teamSearch'

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
  component: lazyRouteComponent(() => import('./pages/LoginPage'), 'LoginPage'),
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
  component: lazyRouteComponent(() => import('./pages/DashboardPage'), 'DashboardPage'),
})

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects',
  component: lazyRouteComponent(() => import('./pages/ProjectsPage'), 'ProjectsPage'),
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
  component: lazyRouteComponent(() => import('./pages/ConfigLayout'), 'ConfigLayout'),
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
  component: lazyRouteComponent(() => import('./components/LinearSetupPanel'), 'LinearSetupPanel'),
})

const timeRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/time',
  component: lazyRouteComponent(
    () => import('./components/TimeConfigurationPanel'),
    'TimeConfigurationPanel',
  ),
})

const cycleRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/cycle',
  component: lazyRouteComponent(
    () => import('./components/CycleConfigurationPanel'),
    'CycleConfigurationPanel',
  ),
})

const groupsRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/groups',
  component: lazyRouteComponent(() => import('./components/GroupsPanel'), 'GroupsPanel'),
})

const teamRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/team',
  component: lazyRouteComponent(
    () => import('./components/TeamConfigurationPanel'),
    'TeamConfigurationPanel',
  ),
})

const dataRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/data',
  component: lazyRouteComponent(() => import('./components/DataTransferPanel'), 'DataTransferPanel'),
})

const usersRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/users',
  component: lazyRouteComponent(() => import('./components/AppUsersPanel'), 'AppUsersPanel'),
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

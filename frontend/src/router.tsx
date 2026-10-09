import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { CycleConfigurationPanel } from './components/CycleConfigurationPanel'
import { GroupsPanel } from './components/GroupsPanel'
import { LinearSetupPanel } from './components/LinearSetupPanel'
import { TeamConfigurationPanel } from './components/TeamConfigurationPanel'
import { TimeConfigurationPanel } from './components/TimeConfigurationPanel'
import { ConfigLayout } from './pages/ConfigLayout'
import { DashboardPage } from './pages/DashboardPage'

const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
})

const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/config',
  component: ConfigLayout,
})

const configIndexRoute = createRoute({
  getParentRoute: () => configRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/config/linear' })
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  configRoute.addChildren([
    configIndexRoute,
    linearRoute,
    timeRoute,
    cycleRoute,
    groupsRoute,
    teamRoute,
  ]),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

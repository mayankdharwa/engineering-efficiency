import { LinearConnectionPanel } from './LinearConnectionPanel'
import { TeamsPanel } from './TeamsPanel'

/** Linear API setup plus the team list (import, refresh, delete). */
export function LinearSetupPanel() {
  return (
    <div className="flex flex-col gap-6">
      <LinearConnectionPanel />
      <TeamsPanel />
    </div>
  )
}

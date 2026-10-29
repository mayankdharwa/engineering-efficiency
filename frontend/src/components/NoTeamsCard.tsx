import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/** Shown on Cycles and Projects when the workspace has no teams yet. */
export function NoTeamsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No teams available</CardTitle>
        <CardDescription>Import teams in Settings first.</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/config" className={buttonVariants()}>
          Go to Settings
        </Link>
      </CardContent>
    </Card>
  )
}

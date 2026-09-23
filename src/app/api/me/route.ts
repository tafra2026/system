import { json, withActor } from '@/server/http'
import { ROLE_PERMISSIONS } from '@/server/authz/permissions'

export const GET = withActor(async (_req, actor) =>
  json({
    userId: actor.userId,
    employeeId: actor.employeeId,
    role: actor.role,
    locale: actor.locale,
    displayName: actor.displayName,
    permissions: ROLE_PERMISSIONS[actor.role],
  }),
)

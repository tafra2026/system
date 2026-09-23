import { json, withActor } from '@/server/http'
import { listStaff } from '@/server/services/staff'

/** Staff list. Salaries are included only for roles with `salaries.read`. */
export const GET = withActor(async (req, actor) => {
  const includeArchived = req.nextUrl.searchParams.get('archived') === '1'
  return json({ staff: await listStaff(actor, { includeArchived }) })
})

import { json, withActor } from '@/server/http'
import { salaryHistory } from '@/server/services/staff'

/** Salary history — management only (403 for everyone else, including direct calls). */
export const GET = withActor<{ params: Promise<{ id: string }> }>(async (_req, actor, ctx) => {
  const { id } = await ctx.params
  return json({ salaries: await salaryHistory(actor, id) })
})

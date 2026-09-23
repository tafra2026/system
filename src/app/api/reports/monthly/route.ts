import { json, withActor } from '@/server/http'
import { currentMonth } from '@/domain/months'
import { monthlyReport } from '@/server/services/reports'

/** Monthly report. Moderators get sales only (no expenses, salaries or profit). */
export const GET = withActor(async (req, actor) => json(await monthlyReport(actor, req.nextUrl.searchParams.get('month') ?? currentMonth())))

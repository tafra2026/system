import { NextResponse } from 'next/server'
import { withActor } from '@/server/http'
import { currentMonth } from '@/domain/months'
import { assertCanExport, METRICS, metricRows, toCsv, type Metric } from '@/server/services/reports'
import { ValidationError } from '@/server/services/errors'

/** CSV export (UTF-8 BOM for Excel with Arabic), filtered by permission. */
export const GET = withActor(async (req, actor) => {
  const metric = req.nextUrl.searchParams.get('metric') as Metric
  const month = req.nextUrl.searchParams.get('month') ?? currentMonth()
  if (!METRICS.includes(metric)) throw new ValidationError('validation_failed', { metric: 'invalid' })
  assertCanExport(actor, metric)
  const csv = toCsv(await metricRows(actor, metric, month))
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pamper-${metric}-${month}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
})

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Forbidden } from '@/components/forbidden'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { currentMonth, isMonthKey } from '@/domain/months'
import { createTranslator, type MessageKey } from '@/i18n'
import { formatCalendarDate, formatMoney } from '@/i18n/format'
import { ForbiddenError } from '@/server/authz/errors'
import { requireActor } from '@/server/auth/current'
import { METRICS, metricRows, type Metric } from '@/server/services/reports'

/** The operations behind a report figure, with CSV export. */
export default async function MetricPage({ params, searchParams }: { params: Promise<{ metric: string }>; searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  const { metric } = await params
  if (!METRICS.includes(metric as Metric)) notFound()
  const q = (await searchParams).month
  const month = q && isMonthKey(q) ? q : currentMonth()
  let rows: Awaited<ReturnType<typeof metricRows>>
  try {
    rows = await metricRows(actor, metric as Metric, month)
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden message={t('errors.forbidden')} />
    throw err
  }
  const cols = rows.length ? Object.keys(rows[0]!).filter((c) => c !== 'orderId') : []
  const total = rows.reduce((a, r) => a + ((r as { amount?: number }).amount ?? 0), 0)
  const cell = (c: string, v: unknown) => {
    if (typeof v === 'number') return formatMoney(v, actor.locale)
    if (c === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatCalendarDate(v, actor.locale, false)
    if (c === 'method') return t(`payments.methods.${v as 'cash'}`)
    if (c === 'kind') return t(`commissions.kinds.${v as 'specialist'}`)
    return String(v ?? '')
  }
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/reports?month=${month}`} className="text-sm font-medium text-brand-deep hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader
        title={t(`reports.metrics.${metric}` as MessageKey)}
        subtitle={`${month} · ${formatMoney(total, actor.locale)}`}
        actions={
          <a href={`/api/reports/export?metric=${metric}&month=${month}`} className="text-sm font-medium text-brand-deep underline">
            {t('reports.export')}
          </a>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState body={t('reports.noRows')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  {cols.map((c) => (
                    <th key={c} className="px-2 py-2 text-start font-medium">
                      {t(`reports.columns.${c}` as MessageKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c} className="px-2 py-2" dir={c === 'reference' ? 'ltr' : 'auto'}>
                        {c === 'reference' && (r as { orderId?: string }).orderId ? (
                          <Link href={`/orders/${(r as { orderId: string }).orderId}`} className="text-brand-deep underline">
                            {String(r[c as keyof typeof r])}
                          </Link>
                        ) : (
                          cell(c, r[c as keyof typeof r])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

import Link from 'next/link'
import { createTranslator } from '@/i18n'
import { formatMoney } from '@/i18n/format'
import type { Locale } from '@/i18n/types'
import type { dashboardFigures } from '@/server/services/reports'
import { Card } from './ui'

type Data = Awaited<ReturnType<typeof dashboardFigures>>

function Change({ value, locale }: { value: number | null | undefined; locale: Locale }) {
  const t = createTranslator(locale)
  if (value == null) return <span className="text-xs text-muted">{t('reports.noComparison')}</span>
  const up = value >= 0
  return (
    <span className={`text-xs font-semibold ${up ? 'text-success' : 'text-danger'}`}>
      <bdi>
        {up ? '+' : ''}
        {value}%
      </bdi>
    </span>
  )
}

/** Today vs previous day and month-to-date vs same period last month. Real figures only. */
export function Figures({ data, locale }: { data: Data; locale: Locale }) {
  const t = createTranslator(locale)
  const blocks = [
    { title: t('reports.today'), sub: t('reports.vsYesterday'), d: data.day },
    { title: t('reports.monthToDate'), sub: t('reports.vsLastMonth'), d: data.monthToDate },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {blocks.map((b) => {
        const g = b.d.growth as Record<string, number | null>
        const d = b.d as unknown as Record<string, number>
        const rows: [string, string, 'money' | 'count'][] = [
          ['booked', t('reports.bookedValue'), 'money'],
          ['bookings', t('reports.bookings'), 'count'],
          ...(data.finance
            ? ([
                ['executed', t('reports.executedRevenue'), 'money'],
                ['collected', t('reports.collections'), 'money'],
              ] as [string, string, 'money'][])
            : []),
        ]
        return (
          <Card key={b.title} title={b.title} subtitle={b.sub} actions={<Link href="/reports" className="text-sm font-medium text-brand-deep underline">{t('reports.details')}</Link>}>
            <dl className="grid grid-cols-2 gap-3">
              {rows.map(([k, label, kind]) => (
                <div key={k} className="rounded-xl bg-brand-soft/60 p-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-lg font-bold text-ink">{kind === 'money' ? formatMoney(d[k] ?? 0, locale) : (d[k] ?? 0)}</dd>
                  <Change value={g[k]} locale={locale} />
                </div>
              ))}
            </dl>
          </Card>
        )
      })}
    </div>
  )
}

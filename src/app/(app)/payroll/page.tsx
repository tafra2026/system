import { Forbidden } from '@/components/forbidden'
import { MonthPicker } from '@/components/month-picker'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { toSarString } from '@/domain/money'
import { currentMonth, isMonthKey, previousMonth } from '@/domain/months'
import { riyadhToday } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { formatCalendarDate, formatMoney } from '@/i18n/format'
import { getDb } from '@/server/db'
import { pagePermission } from '@/server/auth/current'
import { advanceBalances, getRun } from '@/server/services/payroll'
import { listStaff } from '@/server/services/staff'
import { AdjustmentForm, AdvanceForm, PayItemForm, RunButton } from './payroll-forms'

const tone = { draft: 'warning', approved: 'brand', closed: 'success' } as const

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor, allowed } = await pagePermission('payroll.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const q = (await searchParams).month
  const month = q && isMonthKey(q) ? q : previousMonth(currentMonth())
  const today = riyadhToday()
  const [data, staff, adv] = await Promise.all([getRun(actor, month), listStaff(actor), advanceBalances(getDb())])
  const money = (v: number) => formatMoney(v, actor.locale)
  const employees = staff.map((s) => ({ id: s.id, name: actor.locale === 'en' && s.displayNameEn ? s.displayNameEn : s.fullName }))
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? ''
  const sum = (k: 'baseSalaryHalalas' | 'commissionsHalalas' | 'netHalalas' | 'paidHalalas' | 'remainingHalalas') => data?.items.reduce((a, i) => a + i[k], 0) ?? 0

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('payroll.title')} subtitle={t('payroll.payWindow')} actions={data && <Badge tone={tone[data.run.status]}>{t(`payroll.statuses.${data.run.status}`)}</Badge>} />
      <MonthPicker path="/payroll" month={month} labels={{ previous: t('calendar.previous'), next: t('calendar.next'), apply: t('orders.apply'), month: t('payroll.month') }} />
      <Card
        title={`${t('payroll.month')}: ${month}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(!data || data.run.status === 'draft') && <RunButton kind="prepare" month={month} />}
            {data?.run.status === 'draft' && <RunButton kind="approve" month={month} variant="primary" />}
            {data?.run.status === 'approved' && <RunButton kind="close" month={month} />}
          </div>
        }
      >
        {data?.run.status === 'draft' && <p className="mb-3 text-xs text-muted">{t('payroll.approveHint')}</p>}
        {!data ? (
          <EmptyState body={t('payroll.noRun')} />
        ) : data.items.length === 0 ? (
          <EmptyState body={t('payroll.noItems')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs text-muted">
                  {['employee', 'base', 'commissions', 'bonuses', 'deductions', 'advance', 'net', 'paid', 'remaining'].map((h) => (
                    <th key={h} className="px-2 py-2 text-start font-medium">
                      {t(`payroll.${h}` as 'payroll.employee')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-2 py-2 font-semibold text-ink">{i.name}</td>
                    <td className="px-2 py-2">{money(i.baseSalaryHalalas)}</td>
                    <td className="px-2 py-2">{money(i.commissionsHalalas)}</td>
                    <td className="px-2 py-2">{money(i.bonusesHalalas)}</td>
                    <td className="px-2 py-2">{money(i.deductionsHalalas)}</td>
                    <td className="px-2 py-2">{money(i.advanceDeductionHalalas)}</td>
                    <td className="px-2 py-2 font-bold text-brand-deep">{money(i.netHalalas)}</td>
                    <td className="px-2 py-2">{money(i.paidHalalas)}</td>
                    <td className="px-2 py-2">
                      {money(i.remainingHalalas)}
                      {data.run.status === 'approved' && i.remainingHalalas > 0 && (
                        <div className="mt-1">
                          <PayItemForm itemId={i.id} remainingSar={toSarString(i.remainingHalalas)} today={today} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-2 py-2">{t('payroll.total')}</td>
                  <td className="px-2 py-2">{money(sum('baseSalaryHalalas'))}</td>
                  <td className="px-2 py-2">{money(sum('commissionsHalalas'))}</td>
                  <td colSpan={3} />
                  <td className="px-2 py-2">{money(sum('netHalalas'))}</td>
                  <td className="px-2 py-2">{money(sum('paidHalalas'))}</td>
                  <td className="px-2 py-2">{money(sum('remainingHalalas'))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {data && data.adjustments.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
            {data.adjustments.map((a) => (
              <li key={a.id} dir="auto">
                {nameOf(a.employeeId)} · {t(a.kind === 'bonus' ? 'payroll.bonus' : 'payroll.deduction')} {money(a.amountHalalas)} · {a.reason}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {(!data || data.run.status === 'draft') && (
        <Card title={t('payroll.adjustment')}>
          <AdjustmentForm month={month} employees={employees} />
        </Card>
      )}
      <Card title={t('payroll.advances')}>
        {adv.length === 0 ? (
          <p className="mb-3 text-sm text-muted">{t('payroll.noAdvances')}</p>
        ) : (
          <ul className="mb-3 divide-y divide-line text-sm">
            {adv.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-semibold">{nameOf(a.employeeId)}</span>
                <span className="text-muted">{formatCalendarDate(a.givenOn, actor.locale, false)}</span>
                <span>
                  {money(a.amountHalalas)} · {t('payroll.installment')} {money(a.monthlyInstallmentHalalas)}
                </span>
                <strong>
                  {t('payroll.outstanding')}: {money(a.outstandingHalalas)}
                </strong>
              </li>
            ))}
          </ul>
        )}
        <AdvanceForm employees={employees} today={today} />
      </Card>
    </div>
  )
}

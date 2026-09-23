import { Forbidden } from '@/components/forbidden'
import { MonthPicker } from '@/components/month-picker'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { currentMonth, isMonthKey } from '@/domain/months'
import { riyadhToday } from '@/domain/operational-day'
import { createTranslator } from '@/i18n'
import { formatCalendarDate, formatMoney } from '@/i18n/format'
import { pagePermission } from '@/server/auth/current'
import { listExpenseCategories, listExpenses, listRecurring } from '@/server/services/expenses'
import { ExpenseActions, GenerateDraftsButton, NewExpenseForm, RecurringForm } from './expense-forms'

const tone = { draft: 'warning', approved: 'success', voided: 'neutral' } as const

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor, allowed } = await pagePermission('expenses.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const q = (await searchParams).month
  const month = q && isMonthKey(q) ? q : currentMonth()
  const today = riyadhToday()
  const [cats, rows, recurring] = await Promise.all([listExpenseCategories(actor), listExpenses(actor, month), listRecurring(actor)])
  const categories = cats.filter((c) => c.active).map((c) => ({ id: c.id, code: c.code, name: actor.locale === 'en' ? c.nameEn : c.nameAr }))
  const approvedTotal = rows.filter((r) => r.e.status === 'approved').reduce((a, r) => a + r.e.amountHalalas, 0)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('expenses.title')} subtitle={`${t('expenses.total')}: ${formatMoney(approvedTotal, actor.locale)}`} />
      <MonthPicker path="/expenses" month={month} labels={{ previous: t('calendar.previous'), next: t('calendar.next'), apply: t('orders.apply'), month: t('expenses.month') }} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState body={t('expenses.none')} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map(({ e, nameAr, nameEn }) => (
              <li key={e.id} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink" dir="auto">
                    {e.description}
                    {e.itemName && <span className="font-normal text-muted"> · {e.itemName}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge>{actor.locale === 'en' ? nameEn : nameAr}</Badge>
                    <Badge tone={tone[e.status]}>{t(`expenses.statuses.${e.status}`)}</Badge>
                    <strong className={e.status === 'voided' ? 'text-muted line-through' : 'text-ink'}>{formatMoney(e.amountHalalas, actor.locale)}</strong>
                  </span>
                </div>
                <span className="text-xs text-muted">
                  {e.paidOn ? `${t('expenses.paidOn')}: ${formatCalendarDate(e.paidOn, actor.locale, false)}` : t('expenses.paidOnHint')}
                  {e.voidReason && ` · ${e.voidReason}`}
                  {e.notes && ` · ${e.notes}`}
                </span>
                <ExpenseActions id={e.id} status={e.status} paid={Boolean(e.paidOn)} today={today} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('expenses.new')}>
        <NewExpenseForm categories={categories} month={month} today={today} />
      </Card>
      <Card title={t('expenses.recurring')} subtitle={t('expenses.recurringHint')}>
        {recurring.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {recurring.map(({ r, nameAr, nameEn }) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span dir="auto">
                  {r.description} · <span className="text-muted">{actor.locale === 'en' ? nameEn : nameAr}</span>
                </span>
                <strong>{formatMoney(r.amountHalalas, actor.locale)}</strong>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-3">
          <GenerateDraftsButton month={month} />
          <RecurringForm categories={categories} />
        </div>
      </Card>
    </div>
  )
}

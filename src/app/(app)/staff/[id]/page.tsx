import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Forbidden } from '@/components/forbidden'
import { Badge, Card, DefinitionList, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { formatCalendarDate, formatDateTime, formatMoney } from '@/i18n/format'
import { riyadhMonthStart, riyadhToday } from '@/domain/operational-day'
import { toSarString } from '@/domain/money'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { NotFoundError } from '@/server/services/errors'
import { getEmployee, salaryHistory } from '@/server/services/staff'
import { AccountPanel, DetailsForm, RoleForm, SalaryForm, StatusForm } from './employee-forms'

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor, allowed } = await pagePermission('staff.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />

  let data: Awaited<ReturnType<typeof getEmployee>>
  try {
    data = await getEmployee(actor, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  const { employee, account } = data
  const history = can(actor, 'salaries.read') ? await salaryHistory(actor, id) : null
  const today = riyadhToday()
  const current = history?.find((h) => h.effectiveFrom <= today) ?? null
  const name = actor.locale === 'en' && employee.displayNameEn ? employee.displayNameEn : employee.fullName

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/staff" className="text-sm font-medium text-brand-deep hover:underline">
          {t('common.back')}
        </Link>
      </div>
      <PageHeader title={name} subtitle={t(`roles.${employee.role}`)} actions={<Badge tone={employee.status === 'active' ? 'success' : 'warning'}>{t(`employeeStatus.${employee.status}`)}</Badge>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('staff.details')}>
          <DetailsForm
            employeeId={id}
            defaults={{ fullName: employee.fullName, displayNameEn: employee.displayNameEn, phone: employee.phoneE164, notes: employee.notes }}
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card title={t('staff.account')}>
            {account ? (
              <div className="mb-4">
                <DefinitionList
                  items={[
                    { label: t('staff.username'), value: <span className="ltr-data">{account.username}</span> },
                    { label: t('staff.status'), value: <Badge tone={account.status === 'active' ? 'success' : account.status === 'pending' ? 'warning' : 'danger'}>{t(`accountStatus.${account.status}`)}</Badge> },
                    { label: t('staff.accountLanguage'), value: account.locale === 'ar' ? 'العربية' : 'English' },
                    { label: t('staff.lastLogin'), value: account.lastLoginAt ? formatDateTime(account.lastLoginAt, actor.locale) : t('common.never') },
                  ]}
                />
              </div>
            ) : (
              <p className="mb-3 text-sm text-muted">{t('staff.noAccount')}</p>
            )}
            <AccountPanel employeeId={id} account={account ? { id: account.id, status: account.status } : null} canCreate={employee.status === 'active'} />
          </Card>

          <Card title={t('staff.roleSection')}>
            <RoleForm employeeId={id} role={employee.role} />
            <hr className="my-4 border-line" />
            <StatusForm employeeId={id} status={employee.status} />
          </Card>
        </div>
      </div>

      {history && (
        <Card title={t('staff.salary')} subtitle={`${t('staff.currentSalary')}: ${current ? formatMoney(current.monthlySalaryHalalas, actor.locale) : t('common.notSet')}`}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">{t('staff.salaryHistory')}</h3>
              {history.length === 0 ? (
                <p className="text-sm text-muted">{t('staff.salaryHistoryEmpty')}</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="font-semibold text-ink">{formatMoney(h.monthlySalaryHalalas, actor.locale)}</span>
                      <span className="text-muted">
                        {t('staff.effectiveFrom')}: {formatCalendarDate(h.effectiveFrom, actor.locale, false)}
                      </span>
                      {h.reason && <span className="w-full text-xs text-muted" dir="auto">{h.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <SalaryForm employeeId={id} defaultEffectiveFrom={riyadhMonthStart()} defaultAmount={current ? toSarString(current.monthlySalaryHalalas) : ''} />
          </div>
        </Card>
      )}
    </div>
  )
}

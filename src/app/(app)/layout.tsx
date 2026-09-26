import { BrandLogo } from '@/components/brand-logo'
import { BottomNav, SideNav, type NavItem } from '@/components/shell/nav'
import { createTranslator } from '@/i18n'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { logoutAction } from './actions'
import Link from 'next/link'
import { LogoutButton } from '@/components/logout-button'
import { unreadNotificationCount } from '@/server/services/notifications'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  const unread = await unreadNotificationCount(actor)
  // Menu entries appear only for sections this role may use; the server re-checks every request.
  const entry = (show: boolean, href: string, label: string, icon: NavItem['icon']): NavItem[] => (show ? [{ href, label, icon }] : [])
  const items: NavItem[] = [
    { href: '/', label: t('nav.dashboard'), icon: 'home' },
    ...entry(can(actor, 'schedule.read.own') && actor.role === 'specialist', '/schedule', t('nav.schedule'), 'schedule'),
    ...entry(actor.role === 'driver', '/my-trips', t('nav.myTrips'), 'schedule'),
    ...entry(can(actor, 'orders.read.all'), '/orders', t('nav.orders'), 'orders'),
    ...entry(can(actor, 'messages.send') || actor.role === 'driver', '/messages', t('nav.messages'), 'messages'),
    ...entry(can(actor, 'orders.read.all'), '/calendar', t('nav.calendar'), 'calendar'),
    ...entry(can(actor, 'schedule.manage'), '/trips', t('nav.trips'), 'trips'),
    ...entry(can(actor, 'customers.manage'), '/customers', t('nav.customers'), 'customers'),
    ...entry(can(actor, 'sales.read'), '/reports', t('nav.reports'), 'reports'),
    ...entry(can(actor, 'payments.links'), '/payments/links', t('nav.paymentLinks'), 'cash'),
    ...entry(can(actor, 'cash.receive_handover'), '/cash', t('nav.cash'), 'cash'),
    ...entry(can(actor, 'commissions.read.own') || can(actor, 'commissions.read.all'), '/commissions', t('nav.commissions'), 'commissions'),
    ...entry(can(actor, 'expenses.manage'), '/expenses', t('nav.expenses'), 'expenses'),
    ...entry(can(actor, 'payroll.manage'), '/payroll', t('nav.payroll'), 'payroll'),
    ...entry(can(actor, 'orders.manage') || can(actor, 'catalog.manage'), '/catalog', t('nav.catalog'), 'catalog'),
    ...entry(can(actor, 'staff.manage'), '/staff', t('nav.staff'), 'staff'),
    ...entry(can(actor, 'staff.manage'), '/teams', t('nav.teams'), 'teams'),
    ...entry(can(actor, 'settings.manage'), '/settings', t('nav.settings'), 'settings'),
    ...entry(can(actor, 'audit.read'), '/audit', t('nav.audit'), 'audit'),
    { href: '/account', label: t('nav.account'), icon: 'account' },
  ]
  return (
    <div className="min-h-dvh pb-20 md:pb-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded-lg focus:bg-surface focus:p-2">
        {t('app.skipToContent')}
      </a>
      {/* Official combination: cream logo on the brand colour. Text sits in a light chip for contrast. */}
      <header className="bg-brand pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <BrandLogo label={t('app.fullName')} height={36} />
          <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            aria-label={unread > 0 ? t('notifications.bellUnread', { count: unread }) : t('notifications.title')}
            className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-cream text-brand-deep hover:bg-brand-soft"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            {unread > 0 && (
              <span className="absolute -top-1 -end-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-bold leading-5 text-white">{unread > 99 ? '99+' : unread}</span>
            )}
          </Link>
          <div className="flex items-center gap-1 rounded-2xl bg-cream py-1 ps-3 pe-1">
            <div className="text-end leading-tight">
              <p className="max-w-24 truncate text-sm font-semibold text-ink sm:max-w-none">{actor.displayName}</p>
              <p className="text-xs text-muted">{t(`roles.${actor.role}`)}</p>
            </div>
            <LogoutButton action={logoutAction} />
          </div>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4 pt-5">
        <SideNav items={items} label={t('nav.menu')} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <BottomNav items={items} label={t('nav.menu')} moreLabel={t('nav.more')} />
    </div>
  )
}

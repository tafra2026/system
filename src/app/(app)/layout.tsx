import { BrandLogo } from '@/components/brand-logo'
import { BottomNav, SideNav, type NavItem } from '@/components/shell/nav'
import { createTranslator } from '@/i18n'
import { can } from '@/server/authz/actor'
import { requireActor } from '@/server/auth/current'
import { logoutAction } from './actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor()
  const t = createTranslator(actor.locale)
  // Menu entries appear only for sections this role may use; the server re-checks every request.
  const items: NavItem[] = [
    { href: '/', label: t('nav.dashboard'), icon: 'home' },
    ...(can(actor, 'staff.manage') ? [{ href: '/staff', label: t('nav.staff'), icon: 'staff' as const }] : []),
    ...(can(actor, 'audit.read') ? [{ href: '/audit', label: t('nav.audit'), icon: 'audit' as const }] : []),
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
          <div className="flex items-center gap-1 rounded-2xl bg-cream py-1 ps-3 pe-1">
            <div className="text-end leading-tight">
              <p className="max-w-24 truncate text-sm font-semibold text-ink sm:max-w-none">{actor.displayName}</p>
              <p className="text-xs text-muted">{t(`roles.${actor.role}`)}</p>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="min-h-11 whitespace-nowrap rounded-xl px-2.5 text-sm font-medium text-brand-deep hover:bg-brand-soft">
                {t('nav.logout')}
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4 pt-5">
        <SideNav items={items} label={t('nav.menu')} />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <BottomNav items={items} label={t('nav.menu')} />
    </div>
  )
}

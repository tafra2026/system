import { BrandLogo } from '@/components/brand-logo'
import { BottomNav, SideNav, type NavItem } from '@/components/shell/nav'
import { Badge } from '@/components/ui'
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
      <header className="border-b border-line bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <BrandLogo label={t('app.name')} height={34} />
          <div className="flex items-center gap-3">
            <div className="text-end leading-tight">
              <p className="text-sm font-semibold text-ink">{actor.displayName}</p>
              <Badge tone="brand">{t(`roles.${actor.role}`)}</Badge>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="min-h-11 rounded-xl px-3 text-sm font-medium text-brand-deep hover:bg-brand-soft">
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

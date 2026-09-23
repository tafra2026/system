'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavItem {
  href: string
  label: string
  icon: 'home' | 'staff' | 'audit' | 'account'
}

const icons: Record<NavItem['icon'], React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  staff: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
      <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.7.8 2.8 2.5 3 5.2" />
    </>
  ),
  audit: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5" />
    </>
  ),
}

function Icon({ name }: { name: NavItem['icon'] }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  )
}

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

/** Sidebar on wide screens. */
export function SideNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname()
  return (
    <nav aria-label={label} className="hidden w-56 shrink-0 md:block">
      <ul className="sticky top-4 flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl border-s-4 px-3 text-sm font-medium ${
                  active ? 'border-brand bg-surface text-brand-deep shadow-sm' : 'border-transparent text-ink hover:bg-surface/70'
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Bottom tab bar on phones. */
export function BottomNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname()
  return (
    <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-brand-deep' : 'text-muted'}`}
              >
                <span className={`rounded-full px-3 py-0.5 ${active ? 'bg-brand-soft' : ''}`}>
                  <Icon name={item.icon} />
                </span>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

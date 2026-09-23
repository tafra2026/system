'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

export interface NavItem {
  href: string
  label: string
  icon: 'home' | 'staff' | 'audit' | 'account' | 'customers' | 'orders' | 'catalog' | 'settings' | 'schedule' | 'calendar' | 'trips' | 'teams' | 'reports' | 'cash' | 'commissions' | 'expenses' | 'payroll' | 'messages'
}

const icons: Record<NavItem['icon'], React.ReactNode> = {
  messages: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M8 10h8M8 13h5" />
    </>
  ),
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
  customers: (
    <>
      <path d="M12 3c2.5 0 4 1.8 4 4.2S14.5 12 12 12 8 9.6 8 7.2 9.5 3 12 3z" />
      <path d="M5 21c.4-4 3.3-6.5 7-6.5s6.6 2.5 7 6.5" />
    </>
  ),
  orders: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" />
    </>
  ),
  catalog: (
    <>
      <path d="M3 12 12 3h8v8l-9 9z" />
      <circle cx="16" cy="8" r="1.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2" />
    </>
  ),
  trips: (
    <>
      <path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1z" />
      <path d="M3 13h18" />
    </>
  ),
  teams: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M2 20c.5-3.3 3-5 6-5s5.5 1.7 6 5M12.5 15.4c1-.3 2.1-.4 3.5-.4 3 0 5.5 1.7 6 5" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 9v.01M18 15v.01" />
    </>
  ),
  commissions: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5V8M12 16v1.5" />
    </>
  ),
  expenses: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  payroll: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h4M7 13h10M7 16h6" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
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

/** Bottom tab bar on phones: first four sections + "More" for the rest. */
export function BottomNav({ items, label, moreLabel }: { items: NavItem[]; label: string; moreLabel: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const many = items.length > 5
  const primary = many ? items.slice(0, 4) : items
  const moreActive = many && items.slice(4).some((i) => isActive(pathname, i.href))
  const tab = (item: NavItem) => {
    const active = isActive(pathname, item.href)
    return (
      <li key={item.href} className="flex-1">
        <Link
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={active ? 'page' : undefined}
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 whitespace-nowrap px-1 text-[11px] font-medium ${active ? 'text-brand-deep' : 'text-muted'}`}
        >
          <span className={`rounded-full px-3 py-0.5 ${active ? 'bg-brand-soft' : ''}`}>
            <Icon name={item.icon} />
          </span>
          {item.label}
        </Link>
      </li>
    )
  }
  return (
    <nav aria-label={label} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {open && (
        <ul className="grid max-h-[60dvh] grid-cols-3 gap-1 overflow-y-auto border-b border-line p-2">
          {items.slice(4).map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium ${active ? 'bg-brand-soft text-brand-deep' : 'text-ink hover:bg-cream'}`}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <ul className="mx-auto flex max-w-2xl">
        {primary.map(tab)}
        {many && (
          <li className="flex-1">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${open || moreActive ? 'text-brand-deep' : 'text-muted'}`}
            >
              <span className={`rounded-full px-3 py-0.5 ${open || moreActive ? 'bg-brand-soft' : ''}`}>
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </span>
              {moreLabel}
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}

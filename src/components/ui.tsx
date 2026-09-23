import Link from 'next/link'

/** Shared presentational components. Logical CSS properties only (RTL/LTR safe). */

export function Card({ title, subtitle, actions, children, className = '' }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(46,35,32,0.05)] sm:p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
const badgeTone: Record<Tone, string> = {
  neutral: 'bg-cream text-muted border-line',
  brand: 'bg-brand-soft text-brand-deep border-brand/40',
  success: 'bg-success-soft text-success border-success/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${badgeTone[tone]}`}>{children}</span>
}

const alertTone = {
  info: 'bg-brand-soft text-ink border-brand/40',
  success: 'bg-success-soft text-success border-success/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  error: 'bg-danger-soft text-danger border-danger/30',
}

export function Alert({ tone = 'info', children, role }: { tone?: keyof typeof alertTone; children: React.ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : 'status')} className={`rounded-xl border px-3.5 py-2.5 text-sm ${alertTone[tone]}`}>
      {children}
    </div>
  )
}

export function EmptyState({ title, body, action }: { title?: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-cream/60 px-4 py-8 text-center">
      <span aria-hidden className="h-2 w-10 rounded-full bg-brand/50" />
      {title && <p className="font-semibold text-ink">{title}</p>}
      <p className="max-w-md text-sm text-muted">{body}</p>
      {action}
    </div>
  )
}

const buttonBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60'
export const buttonStyles = {
  primary: `${buttonBase} bg-brand-deep text-white hover:bg-[#6c4a43]`,
  secondary: `${buttonBase} border border-brand/60 bg-surface text-brand-deep hover:bg-brand-soft`,
  danger: `${buttonBase} border border-danger/40 bg-surface text-danger hover:bg-danger-soft`,
  ghost: `${buttonBase} text-brand-deep hover:bg-brand-soft`,
}

export function ButtonLink({ href, variant = 'primary', children }: { href: string; variant?: keyof typeof buttonStyles; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonStyles[variant]}>
      {children}
    </Link>
  )
}

export function DefinitionList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium text-muted">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-brand-soft/60 p-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

import Link from 'next/link'
import { nextMonth, previousMonth } from '@/domain/months'
import { buttonStyles } from './ui'
import { inputClass } from './form-styles'

/** Month navigation via ?month=YYYY-MM (works without JavaScript). */
export function MonthPicker({ path, month, labels }: { path: string; month: string; labels: { previous: string; next: string; apply: string; month: string } }) {
  return (
    <form className="flex flex-wrap items-end gap-2" action={path}>
      <Link href={`${path}?month=${previousMonth(month)}`} className={buttonStyles.secondary}>
        {labels.previous}
      </Link>
      <input type="month" name="month" defaultValue={month} className={`${inputClass} max-w-44`} dir="ltr" aria-label={labels.month} />
      <button type="submit" className={buttonStyles.secondary}>
        {labels.apply}
      </button>
      <Link href={`${path}?month=${nextMonth(month)}`} className={buttonStyles.secondary}>
        {labels.next}
      </Link>
    </form>
  )
}

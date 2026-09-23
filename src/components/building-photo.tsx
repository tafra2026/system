'use client'

import { useI18n } from './i18n-provider'

/** Photo of the customer's building from outside (private, permission-checked URL). */
export function BuildingPhoto({ url, compact }: { url: string; compact?: boolean }) {
  const { t } = useI18n()
  return (
    <figure className="mt-2">
      <a href={url} target="_blank" rel="noreferrer" title={t('photo.open')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={t('photo.alt')} loading="lazy" className={`w-full rounded-xl border border-line object-cover ${compact ? 'max-h-32' : 'max-h-56'}`} />
      </a>
      <figcaption className="mt-1 text-xs text-muted">{t('photo.caption')}</figcaption>
    </figure>
  )
}

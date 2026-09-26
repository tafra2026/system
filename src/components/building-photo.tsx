'use client'

import { useI18n } from './i18n-provider'

/**
 * Photo of the customer's building from outside (private, permission-checked URL). Shows the
 * small thumbnail when available (lazy-loaded) and opens the full image on tap.
 */
export function BuildingPhoto({ url, thumbUrl, compact }: { url: string; thumbUrl?: string | null; compact?: boolean }) {
  const { t } = useI18n()
  return (
    <figure className="mt-2">
      <a href={url} target="_blank" rel="noreferrer" title={t('photo.open')} aria-label={t('photo.open')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbUrl ?? url} alt={t('photo.alt')} loading="lazy" decoding="async" className={`w-full rounded-xl border border-line object-cover ${compact ? 'max-h-32' : 'max-h-56'}`} />
      </a>
      <figcaption className="mt-1 text-xs text-muted">{t('photo.caption')}</figcaption>
    </figure>
  )
}

import fs from 'node:fs'
import path from 'node:path'

const CANDIDATES = ['logo.svg', 'logo.png', 'logo.webp']

function findLogo(): string | null {
  for (const file of CANDIDATES) {
    if (fs.existsSync(path.join(process.cwd(), 'public', 'brand', file))) return `/brand/${file}`
  }
  return null
}

/**
 * The official logo, kept at its original proportions (fixed height, auto width).
 * Until the file is added to public/brand/, the plain brand name is shown instead —
 * deliberately NOT a re-drawn logo (see docs/DESIGN.md).
 */
export function BrandLogo({ height = 36, label }: { height?: number; label: string }) {
  const src = findLogo()
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={label} style={{ height, width: 'auto' }} />
  }
  return (
    <span className="ltr-data text-lg font-semibold tracking-wide text-brand-deep" style={{ lineHeight: `${height}px` }}>
      {label}
    </span>
  )
}

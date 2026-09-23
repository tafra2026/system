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
 * The supplied logo is cream (#FEF3E8) on transparent, so it must sit on the brand
 * colour (#AA8077) — callers place it inside a `bg-brand` area (see docs/DESIGN.md).
 * If the file is missing, the plain brand name is shown instead — never a re-drawn logo.
 */
export function BrandLogo({ height = 36, label }: { height?: number; label: string }) {
  const src = findLogo()
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={label} style={{ height, width: 'auto' }} />
  }
  return (
    <span className="ltr-data text-lg font-semibold tracking-wide text-cream" style={{ lineHeight: `${height}px` }}>
      {label}
    </span>
  )
}

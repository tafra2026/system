/**
 * Generates PWA icons into public/icons.
 * - If the official logo exists at public/brand/logo.(svg|png|webp), it is placed, unchanged
 *   and at its original proportions, on the cream background.
 * - Otherwise a TEMPORARY abstract placeholder (no letters) in the brand colours is produced.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const CREAM = '#FEF3E8'
const BRAND = '#AA8077'
const outDir = path.join(process.cwd(), 'public', 'icons')
const logo = ['logo.svg', 'logo.png', 'logo.webp'].map((f) => path.join(process.cwd(), 'public', 'brand', f)).find((f) => fs.existsSync(f))

function placeholderSvg(size: number, padding: number) {
  const r = (size / 2) * (1 - padding)
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="${CREAM}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${BRAND}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r * 0.42}" fill="${CREAM}"/>
    </svg>`,
  )
}

async function render(size: number, padding: number, file: string) {
  let image: ReturnType<typeof sharp>
  if (logo) {
    const inner = Math.round(size * (1 - padding * 2))
    const resized = await sharp(logo).resize(inner, inner, { fit: 'contain', background: CREAM }).png().toBuffer()
    image = sharp({ create: { width: size, height: size, channels: 4, background: CREAM } }).composite([{ input: resized, gravity: 'center' }])
  } else {
    image = sharp(placeholderSvg(size, padding))
  }
  await image.png().toFile(path.join(outDir, file))
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  await render(192, 0.1, 'icon-192.png')
  await render(512, 0.1, 'icon-512.png')
  await render(512, 0.22, 'icon-maskable-512.png') // safe zone for masked icons
  await render(180, 0.1, 'apple-touch-icon.png')
  await render(48, 0.06, 'favicon-48.png')
  console.log(logo ? `Icons generated from ${path.basename(logo)}.` : 'No logo found: generated TEMPORARY placeholder icons.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans_Arabic } from 'next/font/google'
import { directionOf, getDictionary } from '@/i18n'
import { getRequestLocale } from '@/server/auth/current'
import { I18nProvider } from '@/components/i18n-provider'
import { OfflineBanner } from '@/components/online-status'
import { ServiceWorkerRegister } from '@/components/sw-register'
import './globals.css'

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Pamper Me', template: '%s · Pamper Me' },
  description: 'Pamper Me Home Service — internal management',
  applicationName: 'Pamper Me',
  appleWebApp: { capable: true, title: 'Pamper Me', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  themeColor: '#FEF3E8',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale()
  return (
    <html lang={locale} dir={directionOf(locale)} className={plexArabic.variable}>
      <body>
        <I18nProvider locale={locale} dictionary={getDictionary(locale)}>
          <OfflineBanner />
          {children}
          <ServiceWorkerRegister />
        </I18nProvider>
      </body>
    </html>
  )
}

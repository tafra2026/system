'use client'

import { createContext, useContext, useMemo } from 'react'
import { interpolate } from '@/i18n'
import type { Dictionary, Locale, MessageKey, Translate } from '@/i18n/types'

interface I18nValue {
  locale: Locale
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

function lookup(dict: Dictionary, key: string): string | undefined {
  const parts = key.split('.')
  let node: unknown = dict
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== 'object') return undefined
    const obj = node as Record<string, unknown>
    const rest = parts.slice(i).join('.')
    if (typeof obj[rest] === 'string') return obj[rest] as string
    node = obj[parts[i]!]
  }
  return typeof node === 'string' ? node : undefined
}

export function I18nProvider({ locale, dictionary, children }: { locale: Locale; dictionary: Dictionary; children: React.ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: (key: MessageKey, params?: Record<string, string | number>) => {
        const template = lookup(dictionary, key)
        return template === undefined ? key : interpolate(template, params)
      },
    }),
    [locale, dictionary],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}

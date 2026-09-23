import ar from './dictionaries/ar'
import en from './dictionaries/en'
import type { Dictionary, Locale, MessageKey, Translate, TranslateParams } from './types'

export type { Dictionary, Locale, MessageKey, Translate }

export const LOCALES: readonly Locale[] = ['ar', 'en']
export const DEFAULT_LOCALE: Locale = 'ar'

const dictionaries: Record<Locale, Dictionary> = { ar, en }

export function isLocale(value: unknown): value is Locale {
  return value === 'ar' || value === 'en'
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale]
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

function lookup(dict: Dictionary, key: string): string | undefined {
  // Keys like "audit.actions.salary.change" contain dots inside the last segment:
  // walk the tree greedily, falling back to joining the remaining segments.
  const parts = key.split('.')
  let node: unknown = dict
  for (let i = 0; i < parts.length; i++) {
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      const rest = parts.slice(i).join('.')
      if (typeof obj[rest] === 'string') return obj[rest] as string
      node = obj[parts[i]!]
    } else {
      return undefined
    }
  }
  return typeof node === 'string' ? node : undefined
}

export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

export function createTranslator(locale: Locale): Translate {
  const dict = dictionaries[locale]
  return (key: MessageKey, params?: TranslateParams) => {
    const template = lookup(dict, key)
    // A missing key is a bug caught by tests; never fall back to the other language silently.
    return template === undefined ? key : interpolate(template, params)
  }
}

/** Translate an error code from the server (unknown codes map to the generic message). */
export function translateError(t: Translate, code: string | undefined | null, params?: TranslateParams): string {
  if (!code) return t('errors.generic')
  const key = `errors.${code}` as MessageKey
  const text = t(key, params)
  return text === key ? t('errors.generic') : text
}

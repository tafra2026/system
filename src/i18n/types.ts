import type ar from './dictionaries/ar'

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> }

/** Every language must provide exactly the keys of the Arabic dictionary. */
export type Dictionary = Widen<typeof ar>
export type Locale = 'ar' | 'en'

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Paths<T> = T extends string ? never : { [K in keyof T & string]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T & string]

/** Dotted key of any message, e.g. "staff.title" or "audit.actions.salary.change". */
export type MessageKey = Paths<Dictionary>
export type TranslateParams = Record<string, string | number>
export type Translate = (key: MessageKey, params?: TranslateParams) => string

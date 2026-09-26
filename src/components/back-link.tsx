'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const key = (href: string) => `pm:list:${href}`

/** Put on a list page: remembers its current URL (with filters) for the "back" link. */
export function RememberListUrl({ href }: { href: string }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(key(href), window.location.pathname + window.location.search)
    } catch {
      // storage unavailable (private mode): the back link falls back to the plain list
    }
  })
  return null
}

/** "Back" to the list with the filters the user had, when known. */
export function BackLink({ href, label }: { href: string; label: string }) {
  const [target, setTarget] = useState(href)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key(href))
      if (saved && saved.startsWith(href)) setTarget(saved)
    } catch {
      // ignore
    }
  }, [href])
  return (
    <Link href={target} className="text-sm font-medium text-brand-deep hover:underline">
      {label}
    </Link>
  )
}

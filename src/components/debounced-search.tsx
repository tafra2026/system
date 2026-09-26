'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { inputClass } from './form-styles'

/** Search box that updates the URL (and the server results) 350 ms after typing stops. */
export function DebouncedSearch({ name = 'q', label, placeholder, defaultValue }: { name?: string; label: string; placeholder?: string; defaultValue?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(defaultValue ?? '')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = window.setTimeout(() => {
      const sp = new URLSearchParams(params.toString())
      if (value.trim()) sp.set(name, value.trim())
      else sp.delete(name)
      sp.delete('page')
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    }, 350)
    return () => window.clearTimeout(id)
    // Only typing triggers a search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-ink">
      {label}
      <input name={name} value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} placeholder={placeholder} inputMode="search" dir="auto" autoComplete="off" />
    </label>
  )
}

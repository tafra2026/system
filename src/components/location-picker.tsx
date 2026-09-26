'use client'

import { useEffect, useRef, useState } from 'react'
import { resolveLocationAction } from '@/app/(app)/customers/actions'
import { useI18n } from './i18n-provider'
import { useMapsKey } from './maps-key'
import { inputClass } from './form-styles'
import { buttonStyles } from './ui'

/** Minimal typing of the Google Maps JS API parts used here (no extra dependency). */
interface LatLngLiteral {
  lat: number
  lng: number
}
interface GMap {
  setCenter(p: LatLngLiteral): void
  setZoom(z: number): void
  addListener(ev: 'click', fn: (e: { latLng: { lat(): number; lng(): number } | null }) => void): void
}
interface GMarker {
  setPosition(p: LatLngLiteral | null): void
  setMap(m: GMap | null): void
  addListener(ev: 'dragend', fn: (e: { latLng: { lat(): number; lng(): number } | null }) => void): void
}
interface GMaps {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap
  Marker: new (opts: Record<string, unknown>) => GMarker
}

const JEDDAH: LatLngLiteral = { lat: 21.5433, lng: 39.1728 }
let loading: Promise<GMaps> | null = null

/** Load the Maps JavaScript API once, only on pages that show a map. */
function loadGoogleMaps(key: string, language: string): Promise<GMaps> {
  const w = window as unknown as { google?: { maps?: GMaps }; __pmMapsReady?: () => void }
  if (w.google?.maps?.Map) return Promise.resolve(w.google.maps)
  loading ??= new Promise<GMaps>((resolve, reject) => {
    w.__pmMapsReady = () => (w.google?.maps ? resolve(w.google.maps) : reject(new Error('maps')))
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&language=${language}&region=SA&callback=__pmMapsReady`
    s.async = true
    s.onerror = () => {
      loading = null
      reject(new Error('maps'))
    }
    document.head.appendChild(s)
  })
  return loading
}

function fmt(p: LatLngLiteral) {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
}

/**
 * Pick the customer's location: paste coordinates or a Google Maps link, or tap/drag the pin
 * on a Google map. The value submitted in `name` is "lat, lng" or empty — the map's starting
 * view (Jeddah) is never saved as the customer's address.
 */
export function LocationPicker({ name, defaultValue, error }: { name: string; defaultValue?: string | null; error?: string }) {
  const { t, locale } = useI18n()
  const key = useMapsKey()
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GMap | null>(null)
  const markerRef = useRef<GMarker | null>(null)
  const initial = parse(defaultValue)
  const [pin, setPin] = useState<LatLngLiteral | null>(initial)
  const [text, setText] = useState(defaultValue ?? '')
  const [status, setStatus] = useState<'idle' | 'resolving' | 'unresolved' | 'map_error'>('idle')
  const [showMap, setShowMap] = useState(false)

  useEffect(() => {
    if (!showMap || !key || !box.current) return
    let cancelled = false
    loadGoogleMaps(key, locale)
      .then((g) => {
        if (cancelled || !box.current) return
        const map = new g.Map(box.current, { center: pin ?? JEDDAH, zoom: pin ? 17 : 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy' })
        const marker = new g.Marker({ map: pin ? map : null, position: pin, draggable: true })
        const place = (p: LatLngLiteral) => {
          marker.setPosition(p)
          marker.setMap(map)
          setPin(p)
          setText(fmt(p))
        }
        map.addListener('click', (e) => e.latLng && place({ lat: e.latLng.lat(), lng: e.latLng.lng() }))
        marker.addListener('dragend', (e) => e.latLng && place({ lat: e.latLng.lat(), lng: e.latLng.lng() }))
        mapRef.current = map
        markerRef.current = marker
      })
      .catch(() => setStatus('map_error'))
    return () => {
      cancelled = true
    }
    // The map is created once per opening; later pin changes move the marker directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMap, key])

  const applyPin = (p: LatLngLiteral) => {
    setPin(p)
    setText(fmt(p))
    if (mapRef.current && markerRef.current) {
      markerRef.current.setPosition(p)
      markerRef.current.setMap(mapRef.current)
      mapRef.current.setCenter(p)
      mapRef.current.setZoom(17)
    }
  }

  const resolve = async () => {
    const direct = parse(text)
    if (direct) return applyPin(direct)
    if (!text.trim()) return
    setStatus('resolving')
    const r = await resolveLocationAction(text)
    if (r.ok && r.data) {
      setStatus('idle')
      applyPin({ lat: r.data.latitude, lng: r.data.longitude })
    } else {
      setStatus('unresolved')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={pin ? fmt(pin) : ''} />
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setStatus('idle')
          }}
          onBlur={() => {
            const direct = parse(text)
            if (direct) applyPin(direct)
          }}
          aria-label={t('customers.location')}
          placeholder={t('map.pastePlaceholder')}
          className={`${inputClass} min-w-0 flex-1`}
          dir="ltr"
        />
        <button type="button" className={buttonStyles.secondary} onClick={resolve} disabled={status === 'resolving'}>
          {t('map.locate')}
        </button>
      </div>
      {status === 'unresolved' && <p className="text-sm text-warning">{t('map.unresolved')}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {key ? (
        showMap ? (
          <>
            <div ref={box} className="h-72 w-full overflow-hidden rounded-xl border border-line bg-cream" role="application" aria-label={t('map.label')} />
            <p className="text-xs text-muted">{t('map.tapHint')}</p>
            {status === 'map_error' && <p className="text-sm text-warning">{t('map.loadError')}</p>}
          </>
        ) : (
          <div>
            <button type="button" className={buttonStyles.secondary} onClick={() => setShowMap(true)}>
              {pin ? t('map.adjustPin') : t('map.pickOnMap')}
            </button>
          </div>
        )
      ) : (
        <p className="text-xs text-muted">{t('map.noKey')}</p>
      )}
      {pin && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="ltr-data">{fmt(pin)}</span>
          <a href={`https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`} target="_blank" rel="noreferrer" className="font-medium text-brand-deep underline">
            {t('map.openInGoogle')}
          </a>
          <button type="button" className="underline" onClick={() => {
            setPin(null)
            setText('')
            markerRef.current?.setMap(null)
          }}>
            {t('map.clear')}
          </button>
        </p>
      )}
    </div>
  )
}

function parse(v: string | null | undefined): LatLngLiteral | null {
  const m = v?.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { translateError } from '@/i18n'
import { BuildingPhoto } from './building-photo'
import { useI18n } from './i18n-provider'
import { useOnline } from './online-status'
import { buttonStyles } from './ui'

/** Shrink on the phone before upload (max 2000px JPEG) so it is fast on mobile data. */
async function shrink(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88))
  } catch {
    return null // e.g. HEIC on a browser that cannot decode it: send the original, the server explains
  }
}

type Phase = { kind: 'idle' } | { kind: 'preview'; file: File; previewUrl: string } | { kind: 'uploading'; file: File; previewUrl: string; progress: number } | { kind: 'error'; file: File; previewUrl: string; message: string }

/**
 * Building entrance photo. The main button opens the photo library / files (no forced camera);
 * taking a new photo is a separate, optional button. Preview → save with progress → retry.
 */
export function AddressPhotoUpload({ addressId, photoUrl, onChanged }: { addressId: string; photoUrl: string | null; onChanged?: (url: string | null) => void }) {
  const { t } = useI18n()
  const router = useRouter()
  const online = useOnline()
  const gallery = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(photoUrl)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [removing, setRemoving] = useState(false)

  useEffect(() => () => {
    if (phase.kind !== 'idle') URL.revokeObjectURL(phase.previewUrl)
  }, [phase])

  const choose = (file: File | undefined) => {
    if (!file) return
    setPhase({ kind: 'preview', file, previewUrl: URL.createObjectURL(file) })
    if (gallery.current) gallery.current.value = ''
    if (camera.current) camera.current.value = ''
  }

  const upload = async (file: File, previewUrl: string) => {
    setPhase({ kind: 'uploading', file, previewUrl, progress: 0 })
    const blob = (await shrink(file)) ?? file
    const body = new FormData()
    body.append('photo', blob, blob === file ? file.name : 'building.jpg')
    // XHR (not fetch) to show real upload progress on slow mobile connections.
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/addresses/${addressId}/photo`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setPhase({ kind: 'uploading', file, previewUrl, progress: Math.round((e.loaded / e.total) * 100) })
    }
    xhr.onerror = () => setPhase({ kind: 'error', file, previewUrl, message: t('errors.offline') })
    xhr.onload = () => {
      let data: { url?: string; error?: string; fields?: Record<string, string> } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        data = {}
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        setUrl(`${data.url}?v=${Date.now()}`)
        onChanged?.(data.url)
        setPhase({ kind: 'idle' })
        router.refresh()
      } else {
        setPhase({ kind: 'error', file, previewUrl, message: translateError(t, data.fields?.photo ?? data.error) })
      }
    }
    xhr.send(body)
  }

  const remove = async () => {
    setRemoving(true)
    const res = await fetch(`/api/addresses/${addressId}/photo`, { method: 'DELETE' })
    setRemoving(false)
    if (res.ok) {
      setUrl(null)
      onChanged?.(null)
      router.refresh()
    }
  }

  const busy = phase.kind === 'uploading' || removing
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`photo-${addressId}`}>
      <p id={`photo-${addressId}`} className="text-sm font-medium text-ink">
        {t('photo.title')}
      </p>
      <p className="text-xs text-muted">{t('photo.hint')}</p>
      {phase.kind === 'idle' && url && <BuildingPhoto url={url} compact />}
      {phase.kind !== 'idle' && (
        <figure className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.previewUrl} alt={t('photo.previewAlt')} className="max-h-56 w-full rounded-xl border border-line object-contain" />
          {phase.kind === 'uploading' && (
            <div className="flex items-center gap-2 text-xs text-muted" role="status">
              <progress max={100} value={phase.progress} className="h-2 flex-1 accent-[var(--color-brand-deep)]" aria-label={t('photo.uploading')} />
              <span className="ltr-data">{phase.progress}%</span>
            </div>
          )}
          {phase.kind === 'error' && (
            <p role="alert" className="text-xs font-medium text-danger">
              {phase.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonStyles.primary} disabled={busy || !online} onClick={() => upload(phase.file, phase.previewUrl)}>
              {phase.kind === 'uploading' ? t('photo.uploading') : phase.kind === 'error' ? t('photo.retry') : t('photo.save')}
            </button>
            <button type="button" className={buttonStyles.ghost} disabled={busy} onClick={() => setPhase({ kind: 'idle' })}>
              {t('common.cancel')}
            </button>
          </div>
        </figure>
      )}
      {/* Library/files: no `capture`, so phones offer the photo library instead of forcing the camera. */}
      <input ref={gallery} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => choose(e.target.files?.[0])} />
      {phase.kind === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonStyles.secondary} disabled={busy || !online} onClick={() => gallery.current?.click()}>
            {url ? t('photo.replace') : t('photo.fromGallery')}
          </button>
          <button type="button" className={buttonStyles.ghost} disabled={busy || !online} onClick={() => camera.current?.click()}>
            {t('photo.takePhoto')}
          </button>
          {url && (
            <button type="button" className={buttonStyles.ghost} disabled={busy || !online} onClick={remove}>
              {t('photo.remove')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

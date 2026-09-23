'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { translateError } from '@/i18n'
import { BuildingPhoto } from './building-photo'
import { useI18n } from './i18n-provider'
import { useOnline } from './online-status'
import { buttonStyles } from './ui'

/** Shrink on the phone before upload (max 1600px JPEG) so it is fast on mobile data. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85))
  } catch {
    return file
  }
}

export function AddressPhotoUpload({ addressId, photoUrl, onChanged }: { addressId: string; photoUrl: string | null; onChanged?: (url: string | null) => void }) {
  const { t } = useI18n()
  const router = useRouter()
  const online = useOnline()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(photoUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('photo', await shrink(file), 'building.jpg')
      const res = await fetch(`/api/addresses/${addressId}/photo`, { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; fields?: Record<string, string> }
      if (!res.ok || !data.url) {
        setError(translateError(t, data.fields?.photo ?? data.error))
        return
      }
      setUrl(`${data.url}?v=${Date.now()}`)
      onChanged?.(data.url)
      router.refresh()
    } catch {
      setError(t('errors.offline'))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const remove = async () => {
    setBusy(true)
    const res = await fetch(`/api/addresses/${addressId}/photo`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      setUrl(null)
      onChanged?.(null)
      router.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-ink">{t('photo.title')}</p>
      <p className="text-xs text-muted">{t('photo.hint')}</p>
      {url && <BuildingPhoto url={url} compact />}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonStyles.secondary} disabled={busy || !online} onClick={() => input.current?.click()}>
          {busy ? t('photo.uploading') : url ? t('photo.replace') : t('photo.upload')}
        </button>
        {url && (
          <button type="button" className={buttonStyles.ghost} disabled={busy || !online} onClick={remove}>
            {t('photo.remove')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

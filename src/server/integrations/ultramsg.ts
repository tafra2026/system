import 'server-only'

/**
 * UltraMsg — sends WhatsApp text messages from the business's own WhatsApp number, which is
 * linked to UltraMsg by scanning a QR code (an UNOFFICIAL, WhatsApp-Web-based service chosen by
 * management, who accepted the risk that WhatsApp may restrict the number — docs/DECISIONS.md D81).
 *
 * Configuration (server environment only, never in git):
 *   ULTRAMSG_INSTANCE_ID  e.g. "instance12345" (or just "12345")
 *   ULTRAMSG_TOKEN        the instance token
 *
 * API: POST https://api.ultramsg.com/{instance}/messages/chat (form fields: token, to, body,
 * priority, referenceId). A successful answer means UltraMsg queued the message; it is not a
 * delivery or read receipt.
 */

export function ultramsgInstance(): string | null {
  const raw = process.env.ULTRAMSG_INSTANCE_ID?.trim()
  if (!raw || !/^(instance)?\d+$/.test(raw)) return null
  return raw.startsWith('instance') ? raw : `instance${raw}`
}

export function ultramsgConfigured(): boolean {
  return !!(ultramsgInstance() && process.env.ULTRAMSG_TOKEN?.trim())
}

export type SendResult =
  | { ok: true; providerId: string }
  /**
   * `unknown`: the request may have reached UltraMsg (timeout / cut connection) — it may have been
   * sent, so it is never retried automatically. `rejected`/`network`: certainly not sent.
   */
  | { ok: false; code: 'unknown' | 'rejected' | 'network' | 'not_configured'; detail?: string }

export type UltraMsgTransport = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; text: () => Promise<string> }>

const realTransport: UltraMsgTransport = (url, init) => fetch(url, init)
let transport: UltraMsgTransport = realTransport

/** TESTS ONLY — development mock: never contacts UltraMsg or WhatsApp. */
export function useMockUltraMsgTransportForTests(mock: UltraMsgTransport | null) {
  transport = mock ?? realTransport
}

/** Short, safe error text (no token, no phone number, no message body). */
function cleanDetail(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
  return text
    .replace(/token[^,}\]]*/gi, 'token=…')
    .replace(/\+?\d{7,}/g, '…')
    .slice(0, 160)
}

export async function sendWhatsAppText(toE164: string, body: string, referenceId: string, timeoutMs = 20_000): Promise<SendResult> {
  const instance = ultramsgInstance()
  const token = process.env.ULTRAMSG_TOKEN?.trim()
  if (!instance || !token) return { ok: false, code: 'not_configured' }
  const form = new URLSearchParams({ token, to: toE164, body, priority: '10', referenceId })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await transport(`https://api.ultramsg.com/${instance}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    })
    const raw = await res.text()
    let data: { sent?: unknown; id?: unknown; error?: unknown; message?: unknown } = {}
    try {
      data = JSON.parse(raw)
    } catch {
      // Not JSON: treated below as an unclear answer.
    }
    if (res.status >= 200 && res.status < 300 && (data.sent === true || data.sent === 'true')) return { ok: true, providerId: String(data.id ?? '') }
    if (data.error != null) return { ok: false, code: 'rejected', detail: cleanDetail(data.error) }
    if (res.status >= 400 && res.status < 500) return { ok: false, code: 'rejected', detail: `HTTP ${res.status}` }
    // 5xx or an answer we do not understand: it may or may not have been queued.
    return { ok: false, code: 'unknown', detail: `HTTP ${res.status}` }
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, code: 'unknown', detail: 'timeout' }
    // Only failures before any connection are certainly "not sent"; anything else may have been.
    const code = (err as { cause?: { code?: string } })?.cause?.code
    if (code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) return { ok: false, code: 'network', detail: code }
    return { ok: false, code: 'unknown', detail: code ?? 'connection error' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * WhatsApp message preparation (spec §13). The app only PREPARES a message and opens the
 * customer's chat; the staff member presses send inside WhatsApp from her own device.
 * Nothing here sends anything, and "sent" only ever means "a staff member confirmed it".
 */

export const MESSAGE_KINDS = ['booking_confirmation', 'visit_reminder', 'on_the_way', 'review_request'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]
export type MessageLocale = 'ar' | 'en'

/** Reminder is due this long before each visit (spec §13: three hours). */
export const REMINDER_LEAD_MINUTES = 180

/**
 * When the reminder of a visit becomes due. A booking made less than three hours ahead gets
 * one immediate reminder (due now). No reminder for a visit that has already started.
 */
export function reminderDueAt(startsAt: Date, now: Date): Date | null {
  if (startsAt.getTime() <= now.getTime()) return null
  const due = startsAt.getTime() - REMINDER_LEAD_MINUTES * 60_000
  return new Date(Math.max(due, now.getTime()))
}

/** Placeholders a template may use. Unknown `{words}` are left as typed. */
export const MESSAGE_PLACEHOLDERS = [
  'customer_name',
  'order_ref',
  'date',
  'time',
  'services',
  'total',
  'paid',
  'remaining',
  'arrival_time',
  'review_link',
] as const
export type MessagePlaceholder = (typeof MESSAGE_PLACEHOLDERS)[number]
export type MessageValues = Partial<Record<MessagePlaceholder, string>>

/** Default wording (Saudi, friendly). Management can override each one in Settings. */
export const DEFAULT_MESSAGE_TEMPLATES: Record<MessageKind, Record<MessageLocale, string>> = {
  booking_confirmation: {
    ar: [
      'أهلًا {customer_name} 🌸',
      'تم تأكيد حجزك مع Pamper Me Home Service ✨',
      'رقم الطلب: {order_ref}',
      'الموعد: {date} الساعة {time}',
      'الخدمات: {services}',
      'الإجمالي: {total}',
      'المدفوع: {paid}',
      'المتبقي: {remaining}',
      'نتشرف بخدمتك، وأي استفسار حنا حاضرين 💕',
    ].join('\n'),
    en: [
      'Hello {customer_name} 🌸',
      'Your booking with Pamper Me Home Service is confirmed ✨',
      'Order number: {order_ref}',
      'Appointment: {date} at {time}',
      'Services: {services}',
      'Total: {total}',
      'Paid: {paid}',
      'Remaining: {remaining}',
      'We look forward to pampering you 💕',
    ].join('\n'),
  },
  visit_reminder: {
    ar: [
      'هلا {customer_name} 🌸',
      'قرب موعدك مع الدلال والراحة ✨',
      'موعدك مع Pamper Me: {date} الساعة {time}',
      'رقم الطلب: {order_ref}',
      'الخدمات: {services}',
      'المتبقي: {remaining}',
      'بانتظارك 💕',
    ].join('\n'),
    en: [
      'Hi {customer_name} 🌸',
      'Your pampering time is almost here ✨',
      'Your Pamper Me appointment: {date} at {time}',
      'Order number: {order_ref}',
      'Services: {services}',
      'Remaining: {remaining}',
      'See you soon 💕',
    ].join('\n'),
  },
  on_the_way: {
    ar: [
      'هلا {customer_name} 🌸',
      'فريق Pamper Me في الطريق لك الحين 🚗',
      'الوصول المتوقع تقريبًا الساعة {arrival_time}',
      'رقم الطلب: {order_ref}',
      'المتبقي: {remaining}',
    ].join('\n'),
    en: [
      'Hi {customer_name} 🌸',
      'The Pamper Me team is on the way to you now 🚗',
      'Expected arrival around {arrival_time}',
      'Order number: {order_ref}',
      'Remaining: {remaining}',
    ].join('\n'),
  },
  review_request: {
    ar: [
      'هلا {customer_name} 🌸',
      'نتمنى إن تجربتك مع Pamper Me كانت على قد توقعاتك وأكثر ✨',
      'رأيك يهمنا ويساعدنا نتطور: {review_link}',
      'شكرًا لثقتك فينا 💕',
    ].join('\n'),
    en: [
      'Hi {customer_name} 🌸',
      'We hope you loved your Pamper Me experience ✨',
      'We would love to hear your feedback: {review_link}',
      'Thank you for trusting us 💕',
    ].join('\n'),
  },
}

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g

function isKnown(name: string): name is MessagePlaceholder {
  return (MESSAGE_PLACEHOLDERS as readonly string[]).includes(name)
}

/**
 * Fill a template. A line that uses a known placeholder with no value (e.g. no review link,
 * no scheduled time yet) is dropped entirely instead of leaving "Remaining: " half-empty.
 */
export function renderMessage(template: string, values: MessageValues): string {
  const lines: string[] = []
  for (const line of template.replace(/\r\n/g, '\n').split('\n')) {
    let missing = false
    const out = line.replace(PLACEHOLDER_RE, (whole, name: string) => {
      if (!isKnown(name)) return whole
      const v = values[name]?.trim()
      if (!v) {
        missing = true
        return ''
      }
      return v
    })
    if (!missing) lines.push(out)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Placeholders a template uses that are not supported (shown as a warning in Settings). */
export function unknownPlaceholders(template: string): string[] {
  const found = new Set<string>()
  for (const m of template.matchAll(PLACEHOLDER_RE)) if (!isKnown(m[1]!)) found.add(m[1]!)
  return [...found]
}

/** https://wa.me/<digits>?text=<url-encoded text>. Opens the chat; it never sends. */
export function whatsappChatLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

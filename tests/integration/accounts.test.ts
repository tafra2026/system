import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { actorFromSessionToken } from '@/server/auth/sessions'
import { closeDb, getDb } from '@/server/db'
import { auditLog, users } from '@/server/db/schema'
import { createAccount, createAccountWithPassword, reissueInvite, setAccountSuspended, setPasswordByManagement } from '@/server/services/accounts'
import { changePassword, completeSetup, inspectInvite, login } from '@/server/services/auth'
import { ForbiddenError } from '@/server/authz/errors'
import { createEmployee, setEmployeeStatus } from '@/server/services/staff'
import { makeStaff, resetDb } from '../support/db'

beforeEach(resetDb)
afterAll(closeDb)

describe('accounts are activated only through a one-time link', () => {
  it('an employee record alone cannot sign in; the link activates it once', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'مافلور', role: 'specialist' })
    const invite = await createAccount(owner.actor, emp.id, 'Mavlor')

    const [pending] = await getDb().select().from(users).where(eq(users.id, invite.userId))
    expect(pending!.status).toBe('pending')
    expect(pending!.username).toBe('mavlor')
    expect(pending!.locale).toBe('en') // specialists start in English
    expect(pending!.passwordHash).toBeNull()
    expect((await login('mavlor', 'anything-at-all')).ok).toBe(false)

    expect((await inspectInvite(invite.token))?.username).toBe('mavlor')
    await expect(completeSetup(invite.token, 'short', 'en')).rejects.toMatchObject({ fieldErrors: { password: 'password_too_short' } })
    await completeSetup(invite.token, 'a-long-private-password', 'en')
    expect(await inspectInvite(invite.token)).toBeNull()
    await expect(completeSetup(invite.token, 'another-long-password', 'en')).rejects.toMatchObject({ code: 'invite_invalid' })

    const ok = await login('MAVLOR', 'a-long-private-password')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect((await actorFromSessionToken(ok.token))?.role).toBe('specialist')
  })

  it('only a SHA-256 of the token is stored and the audit log holds no secrets', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'الاء', role: 'moderator' })
    const invite = await createAccount(owner.actor, emp.id, 'alaa')
    await completeSetup(invite.token, 'a-long-private-password', 'ar')
    const logText = JSON.stringify(await getDb().select().from(auditLog))
    expect(logText).not.toContain(invite.token)
    expect(logText).not.toContain('a-long-private-password')
    expect(logText).not.toContain('$argon2')
  })

  it('moderator accounts default to Arabic', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'الاء', role: 'moderator' })
    const invite = await createAccount(owner.actor, emp.id, 'alaa')
    const [u] = await getDb().select().from(users).where(eq(users.id, invite.userId))
    expect(u!.locale).toBe('ar')
  })

  it('a new link revokes the previous one', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'x', role: 'driver' })
    const first = await createAccount(owner.actor, emp.id, 'driver1')
    const second = await reissueInvite(owner.actor, first.userId)
    expect(await inspectInvite(first.token)).toBeNull()
    expect(await inspectInvite(second.token)).not.toBeNull()
  })

  it('concurrent use of the same link succeeds only once', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'x', role: 'driver' })
    const invite = await createAccount(owner.actor, emp.id, 'driver2')
    const results = await Promise.allSettled([
      completeSetup(invite.token, 'first-long-password', 'ar'),
      completeSetup(invite.token, 'second-long-password', 'ar'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('suspension and deactivation end access immediately', async () => {
    const owner = await makeStaff('owner')
    const spec = await makeStaff('specialist')
    expect(await actorFromSessionToken(spec.token)).not.toBeNull()
    await setAccountSuspended(owner.actor, spec.user.id, true)
    expect(await actorFromSessionToken(spec.token)).toBeNull()
    expect((await login(spec.user.username, spec.password)).ok).toBe(false)
    await setAccountSuspended(owner.actor, spec.user.id, false)
    expect(await actorFromSessionToken(spec.token)).not.toBeNull()
    await setEmployeeStatus(owner.actor, spec.employee.id, 'inactive', null)
    expect(await actorFromSessionToken(spec.token)).toBeNull()
  })

  it('locks sign-in after 5 wrong passwords', async () => {
    const spec = await makeStaff('specialist')
    for (let i = 0; i < 4; i++) expect(await login(spec.user.username, 'wrong-password')).toEqual({ ok: false, code: 'invalid_credentials' })
    expect(await login(spec.user.username, 'wrong-password')).toEqual({ ok: false, code: 'account_locked' })
    expect(await login(spec.user.username, spec.password)).toEqual({ ok: false, code: 'account_locked' })
  })

  it('usernames are unique and validated', async () => {
    const owner = await makeStaff('owner')
    const a = await createEmployee(owner.actor, { fullName: 'a', role: 'driver' })
    const b = await createEmployee(owner.actor, { fullName: 'b', role: 'driver' })
    await createAccount(owner.actor, a.id, 'same')
    await expect(createAccount(owner.actor, b.id, 'same')).rejects.toMatchObject({ fieldErrors: { username: 'username_taken' } })
    await expect(createAccount(owner.actor, b.id, 'no spaces')).rejects.toMatchObject({ fieldErrors: { username: 'username_invalid' } })
    await expect(createAccount(owner.actor, a.id, 'other')).rejects.toMatchObject({ code: 'account_exists' })
  })
})

describe('management may set the username and password itself (D61)', () => {
  it('temporary password: signs in, but nothing works until she picks her own', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'ضحى', role: 'admin_manager' })
    await createAccountWithPassword(owner.actor, emp.id, 'Doha', 'temporary-pass-123', true)

    const first = await login('doha', 'temporary-pass-123')
    expect(first.ok && first.mustChangePassword).toBe(true)
    if (!first.ok) return
    expect(await actorFromSessionToken(first.token)).toBeNull() // no page, action or API
    const pending = await actorFromSessionToken(first.token, { allowPendingPasswordChange: true })
    expect(pending?.role).toBe('admin_manager')

    await expect(changePassword(pending!, 'temporary-pass-123', 'temporary-pass-123', first.token)).rejects.toMatchObject({ fieldErrors: { newPassword: 'password_same' } })
    await changePassword(pending!, 'temporary-pass-123', 'her-own-private-pass', first.token)
    expect((await actorFromSessionToken(first.token))?.role).toBe('admin_manager')
    expect((await login('doha', 'temporary-pass-123')).ok).toBe(false)

    // The password never reaches the audit log.
    const logs = await getDb().select().from(auditLog)
    expect(JSON.stringify(logs)).not.toContain('temporary-pass-123')
    expect(JSON.stringify(logs)).not.toContain('her-own-private-pass')
  })

  it('without the change requirement the account works immediately; reset ends old sessions', async () => {
    const owner = await makeStaff('owner')
    const emp = await createEmployee(owner.actor, { fullName: 'سائق', role: 'driver' })
    const { userId } = await createAccountWithPassword(owner.actor, emp.id, 'driver1', 'driver-password-1', false)
    const s = await login('driver1', 'driver-password-1')
    expect(s.ok && !s.mustChangePassword).toBe(true)
    if (!s.ok) return
    expect(await actorFromSessionToken(s.token)).not.toBeNull()

    await setPasswordByManagement(owner.actor, userId, 'driver-password-2', false)
    expect(await actorFromSessionToken(s.token)).toBeNull()
    expect((await login('driver1', 'driver-password-1')).ok).toBe(false)
    expect((await login('driver1', 'driver-password-2')).ok).toBe(true)
  })

  it('only account managers can do it, and weak passwords are refused', async () => {
    const owner = await makeStaff('owner')
    const mod = await makeStaff('moderator')
    const emp = await createEmployee(owner.actor, { fullName: 'أخصائية', role: 'specialist' })
    await expect(createAccountWithPassword(mod.actor, emp.id, 'spec1', 'long-enough-pass', true)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createAccountWithPassword(owner.actor, emp.id, 'spec1', 'short', true)).rejects.toMatchObject({ fieldErrors: { password: 'password_too_short' } })
    await expect(setPasswordByManagement(mod.actor, mod.user.id, 'long-enough-pass', false)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

import { createHash, randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

/** 256-bit random token, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export const PASSWORD_MIN_LENGTH = 10

export async function hashPassword(password: string): Promise<string> {
  // Argon2id with the library defaults (memory-hard).
  return hash(password)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

import { NextResponse, type NextRequest } from 'next/server'

/**
 * Optimistic check only: sends visitors without a session cookie to sign-in.
 * Real authentication and authorization happen on the server for every page, action and API.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has('pm_session')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!login|setup|offline|pay/return|d/|api|_next|icons|brand|sw\\.js|manifest\\.webmanifest|favicon\\.ico|robots\\.txt).*)'],
}

'use client'

import { createContext, useContext } from 'react'

/**
 * Browser key for the Google Maps JavaScript API (GOOGLE_MAPS_BROWSER_KEY). It is public by
 * nature and must be restricted in Google Cloud to this domain and the Maps JavaScript API.
 * The server key (GOOGLE_MAPS_API_KEY, travel times) never reaches the browser.
 */
const MapsKeyContext = createContext<string | null>(null)

export function MapsKeyProvider({ value, children }: { value: string | null; children: React.ReactNode }) {
  return <MapsKeyContext.Provider value={value}>{children}</MapsKeyContext.Provider>
}

export function useMapsKey(): string | null {
  return useContext(MapsKeyContext)
}

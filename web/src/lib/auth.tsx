import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, get, isNetworkError, post, setUnauthorisedHandler } from './api'

export type Role = 'admin' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  designation: string | null
  phone: string | null
  role: Role
  all_wards: boolean
  wards: number[]
  active: boolean
  must_change_password: boolean
  last_login_at: string | null
}

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (u: User) => void
}

const Ctx = createContext<AuthState | null>(null)

// The last signed-in person, so the app still opens on site without signal (saves then go to the outbox).
const LAST = 'ugd-user'
const remember = (u: User | null) => {
  try {
    if (u) localStorage.setItem(LAST, JSON.stringify(u))
    else localStorage.removeItem(LAST)
  } catch { /* storage blocked */ }
}
const remembered = (): User | null => {
  try { return JSON.parse(localStorage.getItem(LAST) ?? 'null') } catch { return null }
}
// Signing out without signal cannot reach the server (the sign-in cookie can only be cleared by it): remember
// it and finish the sign-out as soon as the phone is online again.
const PENDING_OUT = 'ugd-signed-out'
const flag = (on: boolean) => { try { if (on) localStorage.setItem(PENDING_OUT, '1'); else localStorage.removeItem(PENDING_OUT) } catch { /* ignore */ } }
const flagged = () => { try { return localStorage.getItem(PENDING_OUT) === '1' } catch { return false } }
/** Signing out removes this person's cached data from the phone (it may be shared). */
const forgetData = () => caches?.delete('ugd-data').catch(() => undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const setUser = useCallback((u: User | null) => {
    remember(u)
    setUserState(u)
  }, [])

  useEffect(() => {
    setUnauthorisedHandler(() => setUser(null))
    const start = async () => {
      if (flagged()) {
        await post('/api/auth/logout') // throws offline: then stay signed out
        flag(false)
        return null
      }
      return (await get<{ user: User }>('/api/auth/me')).user
    }
    start()
      .then((u) => setUser(u))
      .catch((e) => setUserState(isNetworkError(e) && !flagged() ? remembered() : (remember(null), null)))
      .finally(() => setLoading(false))
  }, [setUser])

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User }>('/api/auth/login', { email, password })
    flag(false)
    if (remembered()?.id !== r.user.id) await forgetData()
    setUser(r.user)
  }, [setUser])
  const logout = useCallback(async () => {
    const ok = await post('/api/auth/logout').then(() => true, () => false)
    flag(!ok)
    await forgetData()
    setUser(null)
  }, [setUser])

  return <Ctx.Provider value={{ user, loading, login, logout, setUser }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

/** Mirrors the server rule: admins everywhere, editors in assigned wards, viewers nowhere. */
export function canEditWard(u: User | null, ward: number | null | undefined): boolean {
  if (!u || !u.active || ward == null) return false
  if (u.role === 'admin') return true
  if (u.role !== 'editor') return false
  return u.all_wards || u.wards.includes(ward)
}

export const roleLabel = (r: Role) => ({ admin: 'Commissioner (admin)', editor: 'AEE / inspector (editor)', viewer: 'Viewer' })[r]

export { ApiError }

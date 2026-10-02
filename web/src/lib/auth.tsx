import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, get, post, setUnauthorisedHandler } from './api'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setUnauthorisedHandler(() => setUser(null))
    get<{ user: User }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User }>('/api/auth/login', { email, password })
    setUser(r.user)
  }, [])
  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined)
    setUser(null)
  }, [])

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

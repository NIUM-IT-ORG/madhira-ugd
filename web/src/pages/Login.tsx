import { useState } from 'react'
import { post } from '../lib/api'
import { useAuth, type User } from '../lib/auth'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="auth-page">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await login(email, password)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <img src="/favicon.svg" alt="" width={44} height={44} />
        <h1>Madhira UGD Tracker</h1>
        <p className="muted">Underground Drainage Scheme · Madhira Municipality</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Accounts are created by the Commissioner. Ask for one if you need access.</p>
      </form>
    </div>
  )
}

export function ChangePasswordPage({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { setUser, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="auth-page">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault()
          if (next !== again) return setError('The two new passwords do not match.')
          setBusy(true)
          setError(null)
          try {
            const r = await post<{ user: User }>('/api/auth/password', { current, next })
            setUser(r.user)
            onDone?.()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <h1>{forced ? 'Set your own password' : 'Change password'}</h1>
        {forced && <p className="muted">You signed in with a one-time password. Choose a new one of at least 8 characters.</p>}
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label>
          New password again
          <input type="password" autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        {forced ? (
          <button type="button" className="btn link" onClick={logout}>Sign out</button>
        ) : (
          <button type="button" className="btn link" onClick={onDone}>Cancel</button>
        )}
      </form>
    </div>
  )
}

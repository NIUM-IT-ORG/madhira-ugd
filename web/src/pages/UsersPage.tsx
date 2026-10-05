import { useEffect, useState } from 'react'
import { Field, Seg, Sheet, timeAgo } from '../components/ui'
import { get, patch, post } from '../lib/api'
import { roleLabel, useAuth, type Role, type User } from '../lib/auth'
import { useData } from '../lib/store'

const ROLES: { v: Role; label: string }[] = [
  { v: 'editor', label: 'AEE / inspector (edit)' },
  { v: 'viewer', label: 'Viewer (read only)' },
  { v: 'admin', label: 'Admin' },
]

function WardPicker({ value, all, onChange, onAll }: { value: number[]; all: boolean; onChange: (w: number[]) => void; onAll: (a: boolean) => void }) {
  const { geo } = useData()
  const zoneOf = (w: number) => geo.wards.features.find((f) => f.properties.ward === w)?.properties.zone
  return (
    <div>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => onAll(e.target.checked)} />All wards</label>
      {!all && (
        <>
          <div className="zone-pick">
            {[1, 2, 3, 4].map((z) => {
              const wards = Array.from({ length: 22 }, (_, i) => i + 1).filter((w) => zoneOf(w) === z)
              const allIn = wards.every((w) => value.includes(w))
              return (
                <button key={z} type="button" className={`fchip ${allIn ? 'on' : ''}`} onClick={() => onChange(allIn ? value.filter((w) => !wards.includes(w)) : [...new Set([...value, ...wards])])}>
                  Zone {z}
                </button>
              )
            })}
          </div>
          <div className="ward-grid">
            {Array.from({ length: 22 }, (_, i) => i + 1).map((w) => (
              <button key={w} type="button" className={`fchip ${value.includes(w) ? 'on' : ''}`} onClick={() => onChange(value.includes(w) ? value.filter((x) => x !== w) : [...value, w].sort((a, b) => a - b))}>
                {w}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function UserForm({ existing, onClose, onDone }: { existing?: User; onClose: () => void; onDone: (u: User, temp?: string) => void }) {
  const [email, setEmail] = useState(existing?.email ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [designation, setDesignation] = useState(existing?.designation ?? 'AEE')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [role, setRole] = useState<Role>(existing?.role ?? 'editor')
  const [wards, setWards] = useState<number[]>(existing?.wards ?? [])
  const [allWards, setAllWards] = useState(existing?.all_wards ?? false)
  const [supervisor, setSupervisor] = useState(existing?.supervisor ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={existing ? `Edit ${existing.name}` : 'Add user'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !email || !name} onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const body = { email, name, designation: designation || null, phone: phone || null, role, wards, all_wards: allWards, supervisor: role === 'editor' && supervisor }
            const r = existing
              ? await patch<{ user: User }>(`/api/users/${existing.id}`, body)
              : await post<{ user: User; temp_password: string }>('/api/users', body)
            onDone(r.user, 'temp_password' in r ? String(r.temp_password) : undefined)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}>{existing ? 'Save' : 'Create user'}</button>
      </>
    }>
      <div className="row2">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Designation"><input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="AEE, DEE, Inspector…" /></Field>
      </div>
      <div className="row2">
        <Field label="Email (used to sign in)"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone (optional)"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Access"><Seg value={role} options={ROLES} onChange={setRole} /></Field>
      {role === 'editor' && (
        <Field label="Wards this person may update" hint="AEEs can only record, propose and resolve in these wards.">
          <WardPicker value={wards} all={allWards} onChange={setWards} onAll={setAllWards} />
        </Field>
      )}
      {role === 'editor' && (
        <label className="check"><input type="checkbox" checked={supervisor} onChange={(e) => setSupervisor(e.target.checked)} />
          Supervisor (AEE): may correct labour entries of other field staff during their 48-hour edit window</label>
      )}
      {error && <div className="form-error">{error}</div>}
    </Sheet>
  )
}

export default function UsersPage({ toast }: { toast: (m: string, t?: 'ok' | 'warn' | 'bad') => void }) {
  const { user: me } = useAuth()
  const { lastEvent } = useData()
  const [users, setUsers] = useState<User[]>([])
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null)
  useEffect(() => {
    get<{ users: User[] }>('/api/users').then((r) => setUsers(r.users)).catch(() => undefined)
  }, [lastEvent?.entity === 'user' ? lastEvent.at : null, edit])

  return (
    <div className="page">
      <div className="page-head">
        <h2>Users</h2>
        <p className="muted">Admin: everything, approvals. Editor (AEE / inspector): records and proposes in assigned wards. Viewer: read only.</p>
        <button className="btn primary" onClick={() => setEdit('new')}>+ Add user</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Wards</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td><b>{u.name}</b>{u.designation ? <div className="muted small">{u.designation}</div> : null}</td>
                <td>{u.email}</td>
                <td>{roleLabel(u.role)}{u.supervisor ? <div className="muted small">Supervisor</div> : null}</td>
                <td>{u.role === 'editor' ? (u.all_wards ? 'All' : u.wards.join(', ') || 'None yet') : u.role === 'admin' ? 'All' : '—'}</td>
                <td>{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                <td>{u.active ? (u.must_change_password ? 'Must set password' : 'Active') : 'Disabled'}</td>
                <td className="row-actions">
                  <button className="btn small" onClick={() => setEdit(u)}>Edit</button>
                  {u.id !== me?.id && (
                    <>
                      <button className="btn small" onClick={async () => {
                        const r = await patch<{ temp_password: string }>(`/api/users/${u.id}`, { reset_password: true })
                        setSecret({ name: u.name, email: u.email, password: r.temp_password })
                      }}>Reset password</button>
                      <button className="btn small" onClick={async () => {
                        await patch(`/api/users/${u.id}`, { active: !u.active })
                        toast(`${u.name} ${u.active ? 'disabled' : 'enabled'}.`)
                        setUsers((x) => x.map((y) => (y.id === u.id ? { ...y, active: !u.active } : y)))
                      }}>{u.active ? 'Disable' : 'Enable'}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <UserForm existing={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={(u, temp) => {
          setEdit(null)
          if (temp) setSecret({ name: u.name, email: u.email, password: temp })
          else toast(`${u.name} saved.`)
        }} />
      )}
      {secret && (
        <Sheet title={`One-time password for ${secret.name}`} onClose={() => setSecret(null)} footer={<button className="btn primary" onClick={() => setSecret(null)}>Done</button>}>
          <p>Give these to {secret.name} in person or by phone. They must choose a new password when they first sign in. This password is shown only now.</p>
          <div className="secret">
            <div><span className="muted">Email</span> <b>{secret.email}</b></div>
            <div><span className="muted">Password</span> <b className="mono">{secret.password}</b></div>
          </div>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(`Madhira UGD Tracker\n${location.origin}\nEmail: ${secret.email}\nOne-time password: ${secret.password}`)}>Copy</button>
        </Sheet>
      )}
    </div>
  )
}

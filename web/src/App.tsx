import { useCallback, useEffect, useState } from 'react'
import LabourForm from './components/LabourForm'
import OutboxSheet from './components/OutboxSheet'
import { useToast } from './components/ui'
import { AuthProvider, roleLabel, useAuth } from './lib/auth'
import { isMine, setOutboxUser, useOutbox } from './lib/outbox'
import { DataProvider, useData } from './lib/store'
import type { Selection } from './lib/types'
import ActivityPage from './pages/ActivityPage'
import ApprovalsPage from './pages/ApprovalsPage'
import DashboardPage from './pages/DashboardPage'
import IssuesPage from './pages/IssuesPage'
import { ChangePasswordPage, LoginPage } from './pages/Login'
import MapPage from './pages/MapPage'
import UsersPage from './pages/UsersPage'
import StoragePage from './pages/StoragePage'
import LabourPage from './pages/LabourPage'

type Route = 'map' | 'dashboard' | 'issues' | 'approvals' | 'labour' | 'activity' | 'users' | 'storage' | 'account'
const ROUTES: Route[] = ['map', 'dashboard', 'issues', 'approvals', 'labour', 'activity', 'users', 'storage', 'account']
const routeOf = (path: string): Route => {
  const r = path.replace(/^\/+/, '').split('/')[0] as Route
  return ROUTES.includes(r) ? r : 'map'
}

function Shell() {
  const { user, logout } = useAuth()
  const { issues, requests, stretches, live, lastEvent, reload } = useData()
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname))
  const [focus, setFocus] = useState<Selection>(null)
  const [menu, setMenu] = useState(false)
  const [labour, setLabour] = useState(false)
  const [outboxOpen, setOutboxOpen] = useState(false)
  const toast = useToast()
  // Saves on this phone are sent only for the person who made them.
  setOutboxUser(user ? { id: user.id, name: user.name } : null)
  const { items: outbox, flushNow } = useOutbox((n) => {
    toast.show(`${n} saved update${n > 1 ? 's' : ''} sent from this phone.`)
    reload()
  })

  const go = useCallback((r: Route) => {
    setRoute(r)
    setMenu(false)
    history.pushState(null, '', `/${r === 'map' ? '' : r}${r === 'map' ? location.hash : ''}`)
  }, [])
  useEffect(() => {
    const pop = () => setRoute(routeOf(location.pathname))
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  // Tell the user when someone else changes something.
  useEffect(() => {
    if (lastEvent?.by && lastEvent.by !== user?.name && ['stretch', 'issue', 'change_request'].includes(lastEvent.entity)) {
      const what = { stretch: 'a road stretch', issue: 'an issue', change_request: 'a change request' }[lastEvent.entity as 'stretch']
      toast.show(`${lastEvent.by} ${lastEvent.action === 'create' ? 'added' : 'updated'} ${what}.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent])

  const show = useCallback((s: Selection) => {
    setFocus(s ? { ...s } : null)
    go('map')
  }, [go])

  if (!user) return null
  const isAdmin = user.role === 'admin'
  // Admin-only pages opened by others (e.g. an old link) show the map instead of a blank page.
  const view: Route = !isAdmin && (route === 'users' || route === 'storage') ? 'map' : route
  const openIssues = issues.filter((i) => i.status !== 'resolved').length
  const waiting = isAdmin
    ? requests.filter((r) => r.status === 'pending').length + stretches.features.filter((f) => f.properties.stage === 'awaiting_approval' && f.properties.approval === 'pending').length
    : requests.filter((r) => r.status === 'pending' && r.requested_by === user.id).length
  const mine = outbox.filter(isMine)
  const queued = mine.filter((o) => !o.error).length
  const failed = mine.filter((o) => o.error).length
  const signOut = () => {
    if (queued && !confirm(`${queued} update${queued > 1 ? 's are' : ' is'} still waiting to be sent from this phone. They will be sent when you sign in again. Sign out anyway?`)) return
    logout()
  }

  const tabs: { r: Route; label: string; badge?: number; admin?: boolean }[] = [
    { r: 'map', label: 'Map' },
    { r: 'dashboard', label: 'Dashboard' },
    { r: 'issues', label: 'Issues', badge: openIssues },
    { r: 'approvals', label: isAdmin ? 'Approvals' : 'My requests', badge: waiting },
    { r: 'labour', label: 'Labour' },
    { r: 'activity', label: 'Activity' },
    { r: 'users', label: 'Users', admin: true },
    { r: 'storage', label: 'Storage', admin: true },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('map')} role="button" tabIndex={0}>
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <div>
            <div className="title">Madhira UGD Tracker</div>
            <div className="sub">Underground Drainage Scheme · Madhira Municipality</div>
          </div>
        </div>
        <nav className="tabs">
          {tabs.filter((t) => !t.admin || isAdmin).map((t) => (
            <a key={t.r} href={`/${t.r === 'map' ? '' : t.r}`} className={view === t.r ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(t.r) }}>
              {t.label}{t.badge ? <span className="badge">{t.badge}</span> : null}
            </a>
          ))}
        </nav>
        <div className="top-right">
          {(queued > 0 || failed > 0) && (
            <button className={`outbox ${failed ? 'bad' : ''}`} onClick={() => setOutboxOpen(true)} title="Saves kept on this phone">
              {queued ? `${queued} waiting to send` : ''}{failed ? ` ${failed} not accepted` : ''}
            </button>
          )}
          <span className={`live-dot ${live ? 'on' : ''}`} title={live ? 'Live updates on' : 'Reconnecting…'} />
          <button className="user-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span className="uname">{user.name}</span>
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <div className="menu-head"><b>{user.name}</b><span className="muted small">{roleLabel(user.role)}</span>
                {user.role === 'editor' && <span className="muted small">Wards: {user.all_wards ? 'all' : user.wards.join(', ') || 'none'}</span>}
              </div>
              <nav className="menu-tabs">
                {tabs.filter((t) => !t.admin || isAdmin).map((t) => <button key={t.r} onClick={() => go(t.r)}>{t.label}{t.badge ? ` (${t.badge})` : ''}</button>)}
              </nav>
              {user.role !== 'viewer' && <button onClick={() => { setMenu(false); setLabour(true) }}>Log labour</button>}
              <button onClick={() => go('account')}>Change password</button>
              <button onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="main">
        {/* The map stays mounted so switching pages is instant. */}
        <div className={`route ${view === 'map' ? 'shown' : 'hidden'}`}><MapPage toast={toast.show} focus={focus} /></div>
        {view === 'dashboard' && <div className="route shown scroll"><DashboardPage onShow={show} /></div>}
        {view === 'issues' && <div className="route shown scroll"><IssuesPage onShow={show} toast={toast.show} /></div>}
        {view === 'approvals' && <div className="route shown scroll"><ApprovalsPage onShow={show} toast={toast.show} /></div>}
        {view === 'labour' && <div className="route shown scroll"><LabourPage toast={toast.show} /></div>}
        {view === 'activity' && <div className="route shown scroll"><ActivityPage onShow={show} /></div>}
        {view === 'users' && isAdmin && <div className="route shown scroll"><UsersPage toast={toast.show} /></div>}
        {view === 'storage' && isAdmin && <div className="route shown scroll"><StoragePage toast={toast.show} /></div>}
        {view === 'account' && <div className="route shown scroll"><ChangePasswordPage onDone={() => go('map')} /></div>}
      </main>
      {outboxOpen && <OutboxSheet items={outbox} onFlush={flushNow} onClose={() => setOutboxOpen(false)} />}
      {labour && <LabourForm onClose={() => setLabour(false)} onDone={(m) => toast.show(m)} />}
      {toast.node}
    </div>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <div className="splash">Loading…</div>
  if (!user) return <LoginPage />
  if (user.must_change_password) return <ChangePasswordPage forced />
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

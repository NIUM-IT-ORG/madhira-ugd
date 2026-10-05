import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { get } from './api'
import { useAuth } from './auth'
import { loadGeoData, loadNetwork } from './data'
import { buildIndexes, type Indexes } from './index'
import type { ChangeRequest, GeoData, Issue, StretchCollection } from './types'

export interface LiveEvent {
  entity: string
  id?: string
  action: string
  by?: string
  at: string
  count?: number
}
export interface UserName {
  id: string
  name: string
  designation: string | null
  role: string
}

type Part = 'stretches' | 'issues' | 'requests' | 'network' | 'users'

interface Store {
  geo: GeoData
  idx: Indexes
  stretches: StretchCollection
  issues: Issue[]
  requests: ChangeRequest[]
  users: UserName[]
  live: boolean
  lastEvent: LiveEvent | null
  reload: (...parts: Part[]) => Promise<void>
}

const Ctx = createContext<Store | null>(null)
const EMPTY: StretchCollection = { type: 'FeatureCollection', features: [] }

/** Everything the screens show, kept current by the server's live event stream. */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [geo, setGeo] = useState<GeoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stretches, setStretches] = useState<StretchCollection>(EMPTY)
  const [issues, setIssues] = useState<Issue[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [users, setUsers] = useState<UserName[]>([])
  const [live, setLive] = useState(false)
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null)

  const reload = useCallback(async (...parts: Part[]) => {
    const want = new Set<Part>(parts.length ? parts : ['stretches', 'issues', 'requests', 'users'])
    const jobs: Promise<unknown>[] = []
    if (want.has('stretches')) jobs.push(get<StretchCollection>('/api/stretches').then(setStretches))
    if (want.has('issues')) jobs.push(get<{ issues: Issue[] }>('/api/issues').then((r) => setIssues(r.issues)))
    if (want.has('requests')) jobs.push(get<{ requests: ChangeRequest[] }>('/api/change-requests').then((r) => setRequests(r.requests)))
    if (want.has('users')) jobs.push(get<{ users: UserName[] }>('/api/users').then((r) => setUsers(r.users)))
    if (want.has('network')) {
      jobs.push(loadNetwork().then((n) => setGeo((g) => (g ? { ...g, pipes: n.pipes, manholes: n.manholes } : g))))
    }
    await Promise.all(jobs)
  }, [])

  useEffect(() => {
    if (!user) return
    loadGeoData().then(setGeo).catch((e) => setError(String(e)))
    reload().catch((e) => setError(String(e)))
  }, [user, reload])

  // Live updates: refetch only what changed, batched over a short window.
  const pending = useRef(new Set<Part>())
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!user) return
    // Reconnects: after a gap (screen locked, signal lost, server upgraded) reload everything, because the
    // events sent meanwhile are not replayed. A stream the browser gave up on is reopened after 5 s.
    let es: EventSource
    let first = true
    let retry: number | undefined
    const connect = () => {
      es = new EventSource('/api/events')
      es.onopen = () => {
        setLive(true)
        if (!first) reload().catch(() => undefined)
        first = false
      }
      es.onerror = () => {
        setLive(false)
        if (es.readyState === EventSource.CLOSED) retry = window.setTimeout(connect, 5000)
      }
      es.onmessage = onMessage
    }
    const onMessage = (m: MessageEvent) => {
      const e = JSON.parse(m.data) as LiveEvent
      setLastEvent(e)
      const map: Record<string, Part[]> = {
        stretch: ['stretches', 'requests'], issue: ['issues', 'stretches'], change_request: ['requests', 'stretches'],
        network: ['network'], user: ['users'],
      }
      for (const p of map[e.entity] ?? []) pending.current.add(p)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        const parts = [...pending.current]
        pending.current.clear()
        reload(...parts).catch(() => undefined)
      }, 300)
    }
    connect()
    const onVisible = () => { if (document.visibilityState === 'visible') reload().catch(() => undefined) }
    // A page kept in the browser's back/forward memory must not hold its live connection open: browsers allow
    // only 6 connections per site over plain HTTP, and a 7th page load would wait for one.
    const onHide = () => { window.clearTimeout(retry); es.close() }
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) { first = false; connect() } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      es.close()
    }
  }, [user, reload])

  const idx = useMemo(() => (geo ? buildIndexes(geo) : null), [geo])

  if (error) return <div className="splash error">Could not load data: {error}</div>
  if (!geo || !idx) return <div className="splash">Loading Madhira UGD…</div>
  return (
    <Ctx.Provider value={{ geo, idx, stretches, issues, requests, users, live, lastEvent, reload }}>{children}</Ctx.Provider>
  )
}

export function useData() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useData outside DataProvider')
  return c
}

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isNetworkError, uploadPhoto, type PhotoMeta } from './api'

/**
 * Offline outbox. A field save that cannot reach the server (no signal) is kept on the phone, with its
 * photos, and sent automatically when the connection returns. Saves the server refuses (e.g. a conflict)
 * stay in the outbox with the reason, for the user to review, retry or discard.
 *
 * - Each save carries a key (x-idempotency-key): if the server did save it but the reply was lost, sending it
 *   again returns the first result instead of creating a second record.
 * - Saves belong to the person who made them: they are sent only while that person is signed in.
 * - Saves are sent in the order they were made.
 */

export interface OutboxItem {
  id: string
  created: string
  label: string
  method: 'POST' | 'PATCH'
  url: string
  body: Record<string, unknown>
  photos: { blob: Blob; meta: PhotoMeta }[]
  user_id?: string
  user_name?: string
  error?: string
}

const DB = 'ugd-outbox'
const STORE = 'items'

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((ok, fail) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => ok(req.result)
    req.onerror = () => fail(req.error)
  })
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

// The signed-in person (set by the app shell).
let me: { id: string; name: string } | null = null
export const setOutboxUser = (u: { id: string; name: string } | null) => (me = u)

export const outboxItems = () =>
  tx<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>).then((l) => l.sort((a, b) => a.created.localeCompare(b.created)))
const putItem = (i: OutboxItem) => tx('readwrite', (s) => s.put(i)).then(changed)
export const removeItem = (id: string) => tx('readwrite', (s) => s.delete(id)).then(changed)
/** Saves made by someone other than the signed-in person wait until that person signs in again. */
export const isMine = (i: OutboxItem) => !i.user_id || i.user_id === me?.id

async function send(item: Omit<OutboxItem, 'created' | 'label'>) {
  // Issue reports saved offline by v1.0 may have no remark, which v1.1 requires.
  if (item.method === 'POST' && item.url === '/api/issues' && !String(item.body.description ?? '').trim()) {
    item = { ...item, body: { ...item.body, description: '(no remark: saved offline before the v1.1 update)' } }
  }
  const ids: string[] = []
  for (const [n, p] of item.photos.entries()) ids.push(await uploadPhoto(p.blob, p.meta, `${item.id}:p${n}`))
  const body = { ...item.body, photos: [...((item.body.photos as string[]) ?? []), ...ids] }
  return api(item.method, item.url, body, { 'x-idempotency-key': item.id })
}

/** Errors that say nothing about the save itself: no signal, server restarting, session expired. Try later. */
const isTemporary = (e: unknown) =>
  isNetworkError(e) || (e instanceof ApiError && (e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500))

/** Send now if possible; queue on the phone if there is no connection. */
export async function submit<T = Record<string, unknown>>(
  item: Omit<OutboxItem, 'id' | 'created'>,
): Promise<{ queued: true } | { queued: false; result: T }> {
  const full: OutboxItem = { ...item, id: crypto.randomUUID(), created: new Date().toISOString(), user_id: me?.id, user_name: me?.name }
  try {
    const result = (await send(full)) as T
    return { queued: false, result }
  } catch (e) {
    if (!isNetworkError(e) && !(e instanceof ApiError && e.status >= 500)) throw e
    await putItem(full)
    return { queued: true }
  }
}

let flushing = false
export async function flushOutbox(): Promise<number> {
  if (flushing || !navigator.onLine || !me) return 0
  flushing = true
  let sent = 0
  const blocked = new Set<string>() // a refused save holds back later saves to the same record
  try {
    for (const item of await outboxItems()) {
      if (item.error || !isMine(item) || blocked.has(item.url)) continue
      try {
        await send(item)
        await removeItem(item.id)
        sent++
      } catch (e) {
        if (isTemporary(e)) break
        blocked.add(item.url)
        await putItem({ ...item, error: e instanceof ApiError ? e.message : String(e) })
      }
    }
  } finally {
    flushing = false
  }
  return sent
}

/** Try a refused save again (e.g. after the stretch was reviewed). */
export const retryItem = (item: OutboxItem) => putItem({ ...item, error: undefined })

/** Queued saves, kept current; flushes when the connection returns and every 30 s. */
export function useOutbox(onSent?: (n: number) => void) {
  const [items, setItems] = useState<OutboxItem[]>([])
  const flushNow = useCallback(async () => {
    const n = await flushOutbox()
    if (n) onSent?.(n)
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const refresh = () => outboxItems().then(setItems).catch(() => setItems([]))
    listeners.add(refresh)
    refresh()
    const tryFlush = () => { flushNow().catch(() => undefined) }
    window.addEventListener('online', tryFlush)
    const t = window.setInterval(tryFlush, 30000)
    tryFlush()
    return () => {
      listeners.delete(refresh)
      window.removeEventListener('online', tryFlush)
      window.clearInterval(t)
    }
  }, [flushNow])
  return { items, flushNow }
}

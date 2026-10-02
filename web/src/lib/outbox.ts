import { useEffect, useState } from 'react'
import { api, ApiError, isNetworkError, uploadPhoto, type PhotoMeta } from './api'

/**
 * Offline outbox. A field save that cannot reach the server (no signal) is kept on the phone, with its
 * photos, and sent automatically when the connection returns. Saves the server refuses (e.g. a conflict)
 * stay in the outbox with the reason, for the user to review.
 */

export interface OutboxItem {
  id: string
  created: string
  label: string
  method: 'POST' | 'PATCH'
  url: string
  body: Record<string, unknown>
  photos: { blob: Blob; meta: PhotoMeta }[]
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

export const outboxItems = () => tx<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>)
const putItem = (i: OutboxItem) => tx('readwrite', (s) => s.put(i)).then(changed)
export const removeItem = (id: string) => tx('readwrite', (s) => s.delete(id)).then(changed)

async function send(item: Omit<OutboxItem, 'id' | 'created' | 'label'>) {
  const ids: string[] = []
  for (const p of item.photos) ids.push(await uploadPhoto(p.blob, p.meta))
  const body = { ...item.body, photos: [...((item.body.photos as string[]) ?? []), ...ids] }
  return api(item.method, item.url, body)
}

/** Send now if possible; queue on the phone if there is no connection. */
export async function submit<T = Record<string, unknown>>(
  item: Omit<OutboxItem, 'id' | 'created'>,
): Promise<{ queued: true } | { queued: false; result: T }> {
  try {
    const result = (await send(item)) as T
    return { queued: false, result }
  } catch (e) {
    if (!isNetworkError(e)) throw e
    await putItem({ ...item, id: crypto.randomUUID(), created: new Date().toISOString() })
    return { queued: true }
  }
}

let flushing = false
export async function flushOutbox(): Promise<number> {
  if (flushing || !navigator.onLine) return 0
  flushing = true
  let sent = 0
  try {
    for (const item of await outboxItems()) {
      if (item.error) continue
      try {
        await send(item)
        await removeItem(item.id)
        sent++
      } catch (e) {
        if (isNetworkError(e)) break
        await putItem({ ...item, error: e instanceof ApiError ? e.message : String(e) })
      }
    }
  } finally {
    flushing = false
  }
  return sent
}

/** Count of queued saves, kept current; flushes when the connection returns and every 30 s. */
export function useOutbox(onSent?: (n: number) => void) {
  const [items, setItems] = useState<OutboxItem[]>([])
  useEffect(() => {
    const refresh = () => outboxItems().then(setItems).catch(() => setItems([]))
    listeners.add(refresh)
    refresh()
    const tryFlush = () => flushOutbox().then((n) => n && onSent?.(n))
    window.addEventListener('online', tryFlush)
    const t = window.setInterval(tryFlush, 30000)
    tryFlush()
    return () => {
      listeners.delete(refresh)
      window.removeEventListener('online', tryFlush)
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return items
}

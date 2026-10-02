export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

/** True when the request never reached the server (no signal); such saves go to the offline outbox. */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (e instanceof ApiError && e.status === 0)

let onUnauthorised: (() => void) | null = null
export const setUnauthorisedHandler = (fn: () => void) => (onUnauthorised = fn)

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-ugd': '1' }
  let payload: BodyInit | undefined
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { error: text }
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorised?.()
    throw new ApiError(res.status, String(data.error ?? `Request failed (${res.status})`), data)
  }
  return data as T
}

export const get = <T>(url: string) => api<T>('GET', url)
export const post = <T>(url: string, body?: unknown) => api<T>('POST', url, body ?? {})
export const patch = <T>(url: string, body: unknown) => api<T>('PATCH', url, body)
export const del = <T>(url: string, body?: unknown) => api<T>('DELETE', url, body ?? {})

/** Shrink a camera photo before upload (long side 1600 px, JPEG): field connections are slow. */
export async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('encode'))), 'image/jpeg', 0.82))
  } catch {
    return file
  }
}

export interface PhotoMeta {
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  taken_at?: string
}

export async function uploadPhoto(blob: Blob, meta: PhotoMeta): Promise<string> {
  const fd = new FormData()
  // Fields first: the server reads them before the file part.
  if (meta.lat != null) fd.append('lat', String(meta.lat))
  if (meta.lng != null) fd.append('lng', String(meta.lng))
  if (meta.accuracy != null) fd.append('accuracy', String(meta.accuracy))
  fd.append('taken_at', meta.taken_at ?? new Date().toISOString())
  fd.append('file', blob, 'photo.jpg')
  const r = await api<{ id: string }>('POST', '/api/photos', fd)
  return r.id
}

export const photoUrl = (id: string) => `/api/photos/${id}`

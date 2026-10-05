import { useMemo, useState, type ReactNode } from 'react'

export type SortDir = 'asc' | 'desc'
type Value = string | number | null | undefined

/**
 * Sortable table: tap a column heading to sort by it, tap again to reverse. The choice is remembered on this device.
 * Empty values always go last.
 */
export function useSort<T>(rows: T[], columns: Record<string, (r: T) => Value>, initial: { key: string; dir: SortDir }, remember: string) {
  const [state, setState] = useState<{ key: string; dir: SortDir }>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`sort:${remember}`) ?? 'null')
      if (s && columns[s.key] && (s.dir === 'asc' || s.dir === 'desc')) return s
    } catch { /* ignore */ }
    return initial
  })
  const sorted = useMemo(() => {
    const get = columns[state.key] ?? columns[initial.key]
    const sign = state.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x == null || x === '') return y == null || y === '' ? 0 : 1
      if (y == null || y === '') return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign
      return String(x).localeCompare(String(y), 'en-IN', { numeric: true }) * sign
    })
    // columns are stable per page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state])
  const toggle = (key: string) => {
    const next = { key, dir: (state.key === key && state.dir === 'desc' ? 'asc' : state.key === key ? 'desc' : 'asc') as SortDir }
    setState(next)
    try { localStorage.setItem(`sort:${remember}`, JSON.stringify(next)) } catch { /* ignore */ }
  }
  /** A clickable column heading. */
  const Th = ({ k, children, num }: { k: string; children: ReactNode; num?: boolean }) => (
    <th className={`sortable ${num ? 'num' : ''} ${state.key === k ? 'on' : ''}`} onClick={() => toggle(k)} aria-sort={state.key === k ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {children}<span className="sort-mark">{state.key === k ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</span>
    </th>
  )
  return { sorted, sortKey: state.key, sortDir: state.dir, Th }
}

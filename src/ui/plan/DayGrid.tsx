// The day's timeline: hour lines, calendar events (grey, not movable) and
// your planned blocks (movable). Blocks can be moved by dragging, resized by
// dragging their bottom edge, or driven from the keyboard:
//   ↑ / ↓          move 15 minutes
//   Shift + ↑ / ↓  shorten / lengthen by 15 minutes
//   Delete         send back to the tray

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { endOf, SNAP_MINUTES, type BoardItem } from '../../core/plan/board'
import type { Interval } from '../../core/plan/types'
import type { Violation } from '../../core/plan/validate'

const PX_PER_MIN = 1.1

interface Props {
  window: Interval
  zone: string
  events: { id: string; title: string; start: string; end: string; color?: string | undefined }[]
  items: BoardItem[]
  problems: Map<string, Violation[]>
  /** Called with the item key and its new start instant. */
  onMove: (key: string, start: string) => void
  onNudge: (key: string, steps: number) => void
  onResize: (key: string, minutes: number) => void
  onUnplace: (key: string) => void
  /** Registers the grid so tray items can be dropped onto it. */
  gridRef: React.RefObject<HTMLDivElement | null>
}

export function DayGrid({ window, zone, events, items, problems, onMove, onNudge, onResize, onUnplace, gridRef }: Props) {
  const w0 = Date.parse(window.start)
  const totalMin = (Date.parse(window.end) - w0) / 60_000
  const time = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone }), [zone])
  const fmt = (iso: string) => time.format(new Date(iso))
  const top = (iso: string) => ((Date.parse(iso) - w0) / 60_000) * PX_PER_MIN
  const height = (a: string, b: string) => Math.max(((Date.parse(b) - Date.parse(a)) / 60_000) * PX_PER_MIN, 14)
  const drag = useRef<{ key: string; mode: 'move' | 'resize'; offsetMin: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  // Hour lines every 60 minutes from the window start (correct on 23/25-hour days, too).
  const hours = Array.from({ length: Math.floor(totalMin / 60) + 1 }, (_, i) => new Date(w0 + i * 3_600_000).toISOString())

  const minuteAt = (clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect()
    return (clientY - rect.top) / PX_PER_MIN
  }

  const startDrag = (e: PointerEvent<HTMLElement>, item: BoardItem, mode: 'move' | 'resize') => {
    if (!item.start || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { key: item.key, mode, offsetMin: minuteAt(e.clientY) - (Date.parse(item.start) - w0) / 60_000 }
    setDragging(item.key)
  }
  const moveDrag = (e: PointerEvent<HTMLElement>, item: BoardItem) => {
    const d = drag.current
    if (!d || d.key !== item.key || !item.start) return
    const at = minuteAt(e.clientY)
    if (d.mode === 'move') onMove(item.key, new Date(w0 + (at - d.offsetMin) * 60_000).toISOString())
    else onResize(item.key, at - (Date.parse(item.start) - w0) / 60_000)
  }
  const endDrag = () => {
    drag.current = null
    setDragging(null)
  }

  const onKey = (e: KeyboardEvent<HTMLElement>, item: BoardItem) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? -1 : 1
      if (e.shiftKey) onResize(item.key, item.minutes + dir * SNAP_MINUTES)
      else onNudge(item.key, dir)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onUnplace(item.key)
    }
  }

  const placed = items.filter((i) => i.start)
  return (
    <div className="day-grid-scroll">
      <div className="day-grid" ref={gridRef} style={{ height: totalMin * PX_PER_MIN }} aria-label="Day timeline" role="group">
        {hours.map((h) => (
          <div key={h} className="hour-line" style={{ top: top(h) }}>
            <span className="hour-label">{fmt(h)}</span>
          </div>
        ))}
        {events.map((ev) => (
          <div key={ev.id} className="grid-event" style={{ top: top(ev.start), height: height(ev.start, ev.end) }} title={ev.title}>
            <span className="dot" style={{ background: ev.color ?? 'var(--p3)' }} aria-hidden="true" />
            <span className="grid-text">{ev.title}</span>
            <span className="visually-hidden">, busy {fmt(ev.start)} to {fmt(ev.end)}</span>
          </div>
        ))}
        <ul className="grid-blocks" aria-label="Planned tasks">
          {placed.map((item) => {
            const issues = problems.get(item.key) ?? []
            const end = endOf(item)!
            return (
              <li
                key={item.key}
                className={`grid-block${item.minutes <= 30 ? ' is-compact' : ''}${issues.length ? ' has-problem' : ''}${dragging === item.key ? ' is-dragging' : ''}`}
                style={{ top: top(item.start!), height: height(item.start!, end) }}
                tabIndex={0}
                aria-label={`${item.title}, ${fmt(item.start!)} to ${fmt(end)}${issues.length ? `. Problem: ${issues[0]!.detail}` : ''}`}
                aria-describedby="grid-keys-help"
                onKeyDown={(e) => onKey(e, item)}
                onPointerDown={(e) => startDrag(e, item, 'move')}
                onPointerMove={(e) => moveDrag(e, item)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className="grid-text">
                  <strong>{item.title}</strong> <span className="grid-time">{fmt(item.start!)}–{fmt(end)}</span>
                </span>
                {issues.length > 0 && <span className="grid-problem">{issues[0]!.detail}</span>}
                <span
                  className="resize-handle"
                  aria-hidden="true"
                  onPointerDown={(e) => startDrag(e, item, 'resize')}
                  onPointerMove={(e) => moveDrag(e, item)}
                  onPointerUp={endDrag}
                />
              </li>
            )
          })}
        </ul>
      </div>
      <p id="grid-keys-help" className="visually-hidden">Arrow keys move by 15 minutes; with Shift they change the length; Delete sends it back to the tray.</p>
    </div>
  )
}

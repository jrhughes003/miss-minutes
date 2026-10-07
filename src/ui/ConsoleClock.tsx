// The clock on the console: an analog face (original art, D33) beside a
// segment-style readout. Decorative apart from the readout, which is a
// <time> element so the current time is available to assistive tech.

import { useEffect, useState } from 'react'
import { toLocalDateTime } from '../core/time'
import { useClock } from './clock'

export function ConsoleClock() {
  const clock = useClock()
  const [now, setNow] = useState(() => toLocalDateTime(clock.now(), clock.zone())) // "YYYY-MM-DDTHH:MM"
  useEffect(() => {
    const id = setInterval(() => setNow(toLocalDateTime(clock.now(), clock.zone())), 10_000)
    return () => clearInterval(id)
  }, [clock])

  const [h, m] = now.slice(11, 16).split(':').map(Number) as [number, number]
  const minuteAngle = m * 6
  const hourAngle = (h % 12) * 30 + m * 0.5
  return (
    <span className="console-clock">
      <svg viewBox="0 0 40 40" className="clock-face" aria-hidden="true" focusable="false">
        <circle cx="20" cy="20" r="18" className="clock-rim" />
        <circle cx="20" cy="20" r="14.5" className="clock-dial" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="20" y1="7" x2="20" y2={i % 3 === 0 ? 10 : 8.6} className="clock-tick" transform={`rotate(${i * 30} 20 20)`} />
        ))}
        <line x1="20" y1="20" x2="20" y2="12" className="clock-hour" transform={`rotate(${hourAngle} 20 20)`} />
        <line x1="20" y1="21.5" x2="20" y2="9" className="clock-minute" transform={`rotate(${minuteAngle} 20 20)`} />
        <circle cx="20" cy="20" r="1.8" className="clock-pin" />
      </svg>
      <time className="clock-readout" dateTime={now}>
        {now.slice(11, 16)}
      </time>
    </span>
  )
}

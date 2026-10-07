// Reads a duration out of a brain-dump line: "Write report 1h", "Groceries
// (30m)", "Call Mum for 20 minutes", "Deep work 1h30", "Taxes 1.5 hours".
// Returns the minutes and the line without the duration.

const UNIT = String.raw`(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)`
const PATTERNS: RegExp[] = [
  // "1h30", "1h 30m", "1 hr 15 min"
  new RegExp(String.raw`\b(?:for\s+)?(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(\d{1,2})\s*(?:m|min|mins|minutes?)?\b`, 'i'),
  // "1.5h", "2 hours", "45m", "20 minutes", optionally in brackets or after "for"
  new RegExp(String.raw`\(?\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(${UNIT})\b\)?`, 'i'),
]

export const MAX_ESTIMATE = 12 * 60

export function parseEstimate(line: string): { minutes: number | null; rest: string } {
  for (const [i, re] of PATTERNS.entries()) {
    const m = re.exec(line)
    if (!m) continue
    let minutes: number
    if (i === 0) minutes = Number(m[1]) * 60 + Number(m[2])
    else minutes = /^h/i.test(m[2]!) ? Number(m[1]) * 60 : Number(m[1])
    minutes = Math.round(minutes)
    if (minutes <= 0 || minutes > MAX_ESTIMATE) continue
    const rest = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()
    return { minutes, rest }
  }
  return { minutes: null, rest: line.trim() }
}

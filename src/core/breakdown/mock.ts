// A deterministic stand-in for AI task breakdown: the mock server and the web
// demo use it. It's honest filler (generic steps built from the task title)
// and is always labelled "simulated" wherever it shows.

export function mockBreakdown(title: string): string[] {
  const short = title.length > 40 ? `${title.slice(0, 37).trimEnd()}…` : title
  return [`List what “${short}” involves`, 'Gather what you need to start', 'Do the first concrete part', 'Check what’s left and finish it']
}

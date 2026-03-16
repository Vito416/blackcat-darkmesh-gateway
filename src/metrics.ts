export type CounterMap = Record<string, number>
export type GaugeMap = Record<string, number>

const counters: CounterMap = {}
const gauges: GaugeMap = {}

function norm(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_')
}

export function inc(name: string, value = 1) {
  const k = norm(name)
  counters[k] = (counters[k] || 0) + value
}

export function gauge(name: string, value: number) {
  gauges[norm(name)] = value
}

export function snapshot() {
  return { counters: { ...counters }, gauges: { ...gauges } }
}

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

export function toProm(): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(counters)) {
    lines.push(`${k}_total ${v}`)
  }
  for (const [k, v] of Object.entries(gauges)) {
    lines.push(`${k} ${v}`)
  }
  return lines.join('\n') + '\n'
}

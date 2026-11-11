import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMB, formatMs, shouldCalm, startupRows, summarizeProcesses } from '../src/shared/perf.ts'
import { Channels } from '../src/shared/ipc.ts'

test('startup rows: milestone order, step times, missing or bad marks skipped', () => {
  const rows = startupRows({ dashboardReady: 1350.4, appReady: 420, windowShown: 1100, databaseReady: Number.NaN })
  assert.deepEqual(
    rows.map((r) => [r.mark, r.atMs, r.stepMs]),
    [
      ['appReady', 420, 420],
      ['windowShown', 1100, 680],
      ['dashboardReady', 1350, 250],
    ],
  )
  assert.equal(rows[0]!.label, 'App ready')
  assert.deepEqual(startupRows({}), [])
  assert.deepEqual(startupRows({ appReady: -5 }), [])
})

test('process summary: grouped by kind in a fixed order, KB → MB, totals', () => {
  const s = summarizeProcesses([
    { type: 'Tab', cpu: { percentCPUUsage: 3.04 }, memory: { workingSetSize: 102_400 } },
    { type: 'Browser', cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 81_920 } },
    { type: 'Utility', cpu: { percentCPUUsage: 0.2 }, memory: { workingSetSize: 10_240 } },
    { type: 'Utility', cpu: { percentCPUUsage: 0.3 }, memory: { workingSetSize: 10_240 } },
    { type: 'GPU', cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 51_200 } },
    { type: 'Zygote', cpu: { percentCPUUsage: -1 }, memory: { workingSetSize: 1024 } },
  ])
  assert.deepEqual(
    s.processes.map((p) => [p.label, p.count, p.memoryMB, p.cpuPercent]),
    [
      ['Main process', 1, 80, 1],
      ['Interface', 1, 100, 3],
      ['Graphics', 1, 50, 2],
      ['Helpers', 2, 20, 0.5],
      ['Other', 1, 1, 0],
    ],
  )
  assert.equal(s.totalMemoryMB, 251)
  assert.equal(s.totalCpuPercent, 6.5)
  assert.deepEqual(summarizeProcesses([]), { processes: [], totalMemoryMB: 0, totalCpuPercent: 0 })
})

test('calm: pause when hidden, or unfocused while standing by; informative states keep moving', () => {
  assert.equal(shouldCalm({ hidden: true, focused: false, state: 'speaking' }), true)
  assert.equal(shouldCalm({ hidden: false, focused: false, state: 'idle' }), true)
  assert.equal(shouldCalm({ hidden: false, focused: true, state: 'idle' }), false)
  for (const state of ['listening', 'processing', 'executing', 'speaking', 'needs-you']) {
    assert.equal(shouldCalm({ hidden: false, focused: false, state }), false, state)
  }
})

test('formatting and channels', () => {
  assert.equal(formatMs(250.4), '250 ms')
  assert.equal(formatMs(1350), '1.35 s')
  assert.equal(formatMB(3.25), '3.3 MB')
  assert.equal(formatMB(251.4), '251 MB')
  assert.equal(Channels.perfGet, 'perf:get')
  assert.equal(new Set(Object.values(Channels)).size, Object.values(Channels).length)
})

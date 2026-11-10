import { BrowserWindow } from 'electron'
import { Events, type KillSwitchState } from '../shared/ipc.ts'

// Global kill switch (SECURITY.md §5). While engaged, every execution path must refuse work.
// Worker- and workflow-level stops arrive with the agent runtime in Phase 2/3; they will
// register abort handlers here so a global stop cancels them too.

type AbortHandler = () => void

let state: KillSwitchState = { engaged: false, engagedAt: null, reason: null }
const handlers = new Set<AbortHandler>()

export const getKillSwitch = (): KillSwitchState => ({ ...state })
export const isHalted = (): boolean => state.engaged

/** Register cleanup for a running activity; returns an unregister function. */
export function onHalt(handler: AbortHandler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

const changeListeners = new Set<() => void>()
/** Main-process listeners for any change (engage or re-arm), e.g. the menu-bar icon. */
export function onKillSwitchChange(fn: () => void): () => void {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}

function broadcast(): void {
  for (const fn of changeListeners) {
    try {
      fn()
    } catch (err) {
      console.error('[killswitch] listener failed:', err)
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Events.killSwitchChanged, getKillSwitch())
  }
}

export function engage(reason: string): KillSwitchState {
  if (!state.engaged) {
    state = { engaged: true, engagedAt: new Date().toISOString(), reason }
    for (const h of [...handlers]) {
      try {
        h()
      } catch (err) {
        console.error('[killswitch] abort handler failed:', err)
      }
    }
    handlers.clear()
    console.warn(`[killswitch] ENGAGED: ${reason}`)
  }
  broadcast()
  return getKillSwitch()
}

export function rearm(): KillSwitchState {
  state = { engaged: false, engagedAt: null, reason: null }
  console.warn('[killswitch] re-armed by user')
  broadcast()
  return getKillSwitch()
}

import { BrowserWindow } from 'electron'
import { Events } from '../shared/ipc.ts'
import { TaskRegistry } from '../shared/taskRegistry.ts'
import { isHalted, onKillSwitchChange } from './killswitch.ts'

// Running tasks (SECURITY.md §5): worker = one action, workflow = one request, global = Stop all.

export const tasks = new TaskRegistry((list) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(Events.tasksChanged, list)
  }
})

// Stop all aborts every running request and action immediately (provider calls included).
onKillSwitchChange(() => {
  if (isHalted()) tasks.cancelAll()
})

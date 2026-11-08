import type { JarvisApi } from '../../preload/index.ts'

declare global {
  interface Window {
    jarvis: JarvisApi
  }
}

export {}

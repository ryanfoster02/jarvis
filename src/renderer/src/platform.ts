import { detectPlatform, platformText } from '../../shared/platform.ts'

/** The OS this window runs on, from the user agent (Chromium reports Macintosh / Windows / X11; Linux). */
export const PLATFORM = detectPlatform(navigator.userAgent)
export const PT = platformText(PLATFORM)

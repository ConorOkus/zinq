import { Logger, Level, type Record } from 'lightningdevkit'
import { captureError } from '../../storage/error-log'

const recentCaptures = new Map<string, number>()
const CAPTURE_COOLDOWN_MS = 5000

function shouldCapture(key: string): boolean {
  const now = Date.now()
  const last = recentCaptures.get(key)
  if (last && now - last < CAPTURE_COOLDOWN_MS) return false
  recentCaptures.set(key, now)
  return true
}

export function createLogger(): Logger {
  return Logger.new_impl({
    log(record: Record): void {
      const level = record.get_level()
      const module = record.get_module_path()
      const message = record.get_args()
      const prefix = `[LDK ${module}]`

      switch (level) {
        case Level.LDKLevel_Gossip:
        case Level.LDKLevel_Trace:
          console.debug(prefix, message)
          break
        case Level.LDKLevel_Debug:
          console.debug(prefix, message)
          break
        case Level.LDKLevel_Info:
          console.info(prefix, message)
          break
        case Level.LDKLevel_Warn:
          if (shouldCapture(`warn:${module}`)) {
            captureError('warning', `LDK:${module}`, message)
          }
          console.warn(prefix, message)
          break
        case Level.LDKLevel_Error:
          if (shouldCapture(`error:${module}`)) {
            captureError('error', `LDK:${module}`, message)
          }
          console.error(prefix, message)
          break
      }
    },
  })
}

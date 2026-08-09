export const PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS = 1200

export function createProjectAddressAutoLocateScheduler({
  delayMs = PROJECT_ADDRESS_AUTO_LOCATE_DELAY_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  let timerId = null

  function cancel() {
    if (timerId === null) return
    clearTimer(timerId)
    timerId = null
  }

  function schedule(task) {
    cancel()
    timerId = setTimer(() => {
      timerId = null
      task()
    }, delayMs)
  }

  return Object.freeze({ schedule, cancel })
}

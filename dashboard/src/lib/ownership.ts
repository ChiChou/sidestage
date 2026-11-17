// Web Locks are shared by extension pages and released when the owning page closes.
// Load the controller only after acquisition: importing it registers browser listeners.
export function ownController(start: () => Promise<void>): Promise<void> {
  return navigator.locks.request('sidestage-controller', async () => {
    await start()
    await new Promise<void>(() => {})
  })
}

export function withMediaLock<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks.request('sidestage-media', work)
}

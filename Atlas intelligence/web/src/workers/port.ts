/**
 * A message port that is a real Worker when the host allows one, and an
 * in-thread stand-in running the same handler when it does not (a
 * sandboxed frame, an old browser, a script-src policy). Messages posted
 * before the worker proves itself are kept and replayed in-thread if the
 * worker fails to start, so nothing is lost on fallback.
 */
export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onMessage(fn: (data: unknown) => void): void
  terminate(): void
  readonly mode: 'worker' | 'inline'
}

export function createPort(spawn: () => Worker, handler: (message: unknown) => unknown): Port {
  const listeners: Array<(data: unknown) => void> = []
  const deliver = (data: unknown) => { for (const l of listeners) l(data) }
  let worker: Worker | null = null
  let proven = false
  let pending: unknown[] = []
  let mode: 'worker' | 'inline' = 'inline'

  const runInline = (message: unknown) => {
    setTimeout(() => {
      Promise.resolve(handler(message)).then((reply) => { if (reply !== null && reply !== undefined) deliver(reply) })
    }, 0)
  }

  const fallback = () => {
    if (mode === 'inline') return
    mode = 'inline'
    try { worker?.terminate() } catch { /* already gone */ }
    worker = null
    const replay = pending
    pending = []
    for (const m of replay) runInline(m)
  }

  try {
    worker = spawn()
    mode = 'worker'
    worker.addEventListener('message', (e: MessageEvent) => { proven = true; pending = []; deliver(e.data) })
    worker.addEventListener('error', (e) => { if (!proven) { e.preventDefault(); fallback() } })
  } catch {
    worker = null
    mode = 'inline'
  }

  return {
    get mode() { return mode },
    postMessage(message, transfer) {
      if (mode === 'inline' || !worker) { runInline(message); return }
      if (!proven) pending.push(message)
      try { worker.postMessage(message, transfer ?? []) } catch { fallback() }
    },
    onMessage(fn) { listeners.push(fn) },
    terminate() { try { worker?.terminate() } catch { /* ignore */ } },
  }
}

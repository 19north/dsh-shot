// dsh-shot — host half.
//
// Registers the loopback-only routes the browser half drives. Every path is an
// exact single segment below /api (the shared fetch table matches on pathname
// only, so parameters travel in the query string):
//
//   GET  /api/dsh-shot/status             capability probe, no side effects
//   GET  /api/dsh-shot/pending            finished shots waiting to be claimed
//   GET  /api/dsh-shot/image?id=<uuid>    one captured PNG (latest when omitted)
//   GET  /api/dsh-shot/wait?id=&ms=       long-poll until that shot is ready
//   POST /api/dsh-shot/capture            start a capture { mode, hideWindow }
//
// The capture itself is a detached PowerShell child (scripts/capture.ps1) that
// owns the whole hide -> settle -> grab -> restore sequence, so the browser
// never has to stay responsive while its own window is hidden. Finished shots
// land in a pending queue that the browser collects with wait/pending.
//
// Nothing here mutates the harness: one route table plus one child process.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin identity for cordis rows. */
export const name = 'dsh-shot'

/** Route prefix. Must stay under /api: the only prefix the shared fetch table dispatches. */
const ROUTE_BASE = '/api/dsh-shot'

/** Services required before mounting: the carrier-neutral route table. */
export const inject = ['connection']

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = join(HERE, '..', 'scripts', 'capture.ps1')

/** Whole-child watchdog: settle delay plus a 4K PNG encode. */
const CAPTURE_TIMEOUT_MS = 25_000

/** How many finished shots stay fetchable. */
const PENDING_LIMIT = 6

/** Captured shots older than this are dropped. */
const PENDING_TTL_MS = 5 * 60_000

/** Bound on one capture request body. */
const MAX_BODY_BYTES = 64 * 1024

/** Long-poll ceiling for one wait request. */
const MAX_WAIT_MS = 30_000

/**
 * @typedef {object} PendingShot
 * @property {string} id
 * @property {Buffer} data
 * @property {number} width
 * @property {number} height
 * @property {{ x: number, y: number, width: number, height: number }} screen
 * @property {string} mode
 * @property {boolean} hideWindow
 * @property {string} window
 * @property {string} [error]
 * @property {number} createdAt
 */

/** @type {Map<string, PendingShot>} */
const pending = new Map()

/** @type {Set<() => void>} */
const waiters = new Set()

/** Wake every long-poll. */
function notifyWaiters() {
  for (const wake of [...waiters]) {
    try {
      wake()
    } catch {
      waiters.delete(wake)
    }
  }
}

/** Drop expired shots and keep the queue bounded. */
function sweepPending() {
  const now = Date.now()
  for (const [id, shot] of pending) {
    if (now - shot.createdAt > PENDING_TTL_MS) pending.delete(id)
  }
  while (pending.size > PENDING_LIMIT) {
    const oldest = [...pending.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest === undefined) break
    pending.delete(oldest.id)
  }
  return [...pending.values()].sort((a, b) => a.createdAt - b.createdAt)
}

/** JSON response helper (Fetch API shapes). */
function json(status, body) {
  return Response.json(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

/** Read a JSON request body, tolerating an empty one. */
async function readJson(request) {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new Error('request body too large')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/* Cropping the overlay down to the window's slice was tried and removed: the
 * slice is physical pixels while the viewport is CSS pixels, so no single scale
 * plus offset both fit it inside the window and kept it aligned with the real
 * screen (it clipped, letterboxed, or re-drew the window's content elsewhere,
 * depending on the approach). The overlay draws the whole captured frame,
 * contained and centred, which is what makes every part of the screen reachable
 * from inside the window. capture.ps1 still reports `windowRect` in case a
 * future attempt needs it. */

/** Public view of one shot (no bytes). */
function describe(shot) {
  return {
    id: shot.id,
    width: shot.width,
    height: shot.height,
    screen: shot.screen,
    mode: shot.mode,
    hideWindow: shot.hideWindow,
    window: shot.window,
    ...(shot.error === undefined ? {} : { error: shot.error }),
  }
}

/**
 * Run one capture. Resolves once the shot is in the queue (or the child failed).
 * @param {{ mode?: string, hideWindow?: boolean, settleMs?: number }} options
 */
function startCapture(options) {
  const hideWindow = options.hideWindow === true
  const settleMs = Number.isFinite(options.settleMs)
    ? Math.max(0, Math.min(2000, Number(options.settleMs)))
    : undefined

  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', SCRIPT_PATH, '-Mode', 'full']
    if (hideWindow) args.push('-HideWindow')
    if (settleMs !== undefined) args.push('-SettleMs', String(settleMs))
    // The Electron main process is a few hops above the harness; the script
    // resolves the actual shell window by executable name from this anchor.
    if (typeof process.ppid === 'number' && process.ppid > 0) args.push('-AnchorPid', String(process.ppid))

    let child
    try {
      child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {}
      // The script restores the window in its own finally block; if it died
      // before that, this second invocation performs the restore alone.
      runRestoreOnly()
      resolve({ ok: false, error: `capture timed out after ${CAPTURE_TIMEOUT_MS} ms` })
    }, CAPTURE_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, error: error.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        resolve({ ok: false, error: firstLine(stderr) || `capture script exited with code ${code}` })
        return
      }
      let report
      try {
        report = JSON.parse(lastJsonLine(stdout))
      } catch {
        resolve({ ok: false, error: `capture script returned unreadable output: ${stdout.slice(-300)}` })
        return
      }
      if (report.ok !== true) {
        resolve({ ok: false, error: String(report.error || 'capture failed') })
        return
      }
      const path = String(report.path || '')
      if (path === '' || !existsSync(path)) {
        resolve({ ok: false, error: 'capture script reported success but wrote no file' })
        return
      }
      let data
      try {
        data = readFileSync(path)
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
        return
      }
      rm(path, { force: true }).catch(() => {})

      const id = randomUUID()
      pending.set(id, {
        id,
        data,
        width: Number(report.width) || 0,
        height: Number(report.height) || 0,
        screen: report.screen || { x: 0, y: 0, width: 0, height: 0 },
        mode: String(report.mode || 'full'),
        hideWindow: report.hideWindow === true,
        window: String(report.window || ''),
        createdAt: Date.now(),
      })
      sweepPending()
      notifyWaiters()
      resolve({ ok: true, id })
    })
  })
}

/** One restore-only pass, used when the capture child was killed early. */
function runRestoreOnly() {
  try {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH, '-Mode', 'restore',
    ], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => {})
  } catch {}
}

/** The script prints progress lines and one JSON report last. */
function lastJsonLine(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith('{')) return lines[index]
  }
  throw new Error('no JSON report')
}

/** Keep the first useful line of a PowerShell error. */
function firstLine(text) {
  const line = text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)[0]
  return line ? line.slice(0, 500) : ''
}

/** Sleep that long-polls can be cut short by. */
function waitForChange(ms) {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      waiters.delete(finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    waiters.add(finish)
  })
}

/**
 * One request against one route.
 * @param method - route tail segment.
 * @param request - incoming request.
 */
async function handle(method, request) {
  const url = new URL(request.url)

  if (method === 'status') {
    return json(200, {
      ok: true,
      platform: process.platform,
      scriptPresent: existsSync(SCRIPT_PATH),
      script: SCRIPT_PATH,
    })
  }

  if (method === 'pending') {
    return json(200, { ok: true, items: sweepPending().map(describe) })
  }

  if (method === 'image') {
    const id = url.searchParams.get('id')
    const shot = id === null ? sweepPending().at(-1) : pending.get(id)
    if (shot === undefined || shot.error !== undefined) return new Response('not found', { status: 404 })
    return new Response(shot.data, {
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    })
  }

  if (method === 'wait') {
    const id = url.searchParams.get('id')
    const ms = Math.max(0, Math.min(MAX_WAIT_MS, Number(url.searchParams.get('ms')) || 15_000))
    const deadline = Date.now() + ms
    for (;;) {
      const shot = id === null ? sweepPending().at(-1) : pending.get(id)
      if (shot !== undefined) return json(200, { ok: true, item: describe(shot) })
      const left = deadline - Date.now()
      if (left <= 0) return json(200, { ok: true, item: null, timeout: true })
      await waitForChange(Math.min(left, 5_000))
    }
  }

  if (method === 'capture') {
    if (process.platform !== 'win32') return json(200, { ok: false, error: 'capture is Windows-only' })
    if (!existsSync(SCRIPT_PATH)) return json(500, { ok: false, error: `capture script missing at ${SCRIPT_PATH}` })
    let body
    try {
      body = await readJson(request)
    } catch (error) {
      return json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    const result = await startCapture({
      hideWindow: body.hideWindow === true,
      settleMs: body.settleMs,
    })
    return result.ok
      ? json(200, { ok: true, id: result.id })
      : json(500, { ok: false, error: result.error })
  }

  return json(404, { ok: false, error: `unknown route ${method}` })
}

/**
 * Plugin body: register the route table.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  /**
   * @param {string} method
   * @param {readonly string[]} methods
   * @param {'buffered' | 'streaming'} requestBody
   */
  const route = (method, methods, requestBody) => {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `${ROUTE_BASE}/${method}`,
      methods,
      requestBody,
      fetch: async (request) => {
        try {
          return await handle(method, request)
        } catch (error) {
          return json(500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    }), `dsh-shot: ${ROUTE_BASE}/${method}`)
  }

  route('status', ['GET'], 'buffered')
  route('pending', ['GET'], 'buffered')
  route('image', ['GET'], 'buffered')
  route('wait', ['GET'], 'buffered')
  route('capture', ['POST'], 'buffered')
}

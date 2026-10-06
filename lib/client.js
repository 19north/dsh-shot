
// dsh-shot — browser half.
//
// Adds a camera control to the composer's left seat. Picking an entry captures
// the desktop through the host route (/api/dsh-shot/*), then shows an in-page
// overlay where the shot is box-selected and annotated before landing in the
// composer as an image attachment draft.
//
// Two capture flavours, exactly as the composer menu offers them:
//   "direct"      - grab now; whatever the DSH window covers stays covered
//   "hide window" - the host hides the DSH window, grabs, and restores it, so
//                   the shot shows the desktop BEHIND the app
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load),
// so there is no build step and no dependency beyond the React the shell seeds.
// The attachment path (conversation.createDrafts + shell.addAttachments) and
// the seat (conversation.input.left) are the documented extension points other
// community composer controls use.

window.__ModuleLoader__.load({
  id: 'dsh-shot',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const inject = ['slots', 'sessions', 'conversation']
    const API = '/api/dsh-shot'

    // ── styles ───────────────────────────────────────────────────────────────
    const CSS = `
.dsh-shot-wrap{position:relative;display:inline-flex;align-items:center}
.dsh-shot-btn{
  appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;
}
.dsh-shot-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-shot-btn[data-busy="true"]{opacity:.55;cursor:progress}
.dsh-shot-btn svg{width:18px;height:18px}
.dsh-shot-menu{
  position:absolute;left:0;bottom:calc(100% + 6px);z-index:60;min-width:236px;
  padding:5px;border-radius:12px;background:var(--dsw-specific-input-major);
  border:1px solid var(--dsw-alias-border-l2-darkmode-thin);box-shadow:var(--dsw-shadow-lv3);
  display:flex;flex-direction:column;gap:2px;
}
.dsh-shot-item{
  appearance:none;border:0;background:transparent;text-align:left;cursor:pointer;
  padding:8px 10px;border-radius:8px;color:var(--dsw-alias-label-primary);
  font:var(--dsw-font-xs-13);font-family:var(--dsw-font-family);line-height:1.35;
  display:flex;flex-direction:column;gap:2px;
}
.dsh-shot-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-shot-item small{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}
.dsh-shot-overlay{
  position:fixed;inset:0;z-index:2147483000;background:#07080b;user-select:none;overflow:hidden;
  cursor:crosshair;font-family:var(--dsw-font-family,system-ui,sans-serif);
}
.dsh-shot-overlay canvas{position:absolute;left:0;top:0;display:block}
.dsh-shot-tip{
  position:absolute;left:50%;top:14px;transform:translateX(-50%);
  padding:7px 14px;border-radius:999px;background:rgba(22,24,29,.86);color:#e9ebf0;
  font:13px/1.5 var(--dsw-font-family,system-ui,sans-serif);pointer-events:none;white-space:nowrap;
  box-shadow:0 4px 18px rgba(0,0,0,.45);
}
.dsh-shot-toolbar{
  position:absolute;z-index:2;display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:6px 8px;border-radius:12px;background:rgba(26,28,34,.96);border:1px solid rgba(255,255,255,.12);
  box-shadow:0 8px 26px rgba(0,0,0,.5);
}
.dsh-shot-tool{
  appearance:none;border:0;background:transparent;color:#d7dae2;cursor:pointer;
  width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;
  font:13px/1 var(--dsw-font-family,system-ui,sans-serif);
}
.dsh-shot-tool:hover{background:rgba(255,255,255,.12);color:#fff}
.dsh-shot-tool[data-active="true"]{background:rgba(255,255,255,.9);color:#15171c}
.dsh-shot-tool svg{width:16px;height:16px}
.dsh-shot-swatches{display:flex;align-items:center;gap:4px;padding:0 4px}
.dsh-shot-swatch{width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.5);cursor:pointer}
.dsh-shot-swatch[data-active="true"]{outline:2px solid #fff;outline-offset:1px}
.dsh-shot-sep{width:1px;height:20px;background:rgba(255,255,255,.16);margin:0 2px}
.dsh-shot-primary{
  appearance:none;border:0;cursor:pointer;border-radius:8px;padding:6px 12px;
  background:#4a7dff;color:#fff;font:13px/1.2 var(--dsw-font-family,system-ui,sans-serif);
}
.dsh-shot-primary:hover{background:#5c8bff}
.dsh-shot-ghost{
  appearance:none;border:0;cursor:pointer;border-radius:8px;padding:6px 10px;
  background:transparent;color:#c6cad3;font:13px/1.2 var(--dsw-font-family,system-ui,sans-serif);
}
.dsh-shot-ghost:hover{background:rgba(255,255,255,.1);color:#fff}
.dsh-shot-toast{
  position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483001;
  padding:10px 16px;border-radius:12px;background:rgba(30,32,38,.95);color:#f0f1f5;
  font:13px/1.5 var(--dsw-font-family,system-ui,sans-serif);box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none;
}
.dsh-shot-toast[data-error="true"]{background:rgba(196,58,58,.96)}
.dsh-shot-text-input{
  position:absolute;z-index:3;min-width:150px;max-width:60vw;
  padding:4px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.35);
  background:rgba(16,18,24,.96);font:14px/1.4 var(--dsw-font-family,system-ui,sans-serif);
  outline:none;box-shadow:0 6px 18px rgba(0,0,0,.5);
}
`

    // ── small helpers ────────────────────────────────────────────────────────
    function toast(text, isError) {
      const el = document.createElement('div')
      el.className = 'dsh-shot-toast'
      if (isError) el.dataset.error = 'true'
      el.textContent = text
      document.body.appendChild(el)
      window.setTimeout(() => el.remove(), 3600)
    }

    async function asJson(response) {
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    function base64ToBlob(base64, mediaType) {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return new Blob([bytes], { type: mediaType || 'image/png' })
    }

    function stamp() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    }

    // Anything outside the selection is pushed down hard so the eye goes to the
    // bright selection — that contrast is the whole point of the mask.
    const COLOR = { bg: 'rgba(4,5,9,0.68)', accent: '#4a7dff' }
    // Opaque padding painted around a fitted capture. It must be OPAQUE: a
    // transparent margin shows the live app window through it.
    const LETTERBOX = '#07080b'
    // Selection handle size in CSS pixels; converted to bitmap pixels per frame.
    const HANDLE_PX = 11
    const PALETTE = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ffffff']
    const FONT_STACK = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'

    /** Greedy wrap for annotation text, measured in bitmap pixels. */
    function wrapText(target, text, maxWidth) {
      const paragraphs = String(text).split(/\r?\n/)
      const lines = []
      for (const paragraph of paragraphs) {
        const characters = [...paragraph]
        let line = ''
        for (const character of characters) {
          const candidate = line + character
          if (line !== '' && target.measureText(candidate).width > maxWidth) {
            lines.push(line)
            line = character
          } else {
            line = candidate
          }
        }
        lines.push(line)
      }
      return lines.length === 0 ? [''] : lines
    }

    /** Accept only a plausible session id (session ids are strings on the wire). */
    function asSessionId(value) {
      return typeof value === 'string' && value !== '' ? value : null
    }

    /**
     * The conversation the user is actually looking at.
     *
     * NOT `sessions.list.getSnapshot().current`: that field is always null in
     * this build (measured — it stays null even with a conversation open), and
     * trusting it made every shot land in a freshly created conversation. The
     * UI owns the answer instead, and three independent places agree:
     *   uiSession.mainRetainId                          (the retained main binding)
     *   uiWorkspace.selection.getSnapshot().sessionId
     *   uiWorkspace.mainReference.sessionId
     * Read them in that order, tolerating whichever is missing, so a reshuffle
     * in the UI layer degrades to "new conversation" rather than a wrong target.
     * @param ctx - plugin context.
     * @returns the current session id, or null while the new-session screen is up.
     */
    function currentSessionIdOf(ctx) {
      const attempt = (read) => {
        try {
          return asSessionId(read())
        } catch {
          return null
        }
      }
      return attempt(() => ctx.get('uiSession')?.mainRetainId)
        || attempt(() => ctx.get('uiWorkspace')?.selection?.getSnapshot?.()?.sessionId)
        || attempt(() => ctx.get('uiWorkspace')?.mainReference?.sessionId)
        || attempt(() => ctx.sessions.list.getSnapshot().current)
        || null
    }

    // ── the capture + annotation overlay ─────────────────────────────────────
    /**
     * Show the captured desktop, let the user box-select it and annotate the
     * selection, then hand back the composited PNG.
     * @returns a promise resolving to the finished blob, or null when cancelled.
     */
    /**
     * @param {ImageBitmap} bitmap full virtual-screen capture
     * @param {object} host controller
     */
    function openOverlay(bitmap, host) {
      return new Promise((resolve) => {
        // The drawn frame is the WHOLE capture. Cropping it to the window's
        // slice was tried and reverted: the slice is physical pixels while the
        // viewport is CSS pixels, so the two aspect ratios never matched and
        // every attempt to align them (unscaled, contain, cover) either clipped
        // the frame, left dark bands, or pushed the window's content out of
        // position.
        const view = { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
        const container = document.createElement('div')
        container.className = 'dsh-shot-overlay'

        const screenCanvas = document.createElement('canvas')
        // Sized by layout() to the on-screen size; the drawing transform in
        // render() makes bitmap coordinates land correctly on that surface.
        screenCanvas.width = 1
        screenCanvas.height = 1
        const preview = document.createElement('canvas')

        /** Read-only geometry of both layers, for the headless probes. */
        const rectOf = (node) => {
          const r = node.getBoundingClientRect()
          return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
        }

        const tip = document.createElement('div')
        tip.className = 'dsh-shot-tip'
        container.append(screenCanvas, preview, tip)
        document.body.appendChild(container)
        // Read-only seam for the headless probes: the real selection and mark
        // list as data, so a test never has to reverse-engineer them from
        // pixels (the captured frame has bright pixels of its own).
        Object.defineProperty(container, '__dshShotState', {
          enumerable: false,
          get: () => ({
            selection: selection === null ? null : { ...selection },
            marks: marks.map((mark) => ({ ...mark })),
            tool,
            color,
            dragging: drag === null ? null : { ...drag },
            canvas: { width: screenCanvas.width, height: screenCanvas.height },
            // The capture's own pixel size: selection and mark coordinates are in
            // THIS space, while the surfaces above are display-sized. Probes need
            // both to map a bitmap coordinate onto the screen.
            bitmap: { width: bitmap.width, height: bitmap.height },
          }),
        })
        // Second seam: the two layers' real CSS boxes and a pixel sampler. A
        // probe can then tell "the mask failed to cover this spot" from "this
        // spot shows what it should" instead of guessing from a screenshot.
        Object.defineProperty(container, '__dshShotGeom', {
          enumerable: false,
          get: () => ({
            screen: rectOf(screenCanvas),
            preview: rectOf(preview),
            container: rectOf(container),
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
            buffer: buffer === null ? null : { width: buffer.width, height: buffer.height },
            sample: (x, y) => {
              const g = screenCanvas.getContext('2d')
              const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data
              return [d[0], d[1], d[2]]
            },
            sampleBuffer: (x, y) => {
              if (buffer === null) return null
              const g = buffer.getContext('2d')
              const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data
              return [d[0], d[1], d[2]]
            },
            samplePreview: (x, y) => {
              // `willReadFrequently` keeps the readback from being disturbed and
              // the 4th element is the alpha, which is what tells "dimmed" apart
              // from "transparent, so the live desktop shows through".
              const g = preview.getContext('2d', { willReadFrequently: true })
              const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data
              return [d[0], d[1], d[2], d[3]]
            },
            sampleScreen: (x, y) => {
              const g = screenCanvas.getContext('2d', { willReadFrequently: true })
              const d = g.getImageData(Math.round(x), Math.round(y), 1, 1).data
              return [d[0], d[1], d[2], d[3]]
            },
            /**
             * Replay the exact paint sequence step by step on a throwaway canvas
             * and report the pixel at the top-left, so "which step left the top
             * bright" is a measurement instead of a guess.
             */
            paintTrace: () => {
              const W = preview.width
              const H = preview.height
              const c = document.createElement('canvas')
              c.width = W
              c.height = H
              const g = c.getContext('2d', { willReadFrequently: true })
              const at = (x, y) => {
                const d = g.getImageData(x, y, 1, 1).data
                return [d[0], d[1], d[2], d[3]]
              }
              const sc = Math.max(W / bitmap.width, H / bitmap.height)
              const bx = (W - bitmap.width * sc) / 2
              const by = (H - bitmap.height * sc) / 2
              const trace = []
              const note = (label) => trace.push({ label, tl: at(6, 6), top: at(300, 60), mid: at(628, 364) })
              g.drawImage(bitmap, 0, 0, W, H)
              note('1 drawImage frame stretched to surface')
              g.fillStyle = COLOR.bg
              g.fillRect(0, 0, W, H)
              note('2 fill dim over surface')
              g.setTransform(sc, 0, 0, sc, bx, by)
              if (selection !== null) {
                g.save()
                g.beginPath()
                g.rect(selection.x, selection.y, selection.width, selection.height)
                g.clip()
                g.drawImage(bitmap, 0, 0)
                g.restore()
                note('3 frame restored inside selection (clip)')
                trace.push({ label: 'marks present', count: marks.length, kinds: marks.map((m) => m.type + ':' + String(m.color)) })
                for (let i = 0; i < marks.length; i += 1) {
                  g.save()
                  g.beginPath()
                  g.rect(selection.x, selection.y, selection.width, selection.height)
                  g.clip()
                  g.translate(-selection.x, -selection.y)
                  drawMark(g, marks[i])
                  g.restore()
                  note(`4.${i} after mark ${i} (${marks[i].type})`)
                }
                compose(g, selection)
                note('4 compose marks')
              }
              g.setTransform(1, 0, 0, 1, 0, 0)
              note('5 back to identity')
              return { surface: [W, H], bitmap: [bitmap.width, bitmap.height], scale: sc, offset: [bx, by], selection: selection === null ? null : { ...selection }, trace }
            },

            bufferDiagnostics: () => {
              const w = Math.min(256, bitmap.width)
              const h = Math.min(256, bitmap.height)
              const step = (label, run) => {
                const c = document.createElement('canvas')
                c.width = w
                c.height = h
                const g = c.getContext('2d')
                run(g)
                const d = g.getImageData(4, 4, 1, 1).data
                return { label, pixel: [d[0], d[1], d[2], d[3]] }
              }
              const src = { x: 0, y: 0, width: w, height: h }
              return {
                bitmapSize: [bitmap.width, bitmap.height],
                bgColor: COLOR.bg,
                steps: [
                  step('drawImage(bitmap 0,0)', (g) => { g.drawImage(bitmap, 0, 0) }),
                  step('drawImage(bitmap) then fill bg', (g) => {
                    g.drawImage(bitmap, 0, 0)
                    g.fillStyle = COLOR.bg
                    g.fillRect(0, 0, w, h)
                  }),
                  step('fill bg then destination-over bitmap', (g) => {
                    g.fillStyle = COLOR.bg
                    g.fillRect(0, 0, w, h)
                    g.globalCompositeOperation = 'destination-over'
                    g.drawImage(bitmap, -200, -200)
                  }),
                  step('clearRect then fill bg then destination-over', (g) => {
                    g.clearRect(0, 0, w, h)
                    g.fillStyle = COLOR.bg
                    g.fillRect(0, 0, w, h)
                    g.globalCompositeOperation = 'destination-over'
                    g.drawImage(bitmap, -200, -200)
                  }),
                ],
                liveBuffer: buffer === null ? null : (() => {
                  const g = buffer.getContext('2d')
                  const d = g.getImageData(4, 4, 1, 1).data
                  const e = g.getImageData(Math.round(bitmap.width * 0.8), Math.round(bitmap.height * 0.8), 1, 1).data
                  return { corner4x4: [d[0], d[1], d[2], d[3]], far: [e[0], e[1], e[2], e[3]] }
                })(),
              }
            },
          }),
        })

        const ctx = screenCanvas.getContext('2d')
        const pctx = preview.getContext('2d')
        /**
         * The visible layer is the only layer that gets drawn. The working
         * canvas in front of it exists solely so debug seams can still sample
         * "the interactive surface"; keeping one extra canvas is cheaper than
         * keeping a second, subtly different copy of the overlay around.
         */
        const DEBUG_MIRROR = false

        /** current selection in bitmap pixels */
        let selection = null
        /** @type {{ type: 'rect'|'arrow', x1: number, y1: number, x2: number, y2: number, color: string }[]} */
        let marks = []
        let tool = 'rect'
        let color = PALETTE[0]
        /** Live interaction: rubber-band select, moving the box, resizing a handle, or drawing a mark. */
        let drag = null
        let toolbar = null
        let textEditor = null

        /**
         * The one place that knows how bitmap space maps onto the visible layer:
         * the capture is fitted (CONTAIN) and centred, so there is a scale AND a
         * letterbox offset. Every pointer/marker conversion goes through this, so
         * the two directions can never drift apart.
         */
        function frameBox() {
          const rect = preview.getBoundingClientRect()
          const width = Math.max(1, rect.width)
          const height = Math.max(1, rect.height)
          const scale = Math.min(width / bitmap.width, height / bitmap.height)
          return {
            rect,
            scale,
            offsetX: (width - bitmap.width * scale) / 2,
            offsetY: (height - bitmap.height * scale) / 2,
          }
        }

        const toBitmap = (event) => {
          const box = frameBox()
          return {
            x: Math.max(0, Math.min(bitmap.width, (event.clientX - box.rect.left - box.offsetX) / box.scale)),
            y: Math.max(0, Math.min(bitmap.height, (event.clientY - box.rect.top - box.offsetY) / box.scale)),
          }
        }

        function normalize(mark) {
          return {
            x1: Math.min(mark.x1, mark.x2),
            y1: Math.min(mark.y1, mark.y2),
            x2: Math.max(mark.x1, mark.x2),
            y2: Math.max(mark.y1, mark.y2),
          }
        }

        /**
         * The composited working frame: dimmed everywhere, with the original
         * pixels kept intact underneath the current selection. Rebuilt only when
         * the frame or the selection changes, because rebuilding it copies the
         * whole 2560x1440 bitmap twice (and the mask has to be re-punched on
         * every move/resize anyway).
         */
        let buffer = null
        let bufferSelection = null

        function selectionKey(box) {
          return box === null ? 'none' : `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`
        }

        function ensureBuffer() {
          if (buffer === null || buffer.width !== bitmap.width || buffer.height !== bitmap.height) {
            buffer = document.createElement('canvas')
            buffer.width = bitmap.width
            buffer.height = bitmap.height
          }
          const next = selectionKey(selection)
          if (next === bufferSelection) return
          bufferSelection = next
          const bctx = buffer.getContext('2d')
          bctx.setTransform(1, 0, 0, 1, 0, 0)
          bctx.globalCompositeOperation = 'source-over'
          bctx.clearRect(0, 0, buffer.width, buffer.height)
          bctx.drawImage(bitmap, 0, 0)
          bctx.fillStyle = COLOR.bg
          bctx.fillRect(0, 0, buffer.width, buffer.height)
          if (selection !== null) {
            // Punch the selection back to full brightness inside the mask.
            bctx.globalCompositeOperation = 'destination-out'
            bctx.fillStyle = '#000'
            bctx.fillRect(selection.x, selection.y, selection.width, selection.height)
            bctx.globalCompositeOperation = 'destination-over'
            bctx.drawImage(bitmap, 0, 0)
            bctx.globalCompositeOperation = 'source-over'
          }
        }

        /** Selection handles in bitmap coordinates: corners + edge midpoints. */
        function handlePoints(box) {
          if (box === null) return []
          const cx = box.x + box.width / 2
          const cy = box.y + box.height / 2
          return [
            { id: 'nw', x: box.x, y: box.y },
            { id: 'n', x: cx, y: box.y },
            { id: 'ne', x: box.x + box.width, y: box.y },
            { id: 'e', x: box.x + box.width, y: cy },
            { id: 'se', x: box.x + box.width, y: box.y + box.height },
            { id: 's', x: cx, y: box.y + box.height },
            { id: 'sw', x: box.x, y: box.y + box.height },
            { id: 'w', x: box.x, y: cy },
          ]
        }

        /** Handle hit radius in bitmap pixels, derived from the on-screen size. */
        function handleRadius() {
          const { scale } = frameBox()
          return Math.max(8, (HANDLE_PX / 2 + 6) / (scale > 0 ? scale : 1))
        }

        function hitSelection(point) {
          if (selection === null) return null
          const radius = handleRadius()
          for (const handle of handlePoints(selection)) {
            if (Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius) {
              return { type: 'resize', id: handle.id }
            }
          }
          if (point.x >= selection.x && point.x <= selection.x + selection.width
            && point.y >= selection.y && point.y <= selection.y + selection.height) {
            return { type: 'move', dx: point.x - selection.x, dy: point.y - selection.y }
          }
          return null
        }

        /** Resize from one edge, clamped to the frame so the box stays inside. */
        function resizeSelection(position, id) {
          const minSize = 16
          const left = selection.x
          const top = selection.y
          const right = selection.x + selection.width
          const bottom = selection.y + selection.height
          const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
          let nextLeft = left
          let nextTop = top
          let nextRight = right
          let nextBottom = bottom
          if (id.includes('w')) nextLeft = clamp(position.x, 0, right - minSize)
          if (id.includes('e')) nextRight = clamp(position.x, left + minSize, bitmap.width)
          if (id.includes('n')) nextTop = clamp(position.y, 0, bottom - minSize)
          if (id.includes('s')) nextBottom = clamp(position.y, top + minSize, bitmap.height)
          selection = {
            x: nextLeft,
            y: nextTop,
            width: nextRight - nextLeft,
            height: nextBottom - nextTop,
          }
        }

        /** Move the whole box, keeping it inside the frame. */
        function moveSelectionTo(x, y) {
          selection = {
            x: Math.max(0, Math.min(bitmap.width - selection.width, x)),
            y: Math.max(0, Math.min(bitmap.height - selection.height, y)),
            width: selection.width,
            height: selection.height,
          }
        }

        /**
         * Draw the region (and its marks) into one 2D context, at 1:1 pixels.
         *
         * Selection and marks are always in bitmap coordinates. `origin` says
         * where the target context's own origin sits in bitmap space - the
         * screen canvas draws the frame (origin = 0,0), the export canvas is
         * exactly region-sized (origin = region).
         *
         * The transform is NORMALISED first: this draws at 1:1 bitmap pixels, so
         * it must not inherit a scaled context. Leaving the caller's scale in
         * place drew the whole frame shrunk into the top-left corner (and, worse,
         * outside the clip) - that was the "extra bright copy of my selection in
         * the corner".
         *
         * @param {CanvasRenderingContext2D} target
         * @param {{x:number,y:number,width:number,height:number}} region bitmap-space rect to draw
         * @param {{x:number,y:number}} origin the target frame's origin, in bitmap space
         */
        /**
         * Draw the captured frame at 1:1 BITMAP pixels, with bitmap (0,0) at the
         * transform's origin. The context's transform is expected to already map
         * bitmap space onto the target; nothing here assumes an identity matrix,
         * which is what keeps callers from scaling the frame twice.
         */
        function drawFrame(target) {
          target.drawImage(bitmap, 0, 0)
        }

        /**
         * Draw one bitmap-space REGION into a canvas whose size is the region, so
         * the region's top-left lands at the target's top-left.
         *
         * Two earlier attempts failed here and the shapes are worth remembering:
         *   1. translating the frame by a caller-supplied `origin` meant the export
         *      (which passed 0,0) clipped and drew at the BITMAP's top-left, so the
         *      right SIZE came out with the wrong PLACE.
         *   2. `clip() + translate(-x,-y) + drawImage(bitmap,0,0)` measured as a
         *      complete no-op on the export canvas (a white probe canvas stayed
         *      pure white), so the export came out solid black.
         * The plain nine-argument `drawImage(source rect -> dest rect)` is the one
         * form that has measured correct every time, so that is what this uses.
         *
         * @param {HTMLCanvasElement|CanvasRenderingContext2D} target
         * @param {{x:number,y:number,width:number,height:number}} region bitmap-space rect to draw
         */
        function compose(target, region) {
          const ctx2d = typeof target.getContext === 'function' && target.canvas === undefined
            ? target.getContext('2d')
            : target
          ctx2d.save()
          ctx2d.setTransform(1, 0, 0, 1, 0, 0)
          // Crop the frame straight from the bitmap: no clip, no translate.
          ctx2d.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
          // Marks are already in bitmap coordinates, which is also this canvas's
          // coordinate space, so they need no adjustment.
          for (const mark of marks) drawMark(ctx2d, mark)
          ctx2d.restore()
        }

        /**
         * Font size and wrapped lines of a text mark. One source of truth so the
         * drawn plate, the copy text and the double-click hit test all agree.
         */
        function textLayout(target, mark) {
          const size = Math.max(16, Math.round(bitmap.width / 72))
          const lineHeight = Math.round(size * 1.25)
          const paddingX = size * 0.1
          const paddingY = size * 0.1
          target.save()
          target.font = `600 ${size}px ${FONT_STACK}`
          const lines = wrapText(target, mark.text, size * 15)
          const width = Math.max(1, ...lines.map((line) => target.measureText(line).width)) + size * 0.6
          target.restore()
          return { size, lineHeight, paddingX, paddingY, lines, width, height: lines.length * lineHeight + size * 0.4 }
        }

        /** The drawn rectangle of a text mark, in bitmap coordinates. */
        function textRect(mark) {
          const layout = textLayout(ctx, mark)
          return {
            x: mark.x1 - layout.size * 0.2,
            y: mark.y1 - layout.size * 0.15,
            width: layout.width,
            height: layout.height,
          }
        }

        /** The text mark under a point, topmost first. */
        function textAt(point) {
          for (let index = marks.length - 1; index >= 0; index -= 1) {
            const mark = marks[index]
            if (mark.type !== 'text') continue
            const rect = textRect(mark)
            if (point.x >= rect.x && point.x <= rect.x + rect.width
              && point.y >= rect.y && point.y <= rect.y + rect.height) return mark
          }
          return null
        }

        function drawMark(target, mark, wrap = true) {
          target.save()
          target.strokeStyle = mark.color
          target.fillStyle = mark.color
          target.lineWidth = Math.max(2, bitmap.width / 700)
          if (mark.type === 'rect') {
            const box = normalize(mark)
            target.fillStyle = `${mark.color}22`
            target.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
            target.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
          } else if (mark.type === 'text') {
            const layout = textLayout(target, mark)
            target.font = `600 ${layout.size}px ${FONT_STACK}`
            target.textBaseline = 'top'
            const lines = wrap ? layout.lines : String(mark.text).split(/\r?\n/)
            // A near-black plate keeps any colour readable over light pixels.
            target.fillStyle = 'rgba(10,12,18,0.72)'
            target.fillRect(mark.x1 - layout.size * 0.2, mark.y1 - layout.size * 0.15, layout.width, layout.height)
            target.fillStyle = mark.color
            lines.forEach((line, index) => {
              target.fillText(line, mark.x1 + layout.paddingX, mark.y1 + layout.paddingY + index * layout.lineHeight)
            })
          } else {
            const angle = Math.atan2(mark.y2 - mark.y1, mark.x2 - mark.x1)
            const head = Math.max(14, bitmap.width / 90)
            target.beginPath()
            target.moveTo(mark.x1, mark.y1)
            target.lineTo(mark.x2, mark.y2)
            target.stroke()
            target.beginPath()
            target.moveTo(mark.x2, mark.y2)
            target.lineTo(mark.x2 - head * Math.cos(angle - Math.PI / 7), mark.y2 - head * Math.sin(angle - Math.PI / 7))
            target.lineTo(mark.x2 - head * Math.cos(angle + Math.PI / 7), mark.y2 - head * Math.sin(angle + Math.PI / 7))
            target.closePath()
            target.fill()
          }
          target.restore()
        }

        /** Re-render the interactive screen canvas and mirror it to the visible layer. */
        function render() {
          ensureBuffer()
          // CONTAIN mapping: the WHOLE capture is shown, scaled to fit and centred,
          // and the leftover margin is letterboxed. Matches layout()'s Math.min.
          const scale = Math.min(screenCanvas.width / bitmap.width, screenCanvas.height / bitmap.height)
          const ox = (screenCanvas.width - bitmap.width * scale) / 2
          const oy = (screenCanvas.height - bitmap.height * scale) / 2
          /**
           * Paint the whole overlay onto one surface, in this order:
           *   1. the opaque letterbox background over the ENTIRE surface
           *   2. the dimmed frame, scaled to fit inside it
           *   3. inside the selection only: the pristine frame at full brightness
           *   4. the marks, the selection outline and the handles
           *
           * Two rules this function exists to enforce, both learned the hard way:
           *   - every step must paint in BITMAP coordinates under one transform, so
           *     a helper that assumes 1:1 cannot silently get scaled twice;
           *   - the surface must never be left transparent anywhere. A gap does not
           *     read as "black", it reads as the LIVE app window showing through -
           *     which is what the "extra copy of my selection" really was. The
           *     letterbox margin is therefore painted, not left empty.
           */
          const paint = (target) => {
            target.setTransform(1, 0, 0, 1, 0, 0)
            target.globalCompositeOperation = 'source-over'
            target.globalAlpha = 1
            target.clearRect(0, 0, target.canvas.width, target.canvas.height)
            // Step 1: opaque margins, so no pixel of the window is ever unpainted.
            target.fillStyle = LETTERBOX
            target.fillRect(0, 0, target.canvas.width, target.canvas.height)
            // Step 2: the dimmed frame, fitted and centred.
            target.drawImage(buffer, ox, oy, bitmap.width * scale, bitmap.height * scale)
            // Bitmap-space work from here on.
            target.setTransform(scale, 0, 0, scale, ox, oy)
            if (selection !== null) {
              target.save()
              target.beginPath()
              target.rect(selection.x, selection.y, selection.width, selection.height)
              target.clip()
              drawFrame(target)
              for (const mark of marks) drawMark(target, mark)
              target.restore()
              target.save()
              target.strokeStyle = COLOR.accent
              target.lineWidth = Math.max(1, bitmap.width / 1200)
              target.strokeRect(selection.x, selection.y, selection.width, selection.height)
              target.restore()
              drawHandles(target)
            }
            if (drag !== null && drag.type === 'select') {
              const box = normalize({ x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 })
              target.save()
              target.fillStyle = 'rgba(255,255,255,0.18)'
              target.strokeStyle = '#fff'
              target.lineWidth = Math.max(1, bitmap.width / 1200)
              target.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
              target.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
              target.restore()
            }
            target.setTransform(1, 0, 0, 1, 0, 0)
          }
          paint(pctx)
          if (DEBUG_MIRROR) paint(ctx)
        }

        /** White squares on the selection: the affordance for move/resize. */
        function drawHandles(target) {
          const { scale } = frameBox()
          const size = HANDLE_PX / (scale > 0 ? scale : 1)
          target.save()
          target.lineWidth = Math.max(1, size / 10)
          for (const handle of handlePoints(selection)) {
            const x = handle.x - size / 2
            const y = handle.y - size / 2
            target.fillStyle = '#ffffff'
            target.strokeStyle = 'rgba(20,22,28,0.85)'
            target.fillRect(x, y, size, size)
            target.strokeRect(x, y, size, size)
          }
          target.restore()
        }

        function layout() {
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          // CONTAIN: the whole capture must be visible, so the scale is the MIN of
          // the two axes and the leftover margin becomes a letterbox.
          //
          // The trap that made this subtle: a margin is only safe if the surface
          // itself paints it. "Contain" once meant a canvas SMALLER than the window
          // (1280x720 in a 1280x820 window), so the margin was TRANSPARENT and the
          // live app window showed through it - which read as "a bright copy of my
          // selection in the corner". COVER fixed that by cropping the capture,
          // which is the wrong trade: the user needs the whole screen.
          //
          // So: the canvas is always the full window, the frame is scaled to fit and
          // centred, and the margin is painted opaque. Whole screen, no hole.
          const scale = Math.min(viewportWidth / bitmap.width, viewportHeight / bitmap.height)
          const surfaceWidth = Math.max(1, Math.round(viewportWidth))
          const surfaceHeight = Math.max(1, Math.round(viewportHeight))
          screenCanvas.width = surfaceWidth
          screenCanvas.height = surfaceHeight
          preview.width = surfaceWidth
          preview.height = surfaceHeight
          // The visible layer is drawn at 1:1 and never needs the transform itself.
          preview.style.width = `${surfaceWidth}px`
          preview.style.height = `${surfaceHeight}px`
          preview.style.left = '0px'
          preview.style.top = '0px'
          // The working canvas is off-screen; the preview is what the user sees.
          screenCanvas.style.display = 'none'
          render()
          placeToolbar()
        }

        function placeToolbar() {
          if (toolbar === null) return
          // Same geometry as everything else: fitted and centred, so the toolbar
          // must account for the letterbox offset or it drifts toward the corner.
          const { rect, scale, offsetX, offsetY } = frameBox()
          const originX = rect.left + offsetX
          const originY = rect.top + offsetY
          const offsetXs = selection.x * scale
          const offsetYs = selection.y * scale
          const selectionTop = originY + offsetYs
          const selectionBottom = originY + (offsetYs + selection.height * scale)
          const selectionRight = originX + (offsetXs + selection.width * scale)
          const toolbarWidth = toolbar.offsetWidth || 320
          const toolbarHeight = toolbar.offsetHeight || 44
          let left = Math.min(originX + offsetXs, window.innerWidth - toolbarWidth - 12)
          left = Math.max(12, left)
          let top = selectionTop - toolbarHeight - 10
          if (top < 12) top = selectionBottom + 10
          if (top + toolbarHeight > window.innerHeight - 12) top = Math.max(12, selectionTop - toolbarHeight - 10)
          toolbar.style.left = `${Math.round(left)}px`
          toolbar.style.top = `${Math.round(top)}px`
          if (selectionRight < left) toolbar.style.left = `${Math.round(Math.max(12, selectionRight - toolbarWidth))}px`
        }

        function icon(paths) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.setAttribute('viewBox', '0 0 24 24')
          svg.setAttribute('fill', 'none')
          svg.setAttribute('stroke', 'currentColor')
          svg.setAttribute('stroke-width', '1.8')
          svg.setAttribute('stroke-linecap', 'round')
          svg.setAttribute('stroke-linejoin', 'round')
          for (const d of paths) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('d', d)
            svg.appendChild(path)
          }
          return svg
        }

        /** Switch tool, keeping the toolbar highlight and any text editor in sync. */
        function selectTool(next) {
          tool = next
          if (next !== 'text') closeTextEditor()
          if (toolbar !== null) {
            for (const other of toolbar.querySelectorAll('.dsh-shot-tool[data-tool]')) {
              other.dataset.active = String(other.dataset.tool === tool)
            }
          }
        }

        /**
         * Inline text entry placed over the click point. The mark is created
         * immediately so the text is drawn at the right spot; an empty
         * confirmation removes it again.
         */
        function openTextEditor(mark, options = {}) {
          closeTextEditor()
          const { rect, scale, offsetX, offsetY } = frameBox()
          const originX = rect.left + offsetX
          const originY = rect.top + offsetY
          const editor = document.createElement('input')
          editor.type = 'text'
          editor.className = 'dsh-shot-text-input'
          editor.placeholder = options.prefill ? '改完回车确认 · Esc 放弃修改' : '输入文字，回车确认 · Esc 取消'
          editor.style.left = `${Math.round(originX + mark.x1 * scale)}px`
          editor.style.top = `${Math.round(originY + mark.y1 * scale)}px`
          editor.style.color = mark.color
          editor.dataset.mark = String(marks.indexOf(mark))
          editor.dataset.original = options.prefill ? mark.text : ''
          if (options.prefill) editor.value = mark.text
          // Non-wrapping copy/paste: the editor is a single line, so Ctrl+V into
          // a fresh editor must not reintroduce the drawn line breaks.
          editor.addEventListener('paste', (event) => {
            const text = event.clipboardData?.getData('text')
            if (text === undefined) return
            event.preventDefault()
            const start = editor.selectionStart ?? editor.value.length
            const end = editor.selectionEnd ?? start
            editor.value = editor.value.slice(0, start) + text + editor.value.slice(end)
            editor.setSelectionRange(start + text.length, start + text.length)
          })
          let finished = false
          const finish = (apply) => {
            if (finished) return
            finished = true
            const value = apply ? editor.value.trim() : editor.dataset.original
            editor.removeEventListener('blur', onBlur)
            editor.remove()
            textEditor = null
            if (value === '') marks.splice(marks.indexOf(mark), 1)
            else mark.text = value
            render()
          }
          const commit = () => finish(true)
          const abort = () => finish(false)
          const onBlur = () => {
            // Clicking elsewhere keeps whatever was typed rather than losing it.
            if (textEditor === editor) commit()
          }
          // Capture phase on the input itself: the window-level overlay
          // shortcut also listens for Enter/Escape, and a bubbling stop would
          // be too late — it already ran and confirmed the whole shot while the
          // user was typing.
          editor.addEventListener('keydown', (event) => {
            event.stopImmediatePropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              abort()
            }
          }, true)
          editor.addEventListener('blur', onBlur)
          // closeTextEditor (tool switch / teardown) reuses the same finisher so
          // there is exactly one place that commits an editor.
          Object.defineProperty(editor, '__dshShotFinish', { value: finish, enumerable: false })
          container.appendChild(editor)
          textEditor = editor
          if (options.skipFocus !== true) {
            editor.focus()
            editor.select()
          }
        }

        function closeTextEditor() {
          if (textEditor === null) return
          const editor = textEditor
          const finish = editor.__dshShotFinish
          textEditor = null
          if (typeof finish === 'function') finish(true)
          else editor.remove()
        }

        function buildToolbar() {
          toolbar = document.createElement('div')
          toolbar.className = 'dsh-shot-toolbar'

          const buttons = [
            { id: 'rect', title: '红框', paths: ['M4 5h16v14H4z'] },
            { id: 'arrow', title: '箭头', paths: ['M5 19L19 5', 'M13 5h6v6'] },
          ]
          for (const spec of buttons) {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'dsh-shot-tool'
            button.title = spec.title
            button.dataset.tool = spec.id
            if (tool === spec.id) button.dataset.active = 'true'
            button.appendChild(icon(spec.paths))
            button.addEventListener('click', () => selectTool(spec.id))
            toolbar.appendChild(button)
          }

          const textTool = document.createElement('button')
          textTool.type = 'button'
          textTool.className = 'dsh-shot-tool'
          textTool.title = '文字：在框内点一下再输入'
          textTool.dataset.tool = 'text'
          textTool.textContent = 'T'
          if (tool === 'text') textTool.dataset.active = 'true'
          textTool.addEventListener('click', () => selectTool('text'))
          toolbar.appendChild(textTool)

          const swatches = document.createElement('div')
          swatches.className = 'dsh-shot-swatches'
          const swatchButtons = []
          for (const value of PALETTE) {
            const dot = document.createElement('button')
            dot.type = 'button'
            dot.className = 'dsh-shot-swatch'
            dot.style.background = value
            dot.title = value
            if (value === color) dot.dataset.active = 'true'
            dot.addEventListener('click', () => {
              color = value
              for (const other of swatchButtons) other.dataset.active = String(other === dot)
            })
            swatchButtons.push(dot)
            swatches.appendChild(dot)
          }
          toolbar.appendChild(swatches)

          const separator = document.createElement('div')
          separator.className = 'dsh-shot-sep'
          toolbar.appendChild(separator)

          const redo = document.createElement('button')
          redo.type = 'button'
          redo.className = 'dsh-shot-ghost'
          redo.textContent = '撤销'
          redo.title = '撤销上一条标注'
          redo.addEventListener('click', () => {
            marks = marks.slice(0, -1)
            render()
          })
          toolbar.appendChild(redo)

          const back = document.createElement('button')
          back.type = 'button'
          back.className = 'dsh-shot-ghost'
          back.textContent = '重选'
          back.title = '重新框选'
          back.addEventListener('click', resetSelection)
          toolbar.appendChild(back)

          const spacer = document.createElement('div')
          spacer.style.flex = '1'
          toolbar.appendChild(spacer)

          const confirm = document.createElement('button')
          confirm.type = 'button'
          confirm.className = 'dsh-shot-primary'
          confirm.textContent = '完成 ⏎'
          confirm.title = '确认并把图片放进输入框'
          confirm.addEventListener('click', finish)
          toolbar.appendChild(confirm)

          container.appendChild(toolbar)
          placeToolbar()
        }

        function resetSelection() {
          selection = null
          marks = []
          closeTextEditor()
          tip.textContent = '拖动鼠标框选要发的区域 · Esc 取消'
          if (toolbar !== null) {
            toolbar.remove()
            toolbar = null
          }
          render()
        }

        function finish() {
          const box = normalize({
            x1: Math.round(selection.x),
            y1: Math.round(selection.y),
            x2: Math.round(selection.x + selection.width),
            y2: Math.round(selection.y + selection.height),
          })
          const width = Math.max(1, box.x2 - box.x1)
          const height = Math.max(1, box.y2 - box.y1)
          const region = { x: box.x1, y: box.y1, width, height }
          const out = document.createElement('canvas')
          out.width = width
          out.height = height
          const octx = out.getContext('2d')
          octx.fillStyle = '#000'
          octx.fillRect(0, 0, width, height)
          compose(octx, region)
          out.toBlob((blob) => {
            if (blob === null) {
              toast('导出图片失败', true)
              return
            }
            void host.deliver(blob, width, height).then((delivered) => {
              teardown()
              resolve(delivered)
            }).catch((error) => {
              toast(`放进输入框失败：${error.message}`, true)
            })
          }, 'image/png')
        }

        function cancel() {
          teardown()
          resolve(false)
        }

        let disposed = false
        function teardown() {
          if (disposed) return
          disposed = true
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', layout)
          document.removeEventListener('contextmenu', onContextMenu)
          container.remove()
        }

        function onContextMenu(event) {
          if (disposed) return
          // Let the inline editor keep its own native context menu.
          if (textEditor !== null && event.target === textEditor) return
          event.preventDefault()
          event.stopPropagation()
          step()
        }

        function step() {
          if (drag !== null) {
            drag = null
            render()
            return
          }
          if (marks.length > 0) {
            marks = marks.slice(0, -1)
            render()
            return
          }
          if (selection !== null) {
            resetSelection()
            return
          }
          cancel()
        }

        function onKey(event) {
          if (disposed) return
          const key = String(event.key || '')
          if (key === 'Escape') {
            event.preventDefault()
            event.stopImmediatePropagation()
            step()
            return
          }
          if (key === 'Enter' && selection !== null) {
            event.preventDefault()
            event.stopImmediatePropagation()
            finish()
            return
          }
          // Arrow-key nudging: the fine adjustment after the box is placed.
          if (selection !== null && key.startsWith('Arrow')) {
            event.preventDefault()
            event.stopImmediatePropagation()
            const step = event.shiftKey ? 10 : 1
            if (key === 'ArrowLeft') moveSelectionTo(selection.x - step, selection.y)
            if (key === 'ArrowRight') moveSelectionTo(selection.x + step, selection.y)
            if (key === 'ArrowUp') moveSelectionTo(selection.x, selection.y - step)
            if (key === 'ArrowDown') moveSelectionTo(selection.x, selection.y + step)
            render()
            placeToolbar()
          }
        }

        const CURSORS = {
          nw: 'nwse-resize', se: 'nwse-resize',
          ne: 'nesw-resize', sw: 'nesw-resize',
          n: 'ns-resize', s: 'ns-resize',
          e: 'ew-resize', w: 'ew-resize',
        }

        preview.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          // Only drags that start on the image itself: the toolbar and the text
          // editor live inside the overlay container, and pointerdown on those
          // bubbles up to the container as well.
          if (event.target !== preview) return
          event.preventDefault()
          const point = toBitmap(event)

          if (selection === null) {
            drag = { type: 'select', x1: point.x, y1: point.y, x2: point.x, y2: point.y }
            return
          }

          // Double click on a text mark re-opens its editor with the old text,
          // so a typo does not mean deleting and retyping the annotation.
          if (event.detail >= 2) {
            const existing = textAt(point)
            if (existing !== null) {
              openTextEditor(existing, { skipFocus: true, prefill: existing.text })
              return
            }
          }

          const hit = hitSelection(point)
          if (hit !== null) {
            drag = hit.type === 'move'
              ? { type: 'move', dx: point.x - selection.x, dy: point.y - selection.y }
              : { type: 'resize', id: hit.id }
            return
          }

          if (tool === 'text') {
            const mark = { type: 'text', x1: point.x, y1: point.y, x2: point.x, y2: point.y, color, text: '' }
            marks.push(mark)
            openTextEditor(mark)
            render()
            return
          }
          if (tool === 'rect' || tool === 'arrow') {
            marks.push({ type: tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color, done: false })
          }
        })

        preview.addEventListener('dblclick', (event) => {
          if (event.target !== preview || selection === null) return
          event.preventDefault()
        })

        preview.addEventListener('pointermove', (event) => {
          const point = toBitmap(event)

          if (drag === null) {
            // Cursor feedback for the adjust affordances.
            if (selection !== null && event.target === preview) {
              const hit = hitSelection(point)
              preview.style.cursor = hit === null
                ? (tool === 'text' ? 'text' : 'crosshair')
                : (hit.type === 'move' ? 'move' : (CURSORS[hit.id] || 'pointer'))
            }
            const last = marks[marks.length - 1]
            if (last === undefined || last.done === true) return
            last.x2 = point.x
            last.y2 = point.y
            render()
            return
          }

          if (drag.type === 'select') {
            drag.x2 = point.x
            drag.y2 = point.y
            render()
            return
          }
          if (drag.type === 'move') {
            moveSelectionTo(point.x - drag.dx, point.y - drag.dy)
            render()
            placeToolbar()
            return
          }
          if (drag.type === 'resize') {
            resizeSelection(point, drag.id)
            render()
            placeToolbar()
            return
          }
          const last = marks[marks.length - 1]
          if (last !== undefined && last.type !== 'text') {
            last.x2 = point.x
            last.y2 = point.y
            render()
          }
        })

        window.addEventListener('pointerup', () => {
          if (drag !== null && drag.type === 'select') {
            const box = normalize(drag)
            drag = null
            if (box.x2 - box.x1 < 6 || box.y2 - box.y1 < 6) {
              render()
              return
            }
            selection = { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 }
            tip.textContent = '拖框内可移动、拖八个手柄可缩放、方向键微调 · 回车/完成 确认'
            buildToolbar()
            render()
            return
          }
          drag = null
          const last = marks[marks.length - 1]
          if (last !== undefined) last.done = true
        })

        // Bubble phase on purpose: the inline text editor stops key events
        // before they reach here, and a window-level CAPTURE listener runs
        // first no matter what a descendant does.
        window.addEventListener('keydown', onKey)
        window.addEventListener('resize', layout)
        document.addEventListener('contextmenu', onContextMenu)

        tip.textContent = '拖动鼠标框选要发的区域 · Esc 取消'
        layout()
      })
    }

    // ── controller: capture -> overlay -> composer draft ─────────────────────
    class ShotController {
      constructor(ctx) {
        this.ctx = ctx
        this.busy = false
        this.listeners = new Set()
        this.stage = ''
      }

      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      publish() {
        for (const listener of [...this.listeners]) listener()
      }

      failure(message) {
        const sessionId = this.ctx.sessions.list.getSnapshot().current
        if (sessionId) {
          try {
            this.ctx.conversation.input.shell(sessionId).notify('error', message)
            return
          } catch {}
        }
        toast(message, true)
      }

      /** Put the finished PNG into the composer draft of the active conversation. */
      async deliver(blob, width, height) {
        let sessionId = this.targetSessionId || currentSessionIdOf(this.ctx)
        if (!sessionId) {
          // Only reached on the new-session screen. Create the conversation the
          // composer would have created on first send, and show it.
          // NOTE: navigation is NOT part of the sessions service — it lives on
          // uiWorkspace; keep the two in separate blocks so a missing
          // openSession() can never look like a failed create.
          try {
            sessionId = await this.ctx.sessions.create({})
          } catch (error) {
            this.failure(`新建会话失败：${error instanceof Error ? error.message : String(error)}`)
            return false
          }
          try {
            this.ctx.get('uiWorkspace')?.openSession?.(sessionId)
          } catch {}
        }
        if (!sessionId) {
          toast('先打开或新建一个会话再截图', true)
          return false
        }
        const file = new File([blob], `screenshot-${stamp()}.png`, { type: 'image/png' })
        const drafts = this.ctx.conversation.createDrafts(sessionId, [file])
        const ids = drafts.map((draft) => draft.id)
        const shell = this.ctx.conversation.input.shell(sessionId)
        const added = typeof shell.addAttachments === 'function'
          ? shell.addAttachments(ids)
          : shell.addImages(ids)
        if (!added) {
          if (typeof this.ctx.conversation.releaseDraftAttachments === 'function') {
            this.ctx.conversation.releaseDraftAttachments(drafts)
          }
          throw new Error('输入框当前不接受附件')
        }
        this.targetSessionId = sessionId
        // Deliberately NOT the composer's info-level notice: that renders as a
        // PERSISTENT role="status" bar with no close button, no timeout, and no
        // clear path anywhere in the client (only a newer notice replaces it),
        // so it would sit above the input box for the rest of the session. The
        // attachment thumbnail is the real confirmation; this transient toast
        // is just a nudge and removes itself.
        toast(`截图已放入输入框（${width}×${height}）`)
        return true
      }

      /**
       * @param {'direct'|'hide'} mode
       */
      async run(mode) {
        if (this.busy) return
        // Remember the destination now: after a hide/show cycle the DSH window
        // may not be the focused one, but the draft still belongs to whatever
        // conversation was open when the user pressed the button.
        this.targetSessionId = currentSessionIdOf(this.ctx)
        this.busy = true
        this.publish()
        try {
          // Deliberately NO fullscreen: the user asked for the window to stay
          // put, so the overlay covers the window and the shot is whatever the
          // window-size capture produced. The overlay still masks everything
          // outside the selection, so the selection is the only bright part.
          const response = await fetch(`${API}/capture`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hideWindow: mode === 'hide', settleMs: mode === 'hide' ? 400 : 0 }),
          })
          const body = await asJson(response)
          if (!body.id) throw new Error('宿主没有返回截图编号')
          const imageResponse = await fetch(`${API}/image?id=${encodeURIComponent(body.id)}`, { cache: 'no-store' })
          if (!imageResponse.ok) throw new Error(`读取截图失败（HTTP ${imageResponse.status}）`)
          const blob = await imageResponse.blob()
          const bitmap = await createImageBitmap(blob)
          this.busy = false
          this.publish()
          await openOverlay(bitmap, this)
        } catch (error) {
          this.failure(`截图失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          window.focus()
          this.busy = false
          this.publish()
        }
      }
    }

    // ── React surface ────────────────────────────────────────────────────────
    function CameraIcon() {
      return React.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round' },
        React.createElement('path', { d: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l.7-1.3A1.5 1.5 0 0 1 9.7 4h4.6a1.5 1.5 0 0 1 1.3.7L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z' }),
        React.createElement('circle', { cx: '12', cy: '12.5', r: '3.2' }),
      )
    }

    const ENTRIES = [
      { id: 'direct', label: '直接截图', hint: '框选并标注（截图时本窗口保持可见）' },
      { id: 'hide', label: '隐藏本窗口截图', hint: '先把本窗口藏起来，露出它背后的内容' },
    ]

    function ShotButton({ controller }) {
      const [open, setOpen] = React.useState(false)
      const [, setTick] = React.useState(0)
      const wrap = React.useRef(null)

      React.useEffect(() => controller.subscribe(() => setTick((value) => value + 1)), [controller])

      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          if (wrap.current && !wrap.current.contains(event.target)) setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      const busy = controller.busy
      return React.createElement('span', { className: 'dsh-shot-wrap', ref: wrap },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-shot-btn',
          title: busy ? '正在截图…' : '截图并放进输入框',
          'data-busy': busy ? 'true' : 'false',
          disabled: busy,
          onClick: () => setOpen((value) => !value),
          onContextMenu: (event) => {
            event.preventDefault()
            setOpen(true)
          },
        }, React.createElement(CameraIcon)),
        open && !busy
          ? React.createElement('div', { className: 'dsh-shot-menu', role: 'menu' },
              ENTRIES.map((entry) => React.createElement('button', {
                key: entry.id,
                type: 'button',
                role: 'menuitem',
                className: 'dsh-shot-item',
                onClick: () => {
                  setOpen(false)
                  void controller.run(entry.id)
                },
              },
              React.createElement('span', null, entry.label),
              React.createElement('small', null, entry.hint),
              )),
            )
          : null,
      )
    }

    function apply(ctx) {
      const controller = new ShotController(ctx)
      // Debug seam for the headless probes (and for a human poking at the
      // console): exposes the controller so the attachment pipeline can be
      // exercised without a real drag on the overlay.
      try {
        window.__dshShot = controller
        ctx.effect(() => () => {
          if (window.__dshShot === controller) delete window.__dshShot
        }, 'dsh-shot: debug seam')
      } catch {}
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-shot'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-shot: styles')

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'dsh-shot-button',
        order: 9000,
        label: 'Screenshot',
      }, () => React.createElement(ShotButton, { controller })))
    }

    exports.name = 'dsh-shot'
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

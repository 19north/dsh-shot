# dsh-shot

Composer screenshot control for **DeepSeek Harness**: a camera button next to `＋` in the
composer opens a two-item menu, and the capture is framed and annotated in an overlay **inside
the window** (no fullscreen, the window stays where it is). The result lands in the current
conversation's composer as an **image attachment**.

| Menu item | Behaviour |
|---|---|
| **Direct capture** | Grab the whole virtual screen immediately; whatever covers it is captured too. |
| **Hide this window** | Hide the DSH window first, capture, then restore it **exactly** as it was (including "was minimized"). |

**Windows only** — the capture itself is a PowerShell child that drives Win32 (window lookup,
hide/restore, DWM-aware screen grab).

---

## Requirements

- DeepSeek Harness `0.1.7` or newer, desktop/web profile.
- Windows (the host half shells out to `scripts/capture.ps1`).
- Node `^22.19.0 || >=24.0.0`.
- No runtime dependencies: the host half imports only `node:*` builtins.

## Install

```sh
# from a checkout
dsh plugin --profile <profile> add ./dsh-shot

# from a packed tarball
pnpm pack
dsh plugin --profile <profile> add ./dsh-shot-0.1.0.tgz

# from npm (once published)
dsh plugin --profile <profile> add dsh-shot
```

A package that declares `dsh.bundle` is appended to `dsh.profile.bundles` automatically, so the
layer is composed on the next boot. Verify without booting:

```sh
dsh --profile <profile> --dump-config   # look for the "== dsh-shot" layer
```

Then restart the app — the client bundle URL carries a build revision that is computed at
startup, so a page refresh is not enough for `lib/client.js` changes.

## Use

1. Click the camera button next to `＋` in the composer and pick one of the two menu items.
2. The overlay appears covering the window: **drag a box** to select a region.
3. Annotate if you want, then confirm.

| Action | Effect |
|---|---|
| Drag the **eight handles** (corners + edge midpoints) | Resize from that handle. |
| Drag **inside** the box | Move the box, keeping its size. |
| **Arrow keys** | Nudge by one pixel; hold **Shift** for ten. |
| **Right-click** / **Reselect** | Drop the selection and start over. |
| **Esc** / right-click | Step back one level (undo annotation → reselect → exit). |

Annotation tools: **rectangle**, **arrow**, **text** (click a point, type, **Enter** to confirm,
**Esc** to cancel; **double-click existing text to edit it**), an **eight-colour** palette, plus
**undo** and **reselect**. Text carries a translucent dark plate so it stays readable on any
background.

Confirming (or **Enter**) puts the image into the composer draft. It is an ordinary image
attachment: you can preview it, add a message, and it is only sent when you send.

## How it fits together

| Half | File | Runs in |
|---|---|---|
| Host | `lib/index.js` | DSH server; registers the `/api/dsh-shot/*` routes and spawns `scripts/capture.ps1`. |
| Client | `lib/client.js` | Browser; the composer button and the framing/annotation overlay. |
| Capture | `scripts/capture.ps1` | A detached PowerShell child; finds the DSH window, hides/restores it, grabs the virtual screen. |

The client half is declared in `package.json` under `dsh.client` and is served from
`/plugins/dsh-shot/client.js`.

## Known limitations

- **Windows only.** The capture path is Win32 + DWM.
- **The overlay covers the window**, not the screen. The whole capture is scaled to **fit**
  and centred, so nothing is cropped and the entire screen stays visible; the leftover margin is a
  dark letterbox. On a 2560x1440 screen with a 1296x828 window that is about 50px top and bottom.
  The scaling is recomputed from the window size every time the overlay opens, so a different
  screen or window size needs no configuration.
- **Multi-monitor** is captured as one virtual screen; it is all visible, but a small window
  shows it small.
- The **hide** mode briefly makes the DSH window disappear (roughly 0.3–1.2 s).
- Rare: the capture script can return an almost empty frame (a few tens of KB instead of several
  MB). Re-running the capture succeeds; an automatic retry is not implemented yet.

## Development

```sh
# static contract checks (patch, manifest, red lines)
dsh-plugin-dev check --cwd .

# pack + install/start/uninstall in a throwaway DSH_HOME
dsh-plugin-dev verify --cwd .
```

Headless regression suites for this plugin live outside the package, in
`dsh-screenshot-research/` (`test-host.mjs`, `test-client.mjs`, `deliver-probe.mjs`,
`e2e-shot.mjs`); they drive a throwaway headless Edge with a self-signed session cookie and never
touch a real browser profile.

`DESIGN.md` is the implementation and decision log: the measured evidence behind each design
choice, and the traps that were already paid for.

## License

MIT.

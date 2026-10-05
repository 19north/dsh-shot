# Installing `dsh-shot` from the tarball

This file is written for the agent (or person) **receiving** the tarball. It is the whole
procedure; nothing else is needed.

## What this is

A DeepSeek Harness plugin **bundle** that adds a screenshot control to the composer: a camera
button next to `＋`, an in-window box-select + annotate overlay, and the result dropped into the
composer as an image attachment. It has **no npm dependencies** and ships prebuilt — there is
nothing to compile and no build permission to grant.

## Requirements

- DeepSeek Harness `0.1.7` or newer, with a desktop/web profile on the machine.
- **Windows.** The capture half is PowerShell + Win32; on other platforms the button will appear
  but every capture will fail.

## Install

```sh
dsh plugin --profile <profile> add <path-to>/dsh-shot-0.1.0.tgz
```

Replace `<profile>` with the target profile (the DSH desktop app uses `desktop`) and
`<path-to>` with wherever the tarball actually is **on this machine** — do not reuse the sender's
path.

### The one way to get this wrong

**Use `dsh plugin add`, not `npm install` / `pnpm add` directly.**

- `dsh plugin add` installs the package *and* appends `dsh-shot` to `dsh.profile.bundles`, which
  is what makes the bundle's `cordis.patch.yml` layer compose at boot.
- A plain package-manager install puts the files in `node_modules` but activates **nothing**. The
  plugin would be present and silently inert, with no error to explain it.

If it was already installed the wrong way, the fix is the same command above (or
`POST /dsh-market/toggle {"name":"dsh-shot","enabled":true}` if it came through the market).

## Verify

1. The layer is composed:

   ```sh
   dsh --profile <profile> --dump-config | grep -A2 'dsh-shot'
   ```

   You should see a `# == dsh-shot` layer section.

2. The host half is live (needs a session cookie; the endpoint 401s without one):

   ```
   GET /api/dsh-shot/status   →   {"ok":true,"platform":"win32","scriptPresent":true,...}
   ```

   `scriptPresent: true` confirms `scripts/capture.ps1` arrived with the package. If it is
   `false`, the tarball was repacked without the `scripts/` directory.

3. Restart the app, then look at the composer: a **camera button** should sit next to `＋`.
   Clicking it must offer exactly two items: **Direct capture** and **Hide this window**.

A **restart is required** — the client bundle's build revision is computed at startup, so
reloading the page is not enough. If the button is missing after the restart, the layer was not
composed: re-check step 1 and whether the profile is the one the app is actually running.

## Uninstall

```sh
dsh plugin --profile <profile> remove dsh-shot
```

That removes both the dependency and the bundle layer.

## Known limitations (so they are not reported as bugs)

- **Windows only.**
- The overlay covers the **window**, not the screen: the capture is scaled to cover the window,
  so the edges whose aspect ratio does not match are cropped. Multi-monitor is captured as one
  virtual screen, and a small window cannot reach all of its corners.
- "Hide this window" makes the DSH window disappear for roughly 0.3–1.2 s.
- Rarely the capture script returns an almost empty frame (tens of KB instead of a few MB);
  capturing again succeeds.

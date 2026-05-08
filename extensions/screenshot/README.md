# Screenshot Extension

Gives the LLM tools to see what's on screen — list windows and capture screenshots.

## Tools

### `list_windows`

Lists all application windows with monitor info. Shows which windows are visible (on active workspace) and which are on other workspaces.

### `screenshot`

Captures the full screen or a specific application window.

| Parameter | Description |
|-----------|-------------|
| `target` | Optional. App name or window title to capture. Omit for full screen. |

Matches against window class and title (case-insensitive substring). Refuses to capture windows on inactive workspaces — would capture wrong content.

## Settings

Add to `settings.json`:

```json
{
  "screenshot": {
    "exclude": [
      { "class": "electron", "title": "Proton Pass" },
      { "class": "yubioath" },
      { "class": "1password" }
    ]
  }
}
```

### `exclude`

Array of rules to hide windows from both `list_windows` and `screenshot`. Useful for password managers, auth apps, etc.

Each rule can have:

| Field | Description |
|-------|-------------|
| `class` | Match against window class (case-insensitive substring) |
| `title` | Match against window title (case-insensitive substring) |

- `class` only → matches any window with that class
- `title` only → matches any window with that title
- Both → both must match (AND)

## Architecture

Strategy pattern with two provider types:

### Layout Providers

List monitors and windows. Interface: `LayoutProvider` in `types.ts`.

| Provider | File | Detects via |
|----------|------|-------------|
| Hyprland | `layout/hyprland.ts` | `hyprctl` + `$HYPRLAND_INSTANCE_SIGNATURE` |

### Capture Providers

Take screenshots. Interface: `CaptureProvider` in `types.ts`.

| Provider | File | Detects via |
|----------|------|-------------|
| Grimblast | `capture/grimblast.ts` | `grimblast` (+ `grim` for region capture) |

Grimblast/grim are wlroots tools — work on Hyprland, Sway, River, and other wlroots compositors.

### Adding a new platform

1. Add a layout provider in `layout/` implementing `LayoutProvider`
2. Add a capture provider in `capture/` implementing `CaptureProvider`
3. Push to the arrays in `index.ts` (order = priority, first compatible wins)

Layout and capture providers are independent — you can mix them (e.g. Hyprland layout + grimblast capture).

#### Layout Provider

File: `layout/<name>.ts`

```ts
import type { LayoutProvider, LayoutResult } from "../types.js";
import { exec, isLinux, resolveBin } from "../utils.js";

let compat: { ok: boolean; bin: string | null } | null = null;

async function checkCompat() {
  if (compat) return compat;
  if (!isLinux()) return (compat = { ok: false, bin: null });

  // Check env vars, binaries, etc.
  const bin = await resolveBin("my-tool");
  return (compat = { ok: bin !== null, bin });
}

export const myLayout: LayoutProvider = {
  name: "my-compositor",

  async isCompatible() {
    return (await checkCompat()).ok;
  },

  async getLayout(): Promise<LayoutResult> {
    const { ok, bin } = await checkCompat();
    if (!ok || !bin) throw new Error("Not compatible");

    // Query your compositor for monitors and windows.
    // Return normalized data:
    return {
      monitors: [
        {
          id: "1",
          name: "HDMI-A-1",
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
          scale: 1,
          activeWorkspace: "1",
        },
      ],
      windows: [
        {
          id: "0x123",
          title: "My App",
          appName: "myapp",
          pid: 1234,
          rect: { x: 0, y: 0, width: 960, height: 540 },
          focused: true,
          visible: true,   // on active workspace?
          workspace: "1",
          monitor: "1",
        },
      ],
    };
  },
};
```

Key rules:
- `isCompatible()` must cache its result after the first call
- Use `resolveBin()` from `utils.ts` to find binaries (also cached)
- All coordinates are global (absolute), not relative to monitor
- `visible` = window is on the active workspace of its monitor
- Only return `mapped` and non-`hidden` windows

#### Capture Provider

File: `capture/<name>.ts`

```ts
import type { CaptureProvider, CaptureResult, Rect } from "../types.js";
import { exec, isLinux, resolveBin } from "../utils.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

let compat: { ok: boolean; bin: string | null } | null = null;

async function checkCompat() {
  if (compat) return compat;
  if (!isLinux()) return (compat = { ok: false, bin: null });

  const bin = await resolveBin("my-capture-tool");
  return (compat = { ok: bin !== null, bin });
}

let counter = 0;
function tempPath(): string {
  return join(tmpdir(), `pi-screenshot-${Date.now()}-${counter++}.png`);
}

export const myCapture: CaptureProvider = {
  name: "my-capture",

  async isCompatible() {
    return (await checkCompat()).ok;
  },

  async captureAll(): Promise<CaptureResult> {
    const { ok, bin } = await checkCompat();
    if (!ok || !bin) throw new Error("Not compatible");

    const path = tempPath();
    // Capture full desktop to path
    await exec(bin, ["--fullscreen", path]);
    return { path, format: "png" };
  },

  async captureRegion(rect: Rect): Promise<CaptureResult> {
    const { ok, bin } = await checkCompat();
    if (!ok || !bin) throw new Error("Not compatible");

    const path = tempPath();
    // Capture region — format depends on your tool
    const geom = `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
    await exec(bin, ["--region", geom, path]);
    return { path, format: "png" };
  },
};
```

Key rules:
- `isCompatible()` must cache its result after the first call
- Write screenshots to temp files (the extension reads and deletes them)
- `captureRegion` receives global coordinates matching the layout provider's `Rect`
- Return the actual format written (`"png"` or `"jpg"`)

#### Registering

In `index.ts`, add to the provider arrays:

```ts
import { myLayout } from "./layout/my-compositor.js";
import { myCapture } from "./capture/my-capture.js";

// Order = priority. First compatible provider wins.
const layoutProviders: LayoutProvider[] = [myLayout, hyprlandLayout];
const captureProviders: CaptureProvider[] = [myCapture, grimblastCapture];
```

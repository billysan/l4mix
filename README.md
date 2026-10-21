# MIST

A local two-source video mixer with a matrix of knobs. Load clips, turn up their opacity, and process each source and the final mix independently.

## Run

Requires Node.js 20 or newer and a browser with WebGL2.

```sh
npm start
```

Open **http://localhost:5173**. No installation is needed to run the mixer. The server binds to the local machine only; files are opened through browser object URLs and are never uploaded or saved by the app. Close the server with Ctrl+C. Set `PORT` to use a different port.

## Play

- Drop up to **two video files** onto the window, or click the **+** beside **SOURCE**. Browser codec support determines which files play; MP4 and WebM are good starting points.
- Each source starts at **0% opacity**. Raise opacity to bring it into the mix. The master starts at 100%. Sources use screen blending: at 100%, each source combines with the others instead of hiding them. Black contributes nothing; opacity controls the strength of each source.
- Drag a knob up/down; hold Shift for finer movement. Use arrow keys, Page Up/Down, or Home/End with a focused knob. Double-click to reset. Click a displayed value to type a number; Enter commits and Escape cancels. Percentages are entered as 0–100.
- Pause, toggle looping, replace, reorder, or remove clips with the controls beside each thumbnail. Replacing a clip retains that row’s effect settings. Screen blending is independent of source order. Videos are muted.
- The global **RESET** restores every source and master effect, hides mapping handles, and restores all four corners. Each source’s **RESET** only resets that source’s effects (including opacity to zero); the master’s **RESET** only resets the master. Loaded clips and their transport settings are retained.
- **Open clean output** opens a separate picture-only window. Move it to another monitor and use its fullscreen button or double-click the picture. Allow local pop-ups if the browser blocks it. Keep the mixer open while using the output window.

The mixer interface is scaled to **140%**. Set Chrome’s page zoom to **100%** to use that intended size; browser zoom compounds with the built-in scale. Output resolution and the clean output window are unaffected.

## Controls

Every row has the same fixed chain. Spatial processing runs first, followed by RGB gains → brightness → contrast → saturation → hue rotation → inversion. Source opacity scales its contribution to the screen blend; master opacity fades the finished picture to black.

| Control | Range | Neutral |
| --- | --- | --- |
| Opacity | 0–100% | Source 0%, master 100% |
| Invert | 0–100% | 0% |
| Brightness | −100 to +100 | 0 |
| Contrast / saturation | 0–3× | 1× |
| Red / green / blue | 0–2× | 1× |
| Clone X / Y | 1–16 repeated, unflipped copies per axis | 1× |
| Hue | −180° to +180° | 0° |
| Pixelate | 1–128 source pixels per block | 1 px (off) |

Clips retain their aspect ratio and fit within the canvas. Empty areas are transparent while layering, with black behind the finished mix. Master effects also affect that black background.

## Output mapping

Enable **MAPPING** below the monitor to reveal four corner handles. Drag them to perspective-warp the combined image; both the monitor and clean output show the result. Handles and the outline are editing guides and never appear in clean output.

Use arrow keys on a focused handle to move it by 1%, or Shift+arrows for 0.1%. Double-click a handle to restore that corner. The mapping **RESET** restores all four corners. Unchecking **MAPPING** only hides the handles and outline; the warp remains applied to the monitor and clean output. Mapping reset remains available while handles are hidden.

This is a perspective corner-pin of a flat image, providing skew and apparent depth rather than a separate 3D scene. Corners remain within the output and cannot cross or collapse the image. Black fills areas outside the mapped quadrilateral. A changed mapping adds a final shader pass when the master is otherwise neutral; the default rectangle skips that pass.

## Performance

The default is **1280×720 with a 30 fps limit**. Select 960×540 or **640×360** on a CPU-only machine. 1920×1080 is also available. Resolution changes affect both preview and clean output.

WebGL2 may run on integrated graphics or a software renderer. Frame rate depends on the browser, driver, CPU, codec, source resolution, and effects. The app uploads only visible sources, downsizes uploads to fit the output resolution, combines color operations into one matrix, and skips the master pass when neutral. Lower-resolution source clips also reduce decoding work.

The status strip shows rendered frames per second and cumulative decoder-dropped frames for the current sources. Static or empty output can show 0 FPS because no new frames are needed. The 30 fps limit is a ceiling, not a performance guarantee. Separate-window output uses a canvas media stream and can add copying overhead. The visible output window drives rendering when the mixer is covered, including fullscreen. Completed frames are explicitly captured; rendering does not rely on the hidden mixer window’s animation frames or timers. Closing or hiding both windows can pause rendering.

A headless Chromium/SwiftShader run on the development machine measured about **20–23 fps at 720p**, **15 fps at 720p with the output window**, and **24–29 fps at 360p**, using two short synthetic 1080p VP8 clips with cloning and hue effects. These are reference measurements, not a guarantee for other clips or systems.

This version has no project saving, recording, MIDI, cameras, screen capture, a blend-mode selector, or freely reordered effect chains.

## Checks

```sh
npm install
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Browser tests use Chromium’s software WebGL renderer to exercise shader pixels, opacity blending, clone orientation, perspective mapping and reset isolation, color effects, context recovery, two-source limits, controls, transport, replacement/removal, clean output, fullscreen motion with suspended mixer clocks, screen blending at full opacity, hidden mapping guides, invalid files, and mobile overflow. The benchmark uses two generated 1080p VP8 clips; results are printed and attached in `test-results/`.

On NixOS, use an installed Nix Chromium instead of Playwright’s downloaded binary:

```sh
MIST_CHROMIUM=/path/to/chromium npm run test:browser
```

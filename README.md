# MIST

A local multi-source video mixer with a selected-channel knob workspace. Load clips, turn up their opacity, and process each source and the final mix independently.

## Run

Requires Node.js 20 or newer and a browser with WebGL2.

```sh
npm start
```

Open **http://localhost:5173**. No installation is needed to run the mixer. The server binds to the local machine only; files are opened through browser object URLs and are never uploaded or saved by the app. Close the server with Ctrl+C. Set `PORT` to use a different port.

## Play

- Drop **video files** onto the window, or click the **+** beside **SOURCE**. There is no fixed source-count limit; practical capacity depends on decoding and rendering resources. Browser codec support determines which files play; MP4 and WebM are good starting points.
- Each source starts at **0% opacity**. Raise opacity to bring it into the mix. The master starts at 100%. Sources use screen blending: at 100%, each source combines with the others instead of hiding them. Black contributes nothing; opacity controls the strength of each source.
- Select a source or **MASTER** in the left list to show its controls in the central grid. Each channel retains its own settings. **OPACITY** is separate, **RGB** groups the three gains, **COLORS** contains brightness, contrast, saturation and hue, **FX** holds invert, cloning and pixelation, **RGB SHIFT** separates the color planes, **SLIDE** moves and rotates the whole picture, and **EDGE** extracts contours. The selected channel is highlighted in the source list.
- **Ctrl+Left/Right** moves between source controls and knobs. **Ctrl+Up/Down** moves between source rows and MASTER, keeping the same parameter or closest available control. Click a control or press Ctrl+an arrow from the page to start; the selected control has a bright outline and scrolls into view. Plain arrows adjust knobs, and text fields retain normal Ctrl+arrow text navigation.
- Drag a knob up/down; hold Shift for finer movement. Use arrow keys, Page Up/Down, or Home/End with a focused knob. Double-click to reset. Click a displayed value to type a number; Enter commits and Escape cancels. Percentages are entered as 0–100.
- Pause playback with the controls beside each source. The eject icon opens the replacement file picker; cancelling keeps the current clip. Clicking the filename selects its channel; use eject to replace its clip. Replacements retain that row’s effects and preview preference. The × button removes a source. Screen blending is independent of source order. Videos are muted.
- Source previews start **off**. A centered eye button in each monitor tile reveals the existing video element, without opening another decoder. Turning the eye off avoids painting that preview; active clips still need decoding for the mix.
- The **MASTER** row uses the same centered eye toggle as each source. Its pause button pauses all sources together and resumes only the ones that were playing. Its eye hides the large output monitor while preserving clean output. With that monitor hidden and no output window open, compositing stops until needed again.
- The global **RESET** restores every source and master effect and all channel mapping bounds. Each source’s **RESET** resets that source’s effects and mapping (including opacity to zero); the master’s **RESET** resets only the master effects and mapping. Loaded clips and their transport settings are retained.
- **Open clean output** opens a separate picture-only window. Move it to another monitor and use its fullscreen button or double-click the picture. Allow local pop-ups if the browser blocks it. Keep the mixer open while using the output window.

The dashboard uses a locally bundled **BigBlueTermPlus Nerd Font Mono** font by VileR, patched by Nerd Fonts. It needs no system font installation or network access at runtime. Font attribution and licenses are in [assets/fonts/README.md](assets/fonts/README.md). Thin dark-red table borders and a faint red grid accent the grayscale controls; knob, button and monitor outlines stay gray.

The mixer interface is scaled to **140%**. Set Chrome’s page zoom to **100%** to use that intended size; browser zoom compounds with the built-in scale. Output resolution and the clean output window are unaffected.

## Browser choice

**Chromium is the recommended browser for this build.** In a local headless spot check using two 360p H.264 sample clips, 720p output, source previews off, cloning and hue effects, Chromium 150 with SwiftShader reached 30 fps and Firefox 152 reached about 20 fps. This compares those specific configurations; desktop performance can differ. Firefox successfully loaded and mixed the same clips.

## Themes

Choose **THEME** below the monitor: **CLASSIC** keeps the original gray dashboard and subtle red table grid; **DARK** uses near-black slate; **SUNSET** uses plum and warm peach; **TROPICANA** follows [Tiki Love Dark by k00k](https://ghostty-style.vercel.app/config/tiki-love-dark): warm wood browns, torch orange, bamboo green and palm sage. All keep the BigBlueTerm font and centered headings.

The selection is saved locally and restored before the first paint, and open mixer tabs stay in sync. If browser storage is blocked, themes still work for the session. Unknown saved values fall back to CLASSIC. Themes affect interface colors only; video output, loaded clips, effects, mapping, resolution and transport are unchanged. RESET retains the chosen theme.

## Controls

Every channel has the same fixed chain; the workspace grouping is for navigation and does not change processing order. Slide and independent RGB shifts use output-frame coordinates, with positive X moving right and positive Y moving down. Each sample then applies aspect fit, cloning and pixelation, followed by RGB gains → brightness → contrast → saturation → hue rotation → inversion. Source opacity scales its contribution to the screen blend; master opacity fades the finished picture to black.

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
| R / G / B X and Y | −100 to +100% of the output width / height | 0% |
| Edge amount / threshold | 0–100% | Amount 0% (off), threshold 10% |
| Edge width | 1–8 output pixels | 1 px |
| Rotate (in SLIDE) | 0–360°, clockwise around the picture center | 0° |
| Slide X and Y | −100 to +100% of the output width / height | 0% |

RGB shifts, slide and rotation leave empty edges without wrapping. Rotation preserves proportions at rectangular output resolutions, then slide moves the rotated picture. Empty source areas reveal the mix underneath; empty master areas are black. The eight shift controls and rotation start at zero and participate in channel and global resets. Neutral RGB shift uses one texture sample; enabled RGB separation uses three in the same shader pass.

Clips retain their aspect ratio and fit within the canvas. Empty areas are transparent while layering, with black behind the finished mix. Master effects also affect that black background.

EDGE compares luminance at the center and two neighboring positions after spatial and color effects, in the existing shader pass. AMOUNT blends between the original image (0%) and bright contours on black (100%); THRESHOLD suppresses weaker differences, and WIDTH changes the neighbor spacing in output pixels before mapping. Source opacity and screen blending still apply. All three controls work on sources and MASTER and participate in resets. The disabled shader variant omits neighbor reads entirely, even if threshold or width has been changed. Enabled EDGE uses three image samples, or nine when combined with RGB SHIFT on the same channel; lower the output resolution if that combination is slow on software WebGL. A short headless Chromium/SwiftShader check with two 640×360 VP8 clips measured 28 fps without EDGE, 17–22 fps with EDGE on the first source at 720p, 11 fps with EDGE plus RGB SHIFT, and 29–30 fps for that combination at 360p. These are local samples, not a guaranteed frame rate.

## Per-channel mapping

Every source and MASTER has a **🗺️ MAPPING** group in its table, with four coordinate knobs:

- **X1 / X2**: left and right edges, as percentages of output width.
- **Y1 / Y2**: top and bottom edges, as percentages of output height, measured from the top.

The full-frame default is X1=0%, X2=100%, Y1=0%, Y2=100%. These bounds place and resize the processed image within a rectangle; they do not crop it or independently skew four corners. The separate ROTATE control rotates the image. Bounds cannot cross or collapse, retaining at least a 0.1% gap. Drag, type percentages, or use the usual knob keyboard controls.

Each source is mapped before screen blending. Empty areas reveal the other sources beneath it. MASTER maps the final mix, so empty areas are black. MAPPING’s own **RESET** restores only that channel’s four bounds and preserves its other effects. Source/master RESET includes that channel’s mapping; global RESET restores all mappings. Replacing a clip retains its mapping. Switching channels retains all coordinate values.

Mapping uses a cached affine matrix in the existing source shader pass, with no new source textures, decoders or draw passes. Default bounds skip the mapping calculation. Master mapping uses the existing final master pass; if the master was otherwise neutral, changing its bounds adds that final pass. Mapping controls have no extra live video previews or editing overlay. A local software-WebGL benchmark with three static 640×360 textures at 1080p measured median render plus synchronized readback times of 60.55 ms without mapping, 63.65 ms with source mapping, and 88.30 ms with source and master mapping. This isolates rendering and readback; it excludes decoding and is not an end-to-end FPS estimate or a prediction for a discrete GPU.

## Performance

The default is **1920×1080 with a 30 fps limit**. Select 960×540 or **640×360** on a CPU-only machine. 1280×720 is also available. Resolution changes affect both preview and clean output.

WebGL2 may run on integrated graphics or a software renderer. Frame rate depends on the browser, driver, CPU, codec, source resolution, and effects. The app uploads only visible sources, downsizes uploads to fit the output resolution, combines color operations into one matrix, and skips the master pass when neutral. Lower-resolution source clips also reduce decoding work.

The panel below the monitor also shows **CPU**, **GPU**, and **RAM** for the whole computer, sampled through the local server every 1.5 seconds. CPU uses differences in OS core counters; Linux RAM excludes available cache. GPU utilization is shown only when a Linux driver exposes `gpu_busy_percent` (the busiest supported card if there are several); otherwise it shows a dash. Missing telemetry or an unreachable server also shows a dash. **RENDER CPU** is average CPU time submitting a rendered frame, not GPU completion time or total system utilization. No GPU synchronization is added for measurement.

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

Browser tests use Chromium’s software WebGL renderer to exercise shader pixels, opacity blending, clone orientation, perspective mapping and reset isolation, color effects, context recovery, multiple-source loading and layout, controls, transport, replacement/removal, preview toggles, master pause/resume, replacement through eject, clean output, fullscreen motion with suspended mixer clocks, screen blending at full opacity, per-channel mapping bounds and reset isolation, invalid files, and mobile overflow. The benchmark uses two generated 1080p VP8 clips; results are printed and attached in `test-results/`.

On NixOS, use an installed Nix Chromium instead of Playwright’s downloaded binary:

```sh
MIST_CHROMIUM=/path/to/chromium npm run test:browser
```

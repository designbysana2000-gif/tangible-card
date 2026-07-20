# Tangible Studios — AR Business Card

A working scaffold of the full interaction flow described in the brief. Right now
every 3D model is a **placeholder primitive** (boxes, cones, cylinders) so you can
test taps, the Tech Room → Florana Room transition, the tree-growth animation, and
the back button — all before your Blender/Unity exports or `targets.mind` exist.

## What's here

```
tangible-card/
├── index.html      instruction screen, HUD, coin popup, Florana sign — all UI
├── world.js         all Three.js scene + interaction logic (shared by both modes)
└── targets.mind      ← you add this once trained (see below)
```

Two entry points, both reachable from the landing screen:

- **"Test without the card"** — no camera, no MindAR, fixed camera looking at the
  scene. Use this to check taps/transitions/animation on your phone or laptop
  right now, exactly like the brief's "skip image tracking" testing option.
- **"Point camera at the card"** — real MindAR image-tracking mode. This needs
  `targets.mind` to exist in the project folder or it will fail with a clear
  on-screen message instead of a silent crash.

## Try it locally

Browsers block camera access and ES module imports from `file://`, so serve the
folder over http:

```bash
cd tangible-card
python3 -m http.server 8080
# visit http://localhost:8080 on your phone (same wifi) or laptop
```

Tap "Test without the card" first — that's the fastest way to confirm the whole
flow (Contact → mailto, Coin → popup, Plant → spin → tree grows → sign appears →
Back → returns to Tech Room) before worrying about tracking at all.

## Swapping in your real Blender/Unity GLBs

In `world.js`, every placeholder mesh is built inside `_buildTechRoom()` and
`_buildFloranaRoom()`, marked with a `// PLACEHOLDER GEOMETRY` comment. Replace
each with a `GLTFLoader` load of your exported file, keeping the same
`object.name` values (`contactCard`, `coin`, `plant`, `techRoom`, `floranaRoom`,
`tree`) — the raycaster and animation code look objects up by those names, so
nothing else needs to change if the names match. Example swap:

```js
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const loader = new GLTFLoader();

const gltf = await loader.loadAsync("./tech_room.glb");
const techRoom = gltf.scene;
techRoom.name = "techRoom";
// find and name the tappable children the same way, e.g.:
techRoom.getObjectByName("Coin_Mesh").name = "coin";
```

If your Blender tree-growth animation is a baked Unity/GLB animation clip rather
than a simple scale tween, swap `_startTreeGrowth()` to drive an
`AnimationMixer` instead of the manual scale interpolation — the completion
callback (`_showFloranaSign`) can then fire on the mixer's `finished` event.

## Training targets.mind (needed for real AR mode)

1. Get a clean, high-contrast photo of the card **front** (the side MindAR
   tracks) — flat lighting, no glare, fills the frame.
2. Run it through the MindAR image target compiler:
   https://hiukim.github.io/mind-ar-js-doc/tools/compile
3. Download the generated `targets.mind` and drop it into this folder.
4. More distinct visual detail on the card front (logo + texture + contrast)
   tracks noticeably better than a flat logo on white — worth knowing before
   finalizing the print design.

## Deploying to GitHub Pages

```bash
# inside tangible-card/, with targets.mind and your real GLBs in place
git init
git remote add origin https://github.com/designbysana2000-gif/tangible-ar.git
git add .
git commit -m "Tangible Studios AR business card"
git push -u origin main
```

Then in the repo's Settings → Pages, set the source to the `main` branch, root
folder. Your live URL will be:

```
https://designbysana2000-gif.github.io/tangible-ar/
```

Point the QR code on the card back at that URL.

## Notes / things worth deciding next

- **GLB file size**: keep each model as low-poly as you can and compress
  textures — mobile Safari/Chrome loading three GLBs over a phone's camera
  connection is the most likely place this feels slow. `gltf-transform` or
  Blender's glTF export compression (Draco) helps a lot.
- **iOS Safari camera permissions**: MindAR needs `https` (GitHub Pages gives
  you this for free) — camera access silently fails over plain `http`.
- **Coin popup content**: currently placeholder copy in `index.html`'s
  `#coinPopup` — swap in your real "About Tangible Studios" text once decided.
- **Florana popup**: brief lists `florana_popup.glb` as a 3D popup; this
  scaffold implements it as an HTML overlay (`#floranaSign`) instead, which is
  lighter-weight and easier to typeset. Swap to a 3D plane/sign mesh in
  `_buildFloranaRoom()` if you'd rather it live inside the AR scene itself.

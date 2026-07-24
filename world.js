import * as THREE from "three";

/**
 * TangibleWorld
 * -------------
 * Builds the Tech Room + Florana Room as ONE back-to-back "capsule" —
 * matching the real RoomMaster.blend structure, where both rooms share a
 * spine and face opposite directions. Only one room's opening ever faces
 * the camera at a time; getting from one to the other is a single 180°
 * rotation of the whole capsule, not swapping two separate objects'
 * visibility.
 *
 * SWAP-IN POINT: everywhere you see "// PLACEHOLDER GEOMETRY" below, replace
 * the primitive mesh with a GLTFLoader-loaded model of the same name. Keep
 * the object.name values (contactCard, coin, seed, techRoom, floranaRoom,
 * tree) since the raycaster and animation code look objects up by name.
 */
class TangibleWorld {
  constructor() {
    this.mode = null; // "test" | "ar"
    this.onRoomChange = () => {};
    this.currentRoom = "tech";
    this._transitioning = false;
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._clock = new THREE.Clock();
    this._seedFall = null; // { start, duration, target, startY, done }
    this._treeAnim = null; // { start, duration, done }
    this._treeGrown = false;
    this._spin = null; // { start, duration, onDone }
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3();
  }

  /* ============================================================
     Scene construction (shared by both modes)
     Both rooms are ALWAYS in the scene, permanently attached back-to-back
     inside one capsule group. Whichever one currently faces the camera is
     simply whichever way the capsule is rotated — there's no hide/show.
     ============================================================ */
  async _buildScene(root) {
    this.capsule = new THREE.Group();
    this.capsule.name = "capsule";

    this.techRoom = await this._buildTechRoom();
    this.floranaRoom = await this._buildFloranaRoom();
    // (Previously forced to Math.PI here for the back-to-back capsule
    // layout — but that was overwriting the specific rotation value
    // tuned live for this exact model, undoing the fix. The tuned value
    // set inside _buildFloranaRoom already accounts for everything
    // needed, so this no longer applies any extra rotation.)
    // Hidden until the seed is planted and the capsule turns — this keeps
    // its (currently backless, placeholder) geometry from peeking through
    // before it's actually meant to be seen.
    this.floranaRoom.visible = false;

    this.capsule.add(this.techRoom, this.floranaRoom);
    root.add(this.capsule);
  }

  // Shared loader setup with Draco decompression support attached — any
  // GLB using Draco mesh compression (common once you compress textures/
  // geometry for file size) needs this or it fails to load entirely.
  async _createGLTFLoader() {
    const { GLTFLoader } = await import(
      "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js"
    );
    const { DRACOLoader } = await import(
      "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js"
    );
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    return loader;
  }

  async _buildTechRoom() {
    const loader = await this._createGLTFLoader();
    const gltf = await loader.loadAsync("./tech_room.glb?v=4");
    const group = gltf.scene;
    group.name = "techRoom";
    // The model's own "forward" direction from export doesn't match what
    // we assumed — nudge it to face the camera. Try 90°-increment values
    // here (Math.PI/2, Math.PI, -Math.PI/2) until the open front faces you.
    group.rotation.y = -Math.PI / 2;

    // Your GLB already has these pieces named — we just point our standard
    // tap-target names (contactCard, coin, seed) at whichever real node
    // matches, so the existing tap/animation code doesn't need to change
    // at all. If the model gets re-exported later with different names,
    // update the strings on the right below.
    this._renameFirstMatch(group, ["Card_Export", "Card_GEo1"], "contactCard");
    this._renameFirstMatch(group, ["CoinCapsule"], "coin");
    this._renameFirstMatch(group, ["seed_fbx"], "seed");
    // The coin already has a glass "capsule" container in the model that
    // makes it easy to tap. The seed doesn't have an equivalent container
    // yet, so we add an invisible, generously-sized sphere around it
    // purely as a bigger tap target — it's transparent, so it changes
    // nothing about how the seed actually looks.
    this._addGenerousHitTarget(group, "seed", 2);
    // Remember each seed node's real starting position/scale from the
    // actual model, so we can restore it precisely later — using guessed
    // numbers here caused it to snap to the wrong spot after a return trip.
    this._seedInitial = this._getAllNamed(group, "seed").map((node) => ({
      node,
      position: node.position.clone(),
      scale: node.scale.clone(),
    }));

    // Your model now has its own baked seed-falling animation — using
    // that directly instead of us guessing a fall direction in code,
    // since that's already correct exactly as you built it in Blender.
    if (gltf.animations && gltf.animations.length > 0) {
      this._techMixer = new THREE.AnimationMixer(group);
      this._seedClipAction = this._techMixer.clipAction(gltf.animations[0]);
      this._seedClipAction.setLoop(THREE.LoopOnce);
      this._seedClipAction.clampWhenFinished = true;
      this._techMixer.addEventListener("finished", (e) => {
        if (e.action === this._seedClipAction) this._startCapsuleTurn();
      });
    }

    const light = new THREE.PointLight(0xffffff, 1.1, 3);
    light.position.set(0.3, 0.8, 0.3);
    group.add(light);
    group.add(new THREE.AmbientLight(0xffffff, 0.5));

    return group;
  }

  // Finds every node whose name matches (or starts with) any of the given
  // candidate names, and relabels all of them. Some exports have a
  // duplicate or wrapper/child pair sharing a similar name (e.g.
  // "seed_fbx" and "seed_fbx.001") — renaming only the first one risks
  // tagging an invisible helper node instead of the one actually on
  // screen, which is why we tag every match rather than stopping early.
  _renameFirstMatch(root, candidates, standardName) {
    let matchCount = 0;
    root.traverse((obj) => {
      if (!obj.name) return;
      if (candidates.some((c) => obj.name === c || obj.name.startsWith(c))) {
        obj.name = standardName;
        matchCount++;
      }
    });
    if (matchCount === 0) {
      const allNames = [];
      root.traverse((obj) => { if (obj.name) allNames.push(obj.name); });
      console.warn(`Could not find a node matching [${candidates.join(", ")}] for "${standardName}" — tapping it won't work until the name is fixed.`);
      console.warn(`All ${allNames.length} node names actually present:`, allNames);
    }
  }

  async _buildFloranaRoom() {
    const loader = await this._createGLTFLoader();
    const gltf = await loader.loadAsync("./florana_room.glb?v=2");
    const group = gltf.scene;
    group.name = "floranaRoom";
    // (Earlier we tried re-centering based on the combined bounding box,
    // but that was skewed by the tree object sitting far from the room —
    // the room shell itself is already correctly centered at its own
    // origin in the source file, so no re-centering is actually needed.)

    // Found via live console testing (see conversation) rather than
    // guessed 90° increments — this model's export apparently wasn't at
    // a clean axis-aligned angle, so it needed a precise value instead.
    group.rotation.y = -1.63;
    group.position.x = 0.1;
    // This is a separate Blender export from the tech room, so it likely
    // has its own native scale — guessing small here since a huge flat
    // panel filling the screen was exactly what the tech room looked
    // like before its scale (not rotation) turned out to be the real fix.
    group.scale.setScalar(0.7);

    this._renameFirstMatch(group, ["tree003_4", "tree.003_4"], "tree");

    // Most of this model's materials came through at metallic=1 (the
    // glTF spec's DEFAULT value when metalness was never explicitly set
    // in Blender) — fully metallic surfaces render almost black without
    // an environment/reflection map, which we don't have. Forcing
    // metalness down lets the actual base color textures show through
    // properly instead of rendering as flat dark shapes.
    group.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (m.metalness !== undefined) m.metalness = 0;
        if (m.roughness !== undefined) m.roughness = 0.8;
      });
    });

    // Your model has its own baked growth animation(s) — using those
    // directly instead of the manual scale-up placeholder animation,
    // same approach that worked well for the seed.
    if (gltf.animations && gltf.animations.length > 0) {
      this._floranaMixer = new THREE.AnimationMixer(group);
      this._treeClipActions = gltf.animations.map((clip) => {
        const action = this._floranaMixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        return action;
      });
      this._treeFinishedCount = 0;
      this._floranaMixer.addEventListener("finished", () => {
        this._treeFinishedCount++;
        // Wait for all clips (trunk + leaves, etc.) to finish before
        // showing the sign, in case the model has more than one.
        if (this._treeFinishedCount >= this._treeClipActions.length) {
          this._showFloranaSign();
          this._treeGrown = true;
        }
      });
    }

    const light = new THREE.PointLight(0xffffff, 1, 3);
    light.position.set(0.3, 0.8, 0.3);
    group.add(light);
    group.add(new THREE.AmbientLight(0xffffff, 0.6));

    return group;
  }

  /* ============================================================
     Public: start in test mode.
     Tries to open the phone's back camera as a live passthrough
     background so the room feels like it's sitting in front of you,
     with no card or image-tracking required. Falls back to a plain
     dark background if no camera is available (e.g. on a desktop
     with no webcam, or if permission is denied).
     ============================================================ */
  async startTestMode(container) {
    this.mode = "test";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    await this._tryStartCameraPassthrough(container);
    if (!this._passthroughActive) {
      this.scene.background = new THREE.Color(0x14130f);
    }

    this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 20);
    // Slightly lower and closer than the old diorama view so the room
    // reads as "sitting on the surface in front of you" over live video.
    this.camera.position.set(0, 0.55, 0.9);
    this.camera.lookAt(0, 0.2, -0.3);

    await this._buildScene(this.scene);
    this._bindPointer(this.renderer.domElement, this.camera);
    window.addEventListener("resize", () => this._onResize());
    this._animate();
  }

  async _tryStartCameraPassthrough(container) {
    this._passthroughActive = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.muted = true;
      await video.play();

      video.style.position = "fixed";
      video.style.inset = "0";
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "cover";
      video.style.zIndex = "0";
      container.style.background = "transparent";
      container.insertBefore(video, container.firstChild);
      this.renderer.domElement.style.position = "relative";
      this.renderer.domElement.style.zIndex = "1";

      this._videoEl = video;
      this._passthroughActive = true;
    } catch (err) {
      // Camera denied or unavailable — silently fall back to the plain
      // background set by the caller. This is expected on desktops
      // without a webcam, so it isn't logged as an error to the user.
      this._passthroughActive = false;
    }
  }

  /* ============================================================
     Public: start in AR mode via MindAR image tracking
     Requires targets.mind (trained on the card front) in the same folder.
     ============================================================ */
  async startARMode(container) {
    this.mode = "ar";
    // Loaded lazily so test mode never needs MindAR or camera permissions.
    const { MindARThree } = await import(
      "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js"
    );

    const mindarThree = new MindARThree({
      container,
      imageTargetSrc: "./targets.mind",
    });
    this._mindar = mindarThree;
    const { renderer, scene, camera } = mindarThree;
    this.renderer = renderer;
    this.renderer.domElement.style.touchAction = "none";
    this.scene = scene;
    this.camera = camera;

    const anchor = mindarThree.addAnchor(0);

    // The tracked image lies flat on the table with its anchor's Z axis
    // pointing straight up off the card. Our room is modeled Y-up (like
    // a normal room). A full 90° stand-up means looking straight down
    // from overhead (the natural way to view a flat card) shows mostly
    // the roof rather than the interior — so we lean it back a bit less
    // than a full 90°, more like leaning a picture frame back for a
    // seated viewer, so the opening reads clearly from a typical
    // overhead phone angle instead of needing to hold the card upright.
    const stageUpright = new THREE.Group();
    stageUpright.rotation.x = Math.PI * 0.4; // ~72°, was a full 90°
    // Bigger than before, and raised up off the card's surface — was
    // sitting right at table height, which read as "too low."
    stageUpright.scale.setScalar(0.5);
    stageUpright.position.z = 0.2;
    anchor.group.add(stageUpright);
    await this._buildScene(stageUpright);

    this._bindPointer(renderer.domElement, camera);

    await mindarThree.start();
    renderer.setAnimationLoop(() => this._tick());
  }

  /* ============================================================
     Pointer / tap interaction
     Uses pointerdown (covers touch + mouse) with preventDefault so a
     tap can't get swallowed by the browser as a scroll/zoom gesture.
     ============================================================ */
  _bindPointer(domElement, camera) {
    const handleTap = (e) => {
      const point = e.changedTouches ? e.changedTouches[0] : e;
      const rect = domElement.getBoundingClientRect();
      this._pointer.x = ((point.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((point.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._pointer, camera);

      // Only test the currently active room's own children. Three.js
      // raycasting does NOT automatically respect the .visible flag —
      // that only affects rendering — so testing the whole capsule meant
      // taps in Florana could still hit the tech room's (hidden but
      // still physically present) coin geometry sitting underneath it,
      // occasionally hijacking a tap meant for the tree.
      const activeRoom = this.currentRoom === "tech" ? this.techRoom : this.floranaRoom;
      const hits = this._raycaster.intersectObjects(activeRoom.children, true);
      if (!hits.length) {
        console.log("Tap: hit nothing.");
        return;
      }

      // The seed's hit zone is oversized and can overlap nearby objects
      // (see world.js history), so a precisely-named hit like "coin" or
      // "contactCard" anywhere along this ray always wins over "seed" or
      // "tree", even if the seed zone happens to be physically closer.
      let hit = null;
      let fallback = null;
      for (const h of hits) {
        const resolved = this._findNamed(h.object);
        if (!resolved) continue;
        if (resolved.name === "coin" || resolved.name === "contactCard") {
          hit = resolved;
          break;
        }
        if (!fallback) fallback = resolved;
      }
      if (!hit) hit = fallback;

      console.log(`Tap: hit "${hits[0].object.name || "(unnamed mesh)"}" — resolved to "${hit ? hit.name : "no match"}". World point: (${hits[0].point.x.toFixed(3)}, ${hits[0].point.y.toFixed(3)}, ${hits[0].point.z.toFixed(3)})`);
      if (!hit) return;

      if (hit.name === "contactCard") this._openContact();
      else if (hit.name === "coin") this.openCoinPopup();
      else if (hit.name === "seed") this._transitionToFlorana();
      else if (hit.name === "tree" && this.currentRoom === "florana" && this._treeGrown) {
        this.goBackToTechRoom();
      }
    };

    // Bound to window, not domElement: MindAR (and some browser chrome)
    // can place invisible overlay layers on top of the render canvas for
    // their own scanning UI, which would otherwise swallow the tap before
    // it ever reaches our canvas. Listening at the window level means we
    // still catch it regardless of which element visually received it.
    window.addEventListener("pointerdown", handleTap, { passive: true });
    window.addEventListener("touchstart", handleTap, { passive: true });
  }

  // Wraps every node with the given name in an invisible, generously
  // sized sphere used only for raycasting — makes small objects much
  // easier to tap accurately without changing how they actually look.
  // The sphere is a CHILD of the node (so it inherits its transform
  // correctly), but offset within the node's own local space to sit at
  // the geometry's actual visual center — FBX-imported assets often have
  // a pivot point far from where the mesh actually appears, so centering
  // on local (0,0,0) alone isn't reliable.
  _addGenerousHitTarget(root, name, paddingScale) {
    const nodes = this._getAllNamed(root, name);
    console.log(`Hit-target setup for "${name}": found ${nodes.length} matching node(s).`);
    nodes.forEach((node) => {
      const box = new THREE.Box3().setFromObject(node);
      let radius = 0.06; // sensible fallback if the box comes back empty
      let localCenter = new THREE.Vector3(0, 0, 0);
      if (!box.isEmpty()) {
        const size = new THREE.Vector3();
        const worldCenter = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(worldCenter);
        radius = (Math.max(size.x, size.y, size.z) / 2) * paddingScale;
        // Convert the geometry's real center into this node's own local
        // space, since the node's pivot may not be at (0,0,0) visually.
        localCenter = node.worldToLocal(worldCenter.clone());
        console.log(`  "${node.name}" visual center is offset from its pivot by (${localCenter.x.toFixed(3)}, ${localCenter.y.toFixed(3)}, ${localCenter.z.toFixed(3)}) in local space.`);
      } else {
        console.log(`  "${node.name}" had an empty bounding box — using fallback radius, centered at pivot.`);
      }

      const hitSphere = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(radius, 0.15), 12, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hitSphere.name = name;
      hitSphere.position.copy(localCenter);
      node.add(hitSphere);
      console.log(`  Added hit sphere (radius ${radius.toFixed(3)}) as a child of that node.`);
    });
  }

  // Returns every descendant with the given name, since a model can end
  // up with more than one node sharing a name after our renaming pass.
  _getAllNamed(root, name) {
    const found = [];
    root.traverse((obj) => {
      if (obj.name === name) found.push(obj);
    });
    return found;
  }

  _findNamed(obj) {
    let o = obj;
    while (o) {
      if (["contactCard", "coin", "seed", "tree"].includes(o.name)) return o;
      o = o.parent;
    }
    return null;
  }

  _openContact() {
    window.location.href = "mailto:hello@designbysana.com?subject=Hi%20Tangible%20Studios";
  }

  openCoinPopup() {
    document.getElementById("coinPopup").classList.add("open");
  }

  closeCoinPopup() {
    document.getElementById("coinPopup").classList.remove("open");
  }

  /* ============================================================
     Room transition: tap the seed → it falls and disappears → the
     whole capsule rotates 180° to bring Florana's opening around to
     face the camera → tree grows → sign appears on completion.
     ============================================================ */
  _transitionToFlorana() {
    if (this._transitioning || this.currentRoom !== "tech") return;
    this._transitioning = true;

    if (this._seedClipAction) {
      // Use your model's own baked falling animation — it's already
      // correct exactly as built in Blender, no direction guessing.
      this._seedClipAction.reset().play();
      // _startCapsuleTurn() fires automatically via the mixer's
      // "finished" event once this animation completes (see _buildTechRoom).
    } else {
      // Fallback if no animation is present: shrink the seed in place.
      const seeds = this._getAllNamed(this.techRoom, "seed");
      this._seedFall = {
        start: this._clock.getElapsedTime(),
        duration: 0.45,
        targets: seeds,
        done: false,
      };
    }
  }

  _startCapsuleTurn() {
    this._spin = {
      start: this._clock.getElapsedTime(),
      duration: 0.6,
      onDone: () => {
        this.currentRoom = "florana";
        this.onRoomChange("florana");
        // The tech room has now fully turned away — hide it outright so
        // it's genuinely gone, not just facing the wrong direction.
        this.techRoom.visible = false;
        this.floranaRoom.visible = true;
        this._startTreeGrowth();
        this._transitioning = false;
      },
    };
  }

  goBackToTechRoom() {
    if (this.currentRoom !== "florana" || this._transitioning) return;
    this._transitioning = true;
    document.getElementById("floranaSign").classList.remove("show");
    // Bring the tech room back into existence for the return trip.
    this.techRoom.visible = true;

    this._spin = {
      start: this._clock.getElapsedTime(),
      duration: 0.6,
      reverse: true,
      onDone: () => {
        this.currentRoom = "tech";
        this.onRoomChange("tech");
        // Florana has now fully turned away — hide it outright.
        this.floranaRoom.visible = false;

        // The animation targets a mesh nested several levels deeper than
        // the node we can easily grab by name, so manually resetting
        // position/scale on the outer node never touched the real
        // animated geometry. Instead, we use the animation system itself
        // to snap back to frame zero — reset and play, apply that first
        // frame's pose immediately, then freeze it there.
        if (this._seedClipAction) {
          this._seedClipAction.reset();
          this._seedClipAction.paused = false;
          this._seedClipAction.play();
          this._techMixer.update(0);
          this._seedClipAction.paused = true;
        }

        // Also restore anything we CAN reliably reset directly (the
        // outer node's visibility/position/scale, for the non-animated
        // fallback path).
        (this._seedInitial || []).forEach(({ node, position, scale }) => {
          node.visible = true;
          node.position.copy(position);
          node.scale.copy(scale);
        });
        const tree = this.floranaRoom.getObjectByName("tree");
        if (tree) tree.scale.setScalar(0.001); // harmless fallback if no clips
        // Same trick as the seed: use the animation system itself to
        // snap back to frame zero rather than guessing what to reset.
        (this._treeClipActions || []).forEach((action) => {
          action.reset();
          action.paused = false;
          action.play();
        });
        if (this._floranaMixer) this._floranaMixer.update(0);
        (this._treeClipActions || []).forEach((action) => {
          action.paused = true;
        });
        this._treeGrown = false;
        this._treeAnim = null;
        this._transitioning = false;
      },
    };
  }

  _startTreeGrowth() {
    if (this._treeClipActions && this._treeClipActions.length > 0) {
      // Use the model's own baked growth animation(s).
      this._treeFinishedCount = 0;
      this._treeClipActions.forEach((action) => {
        action.reset();
        action.paused = false;
        action.play();
      });
      return;
    }
    // Fallback if the model has no animation: manual scale-up.
    const tree = this.floranaRoom.getObjectByName("tree");
    if (!tree) return;
    this._treeAnim = {
      start: this._clock.getElapsedTime(),
      duration: 1.8,
      target: tree,
      done: false,
    };
  }

  _showFloranaSign() {
    document.getElementById("floranaSign").classList.add("show");
  }

  /* ============================================================
     Per-frame update
     ============================================================ */
  _tick() {
    const t = this._clock.getElapsedTime();

    // Manually derive delta from consecutive elapsed-time readings rather
    // than also calling clock.getDelta(), since getElapsedTime() already
    // consumes the clock's internal delta each frame — calling both would
    // silently break one of them.
    const dt = t - (this._lastTick || t);
    this._lastTick = t;
    if (this._techMixer) this._techMixer.update(dt);
    if (this._floranaMixer) this._floranaMixer.update(dt);

    if (this._seedFall && !this._seedFall.done) {
      const k = Math.min(1, (t - this._seedFall.start) / this._seedFall.duration);
      const s = Math.max(0, 1 - k);
      this._seedFall.targets.forEach((seed) => {
        seed.scale.set(s, s * 1.4, s);
      });
      if (k >= 1) {
        this._seedFall.done = true;
        this._seedFall.targets.forEach((seed) => (seed.visible = false));
        this._startCapsuleTurn();
      }
    }

    if (this._spin) {
      const k = Math.min(1, (t - this._spin.start) / this._spin.duration);
      const eased = 1 - Math.pow(1 - k, 3);
      this.capsule.rotation.y = this._spin.reverse
        ? Math.PI * (1 - eased)
        : Math.PI * eased;
      if (k >= 1) {
        this.capsule.rotation.y = this._spin.reverse ? 0 : Math.PI;
        const done = this._spin.onDone;
        this._spin = null;
        done();
      }
    }

    if (this._treeAnim && !this._treeAnim.done) {
      const k = Math.min(1, (t - this._treeAnim.start) / this._treeAnim.duration);
      const eased = k < 1 ? 1 - Math.pow(1 - k, 4) : 1;
      const s = 0.001 + eased * 0.999;
      this._treeAnim.target.scale.setScalar(s);
      if (k >= 1) {
        this._treeAnim.done = true;
        this._showFloranaSign();
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._tick();
  }

  _onResize() {
    if (this.mode !== "test") return;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}

export const world = new TangibleWorld();

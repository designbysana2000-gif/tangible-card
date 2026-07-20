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
    this.floranaRoom = this._buildFloranaRoom();
    // Back-to-back: Florana's opening faces the opposite direction from
    // the Tech Room's, sharing the same central spine.
    this.floranaRoom.rotation.y = Math.PI;
    // Hidden until the seed is planted and the capsule turns — this keeps
    // its (currently backless, placeholder) geometry from peeking through
    // before it's actually meant to be seen.
    this.floranaRoom.visible = false;

    this.capsule.add(this.techRoom, this.floranaRoom);
    root.add(this.capsule);
  }

  async _buildTechRoom() {
    const { GLTFLoader } = await import(
      "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js"
    );
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync("./tech_room.glb");
    const group = gltf.scene;
    group.name = "techRoom";

    // Your GLB already has these pieces named — we just point our standard
    // tap-target names (contactCard, coin, seed) at whichever real node
    // matches, so the existing tap/animation code doesn't need to change
    // at all. If the model gets re-exported later with different names,
    // update the strings on the right below.
    this._renameFirstMatch(group, ["Card_Export", "Card_GEo1"], "contactCard");
    this._renameFirstMatch(group, ["CoinCapsule"], "coin");
    this._renameFirstMatch(group, ["seed_fbx"], "seed");

    const light = new THREE.PointLight(0xffffff, 1.1, 3);
    light.position.set(0.3, 0.8, 0.3);
    group.add(light);
    group.add(new THREE.AmbientLight(0xffffff, 0.5));

    return group;
  }

  // Finds the first node whose name matches (or starts with) any of the
  // given candidate names, and relabels it so our tap logic can find it
  // by the standard name regardless of what it's called in the raw file.
  _renameFirstMatch(root, candidates, standardName) {
    let found = null;
    root.traverse((obj) => {
      if (found || !obj.name) return;
      if (candidates.some((c) => obj.name === c || obj.name.startsWith(c))) {
        found = obj;
      }
    });
    if (found) {
      found.name = standardName;
    } else {
      console.warn(`Could not find a node matching [${candidates.join(", ")}] for "${standardName}" — tapping it won't work until the name is fixed.`);
    }
  }

  _buildFloranaRoom() {
    const group = new THREE.Group();
    group.name = "floranaRoom";

    // PLACEHOLDER GEOMETRY — swap for florana_room.glb
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 0.03, 40),
      new THREE.MeshStandardMaterial({ color: 0xe9e3d3, roughness: 1 })
    );
    group.add(floor);

    // Tree: trunk + foliage, scaled to 0 initially for the growth animation
    const tree = new THREE.Group();
    tree.name = "tree";
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.035, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 })
    );
    trunk.position.y = 0.175;
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0x6f8f5a, roughness: 0.8 })
    );
    foliage.position.y = 0.42;
    tree.add(trunk, foliage);
    tree.scale.setScalar(0.001);
    tree.position.y = 0.02;
    group.add(tree);

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
    // a normal room), so we rotate the whole thing 90° on X to stand it
    // up out of the card's plane instead of lying flat inside it.
    const stageUpright = new THREE.Group();
    stageUpright.rotation.x = Math.PI / 2;
    // Scaled down substantially: the room was originally sized assuming a
    // business-card-width tracked image. Larger tracked images (like an
    // envelope) make MindAR render everything bigger in real-world terms,
    // which can put the camera inside the geometry at normal viewing
    // distance. This keeps the room comfortably small no matter what
    // physical object is being tracked.
    stageUpright.scale.setScalar(0.35);
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

      // Always test the whole capsule — whichever room is actually facing
      // the camera is the only one its taps can physically reach anyway,
      // the same way you can't tap something behind you in real life.
      const hits = this._raycaster.intersectObjects(this.capsule.children, true);
      if (!hits.length) return;

      const hit = this._findNamed(hits[0].object);
      if (!hit) return;

      if (hit.name === "contactCard") this._openContact();
      else if (hit.name === "coin") this.openCoinPopup();
      else if (hit.name === "seed") this._transitionToFlorana();
      else if (hit.name === "tree" && this.currentRoom === "florana" && this._treeAnim && this._treeAnim.done) {
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

    const seed = this.techRoom.getObjectByName("seed");
    this._seedFall = {
      start: this._clock.getElapsedTime(),
      duration: 0.45,
      target: seed,
      startY: seed ? seed.position.y : 0,
      done: false,
    };
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

        // Reset the seed and tree so the whole sequence plays again
        // cleanly next time the seed is tapped.
        const seed = this.techRoom.getObjectByName("seed");
        if (seed) {
          seed.visible = true;
          seed.scale.set(1, 1.4, 1);
          seed.position.y = 0.28;
        }
        const tree = this.floranaRoom.getObjectByName("tree");
        if (tree) tree.scale.setScalar(0.001);
        this._treeAnim = null;
        this._transitioning = false;
      },
    };
  }

  _startTreeGrowth() {
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

    if (this._seedFall && !this._seedFall.done) {
      const k = Math.min(1, (t - this._seedFall.start) / this._seedFall.duration);
      const seed = this._seedFall.target;
      if (seed) {
        seed.position.y = this._seedFall.startY - k * 0.18;
        const s = Math.max(0, 1 - k) * 1;
        seed.scale.set(s, s * 1.4, s);
      }
      if (k >= 1) {
        this._seedFall.done = true;
        if (seed) seed.visible = false;
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

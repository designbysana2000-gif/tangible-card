import * as THREE from "three";

/**
 * TangibleWorld
 * -------------
 * Builds the Tech Room + Florana Room out of placeholder primitives so the
 * whole interaction flow (tap targets, transitions, tree-growth animation,
 * back button) can be tested before the real Blender/Unity GLBs and the
 * trained targets.mind file exist.
 *
 * SWAP-IN POINT: everywhere you see "// PLACEHOLDER GEOMETRY" below, replace
 * the primitive mesh with a GLTFLoader-loaded model of the same name. Keep
 * the object.name values (contactCard, coin, plant, techRoom, floranaRoom,
 * tree) since the raycaster and animation code look objects up by name.
 */
class TangibleWorld {
  constructor() {
    this.mode = null; // "test" | "ar"
    this.onRoomChange = () => {};
    this.currentRoom = "tech";
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._clock = new THREE.Clock();
    this._treeAnim = null; // { start, duration, done }
    this._spin = null; // { start, duration, from, to, onDone }
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3();
  }

  /* ============================================================
     Scene construction (shared by both modes)
     ============================================================ */
  _buildScene(root) {
    this.techRoom = this._buildTechRoom();
    this.floranaRoom = this._buildFloranaRoom();
    this.floranaRoom.visible = false;
    root.add(this.techRoom);
    root.add(this.floranaRoom);
  }

  _buildTechRoom() {
    const group = new THREE.Group();
    group.name = "techRoom";

    // PLACEHOLDER GEOMETRY — swap for tech_room.glb
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.04, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.9 })
    );
    floor.position.y = -0.02;
    group.add(floor);

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.9, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 1 })
    );
    backWall.position.set(0, 0.45, -0.78);
    group.add(backWall);

    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.05, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x8a6c53, roughness: 0.6 })
    );
    desk.position.set(0, 0.22, -0.35);
    group.add(desk);

    // Contact Us card
    const contactCard = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.13, 0.01),
      new THREE.MeshStandardMaterial({ color: 0xc9744f, roughness: 0.4 })
    );
    contactCard.name = "contactCard";
    contactCard.position.set(-0.35, 0.3, -0.35);
    contactCard.rotation.x = -0.15;
    group.add(contactCard);

    // Coin
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.02, 32),
      new THREE.MeshStandardMaterial({ color: 0xd9b568, metalness: 0.6, roughness: 0.25 })
    );
    coin.name = "coin";
    coin.rotation.z = Math.PI / 2;
    coin.position.set(0.35, 0.28, -0.35);
    group.add(coin);

    // Plant (pot + foliage)
    const plant = new THREE.Group();
    plant.name = "plant";
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.05, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x9b6b4a, roughness: 0.8 })
    );
    pot.position.y = 0.29;
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.16, 8),
      new THREE.MeshStandardMaterial({ color: 0x5c6b4f, roughness: 0.7 })
    );
    leaves.position.y = 0.42;
    plant.add(pot, leaves);
    plant.position.set(0, 0.22, -0.55);
    group.add(plant);

    const light = new THREE.PointLight(0xffffff, 1.1, 3);
    light.position.set(0.3, 0.8, 0.3);
    group.add(light);
    group.add(new THREE.AmbientLight(0xffffff, 0.5));

    return group;
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

    this._buildScene(this.scene);
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
      // FIX: without this, the fixed/full-screen video can sit above the
      // canvas in the stacking order on some mobile browsers and silently
      // swallow every tap before it ever reaches the raycaster. The video
      // is purely a visual backdrop, so it should never intercept input.
      video.style.pointerEvents = "none";
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
    this._buildScene(stageUpright);

    this._bindPointer(renderer.domElement, camera);

    await mindarThree.start();
    renderer.setAnimationLoop(() => this._tick());
  }

  /* ============================================================
     Pointer / tap interaction
     Uses pointerdown alone (it covers touch + mouse + pen on all
     modern mobile browsers) with preventDefault so a tap can't get
     swallowed by the browser as a scroll/zoom gesture.
     NOTE: previously this also listened for touchstart on the same
     handler. On mobile, pointerdown and touchstart both fire for a
     single tap, so the handler was running twice per tap — removed
     to avoid double-firing / flaky hit detection.
     ============================================================ */
  _bindPointer(domElement, camera) {
    const handleTap = (e) => {
      e.preventDefault();
      const point = e.changedTouches ? e.changedTouches[0] : e;
      const rect = domElement.getBoundingClientRect();
      this._pointer.x = ((point.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((point.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._pointer, camera);

      const hits = this._raycaster.intersectObjects(
        this.currentRoom === "tech" ? this.techRoom.children : this.floranaRoom.children,
        true
      );
      if (!hits.length) return;

      const hit = this._findNamed(hits[0].object);
      if (!hit) return;

      if (hit.name === "contactCard") this._openContact();
      else if (hit.name === "coin") this.openCoinPopup();
      else if (hit.name === "plant") this._transitionToFlorana();
    };

    domElement.addEventListener("pointerdown", handleTap, { passive: false });
  }

  _findNamed(obj) {
    let o = obj;
    while (o) {
      if (["contactCard", "coin", "plant"].includes(o.name)) return o;
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
     Room transition: Tech Room spins out, Florana Room spins in,
     tree grows, sign appears on completion.
     ============================================================ */
  _transitionToFlorana() {
    if (this.currentRoom !== "tech") return;
    this.currentRoom = "florana";
    this.onRoomChange("florana");

    this._spin = {
      start: this._clock.getElapsedTime(),
      duration: 0.6,
      onDone: () => {
        this.techRoom.visible = false;
        this.floranaRoom.visible = true;
        this.floranaRoom.rotation.y = 0;
        this._startTreeGrowth();
      },
    };
  }

  goBackToTechRoom() {
    if (this.currentRoom !== "florana") return;
    this.currentRoom = "tech";
    this.onRoomChange("tech");
    document.getElementById("floranaSign").classList.remove("show");

    this.floranaRoom.visible = false;
    this.techRoom.visible = true;
    this.techRoom.rotation.y = 0;

    // Reset tree so the animation plays again next visit
    const tree = this.floranaRoom.getObjectByName("tree");
    if (tree) tree.scale.setScalar(0.001);
    this._treeAnim = null;
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

    if (this._spin) {
      const k = Math.min(1, (t - this._spin.start) / this._spin.duration);
      const eased = 1 - Math.pow(1 - k, 3);
      this.techRoom.rotation.y = eased * Math.PI * 2;
      if (k >= 1) {
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
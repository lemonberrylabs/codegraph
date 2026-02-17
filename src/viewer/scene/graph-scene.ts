import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { getPalette } from '../utils/colors.js';

export class GraphScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;

  private container: HTMLElement;
  private animationId: number = 0;
  private onFrameCallbacks: ((delta: number) => void)[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    const palette = getPalette();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = palette.background;
    this.scene.fog = new THREE.FogExp2(palette.background.getHex(), 0.0008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    this.camera.position.set(0, 0, 500);

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // CSS2D Renderer for labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 3000;

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points = { threshold: 3 };
    this.mouse = new THREE.Vector2();

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404060, 1.0);
    this.scene.add(ambientLight);

    // Directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(100, 200, 100);
    this.scene.add(dirLight);

    // Handle resize
    window.addEventListener('resize', this.onResize);
  }

  onFrame(callback: (delta: number) => void): void {
    this.onFrameCallbacks.push(callback);
  }

  start(): void {
    const clock = new THREE.Clock();

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      this.controls.update();

      for (const cb of this.onFrameCallbacks) {
        cb(delta);
      }

      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    };

    animate();
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
  }

  /** Smoothly fly the camera to focus on a position */
  flyTo(target: THREE.Vector3, duration: number = 1.0): void {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();

    // Position camera at some offset from the target
    const offset = new THREE.Vector3(0, 0, 80);
    const endPos = target.clone().add(offset);

    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);

      this.camera.position.lerpVectors(startPos, endPos, eased);
      this.controls.target.lerpVectors(startTarget, target, eased);

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  resetCamera(): void {
    this.flyTo(new THREE.Vector3(0, 0, 0), 0.8);
    // Also reset the camera distance
    const startPos = this.camera.position.clone();
    const endPos = new THREE.Vector3(0, 0, 500);
    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const t = Math.min(1, elapsed / 0.8);
      const eased = easeOutCubic(t);
      this.camera.position.lerpVectors(startPos, endPos, eased);
      this.controls.target.set(0, 0, 0);
      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }

  getCameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Capture screenshot as data URL */
  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.controls.dispose();
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

import * as THREE from 'three';
import type { GraphScene } from '../scene/graph-scene.js';
import type { NodeRenderer } from '../scene/node-renderer.js';
import { GraphStore } from '../data/graph-store.js';

/**
 * Handles mouse picking (hover, click) on the 3D graph nodes.
 */
export class GraphRaycaster {
  private scene: GraphScene;
  private nodeRenderer: NodeRenderer;
  private store: GraphStore;

  private mouse = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private hoveredIndex: number = -1;

  onHover: ((nodeIndex: number) => void) | null = null;
  onClick: ((nodeIndex: number, event: MouseEvent) => void) | null = null;
  onDoubleClick: ((nodeIndex: number) => void) | null = null;

  constructor(scene: GraphScene, nodeRenderer: NodeRenderer, store: GraphStore) {
    this.scene = scene;
    this.nodeRenderer = nodeRenderer;
    this.store = store;

    const canvas = scene.renderer.domElement;
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('click', this.onMouseClick);
    canvas.addEventListener('dblclick', this.onMouseDblClick);
  }

  private updateMouse(event: MouseEvent): void {
    const rect = this.scene.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onMouseMove = (event: MouseEvent): void => {
    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.scene.camera);

    const mesh = this.nodeRenderer.getInstancedMesh();
    if (!mesh) return;

    const intersects = this.raycaster.intersectObject(mesh);

    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId !== undefined && instanceId !== this.hoveredIndex) {
        this.hoveredIndex = instanceId;
        this.onHover?.(instanceId);
      }
    } else if (this.hoveredIndex !== -1) {
      this.hoveredIndex = -1;
      this.onHover?.(-1);
    }
  };

  private onMouseClick = (event: MouseEvent): void => {
    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.scene.camera);

    const mesh = this.nodeRenderer.getInstancedMesh();
    if (!mesh) return;

    const intersects = this.raycaster.intersectObject(mesh);

    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId !== undefined) {
        this.onClick?.(instanceId, event);
      }
    } else {
      this.onClick?.(-1, event);
    }
  };

  private onMouseDblClick = (event: MouseEvent): void => {
    this.updateMouse(event);
    this.raycaster.setFromCamera(this.mouse, this.scene.camera);

    const mesh = this.nodeRenderer.getInstancedMesh();
    if (!mesh) return;

    const intersects = this.raycaster.intersectObject(mesh);

    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId !== undefined) {
        this.onDoubleClick?.(instanceId);
      }
    }
  };

  dispose(): void {
    const canvas = this.scene.renderer.domElement;
    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('click', this.onMouseClick);
    canvas.removeEventListener('dblclick', this.onMouseDblClick);
  }
}

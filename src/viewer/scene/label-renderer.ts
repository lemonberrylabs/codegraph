import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GraphStore, NodeIndex } from '../data/graph-store.js';
import type { GraphScene } from './graph-scene.js';
import { getLODLevel, shouldShowLabels, LODLevel } from '../utils/lod.js';

export class LabelRenderer {
  private store: GraphStore;
  private scene: GraphScene;
  private labels: Map<number, CSS2DObject> = new Map();
  private forceShowAll: boolean = false;
  private activeLabels: Set<number> = new Set();

  constructor(store: GraphStore, scene: GraphScene) {
    this.store = store;
    this.scene = scene;
  }

  /** Show label for a specific node */
  showLabel(nodeIndex: number): void {
    if (this.labels.has(nodeIndex)) return;

    const nodeIdx = this.store.getNodeByIndex(nodeIndex);
    if (!nodeIdx) return;

    const label = this.createLabel(nodeIdx);
    this.labels.set(nodeIndex, label);
    this.scene.scene.add(label);
    this.activeLabels.add(nodeIndex);
  }

  /** Hide label for a specific node */
  hideLabel(nodeIndex: number): void {
    const label = this.labels.get(nodeIndex);
    if (label) {
      this.scene.scene.remove(label);
      this.labels.delete(nodeIndex);
      this.activeLabels.delete(nodeIndex);
    }
  }

  /** Show labels for a set of nodes (e.g., neighbors of selected) */
  showLabelsFor(indices: number[]): void {
    // Clear previous labels that aren't in the new set
    const newSet = new Set(indices);
    for (const idx of this.activeLabels) {
      if (!newSet.has(idx)) {
        this.hideLabel(idx);
      }
    }

    for (const idx of indices) {
      this.showLabel(idx);
    }
  }

  /** Clear all labels */
  clearAll(): void {
    for (const [idx] of this.labels) {
      this.hideLabel(idx);
    }
  }

  /** Toggle showing all labels */
  toggleShowAll(): boolean {
    this.forceShowAll = !this.forceShowAll;

    if (this.forceShowAll) {
      for (let i = 0; i < this.store.nodeCount; i++) {
        this.showLabel(i);
      }
    } else {
      this.clearAll();
    }

    return this.forceShowAll;
  }

  /** Update label positions based on node positions */
  updatePositions(): void {
    for (const [idx, label] of this.labels) {
      const nodeIdx = this.store.getNodeByIndex(idx);
      if (nodeIdx) {
        label.position.set(
          nodeIdx.position.x,
          nodeIdx.position.y + 4, // Slightly above node
          nodeIdx.position.z
        );
      }
    }
  }

  /** Update label visibility based on LOD */
  updateLOD(cameraDistance: number): void {
    if (this.forceShowAll) return;

    const level = getLODLevel(cameraDistance);
    const show = shouldShowLabels(level);

    for (const [, label] of this.labels) {
      label.visible = show;
    }
  }

  private createLabel(nodeIdx: NodeIndex): CSS2DObject {
    const div = document.createElement('div');
    div.style.cssText = `
      color: #e4e4ef;
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 14px;
      background: rgba(22, 22, 31, 0.85);
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
      backdrop-filter: blur(4px);
    `;
    div.textContent = nodeIdx.node.name;

    const label = new CSS2DObject(div);
    label.position.set(
      nodeIdx.position.x,
      nodeIdx.position.y + 4,
      nodeIdx.position.z
    );

    return label;
  }

  dispose(): void {
    this.clearAll();
  }
}

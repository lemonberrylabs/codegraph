import * as THREE from 'three';
import { GraphStore, NodeIndex } from '../data/graph-store.js';
import { getNodeColor, getClusterColor, mapNodeSize, getPalette, getColorMode } from '../utils/colors.js';
import { getLODLevel, getNodeScale } from '../utils/lod.js';
import type { GraphScene } from './graph-scene.js';

const SPHERE_SEGMENTS = 12;
const ENTRY_NODE_SCALE = 2.0;

export class NodeRenderer {
  private instancedMesh!: THREE.InstancedMesh;
  private entryMesh: THREE.Mesh | null = null;
  private store: GraphStore;
  private scene: GraphScene;

  // Per-instance data
  private baseColors: Float32Array = new Float32Array(0);
  private baseSizes: Float32Array = new Float32Array(0);
  private instanceMatrix = new THREE.Matrix4();
  private tempColor = new THREE.Color();

  // Visibility mask
  private visibilityMask: boolean[];

  // Highlight state
  private highlightedIndices: Set<number> = new Set();
  private selectedIndex: number = -1;
  private hoveredIndex: number = -1;
  private dimMode: boolean = false;

  constructor(store: GraphStore, scene: GraphScene) {
    this.store = store;
    this.scene = scene;
    this.visibilityMask = [];
  }

  init(): void {
    const nodeCount = this.store.nodeCount;
    if (nodeCount === 0) return;

    // Create instanced mesh with sphere geometry
    const geometry = new THREE.IcosahedronGeometry(1, SPHERE_SEGMENTS > 8 ? 2 : 1);
    const material = new THREE.MeshPhongMaterial({
      vertexColors: false,
      shininess: 30,
      transparent: true,
      opacity: 1.0,
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, nodeCount);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.frustumCulled = false;

    // Initialize per-instance colors
    this.baseColors = new Float32Array(nodeCount * 3);
    this.baseSizes = new Float32Array(nodeCount);
    this.visibilityMask = new Array(nodeCount).fill(true);

    for (let i = 0; i < nodeCount; i++) {
      const nodeIdx = this.store.getNodeByIndex(i);
      if (!nodeIdx) continue;

      const color = getNodeColor(nodeIdx.node.status, nodeIdx.node.color);
      this.baseColors[i * 3] = color.r;
      this.baseColors[i * 3 + 1] = color.g;
      this.baseColors[i * 3 + 2] = color.b;

      const size = mapNodeSize(nodeIdx.node.linesOfCode);
      this.baseSizes[i] = size;

      this.instancedMesh.setColorAt(i, color);
      this.updateInstanceTransform(i, nodeIdx.position, size);
    }

    this.instancedMesh.instanceColor!.needsUpdate = true;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.computeBoundingSphere();

    this.scene.scene.add(this.instancedMesh);

    // Create entry node (different geometry)
    this.createEntryNode();
  }

  private createEntryNode(): void {
    const entryTargets = this.store.graph.entryNode.targets;
    if (entryTargets.length === 0) return;

    const geometry = new THREE.OctahedronGeometry(3, 0);
    const material = new THREE.MeshPhongMaterial({
      color: getPalette().entry,
      emissive: getPalette().entry,
      emissiveIntensity: 0.3,
      shininess: 60,
    });
    this.entryMesh = new THREE.Mesh(geometry, material);
    this.entryMesh.position.set(0, 0, 0);
    this.entryMesh.userData = { isEntryNode: true, id: '__entry__' };
    this.scene.scene.add(this.entryMesh);
  }

  /** Update node positions from the layout engine */
  updatePositions(positions: Float32Array): void {
    const nodeCount = this.store.nodeCount;

    for (let i = 0; i < nodeCount; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      const nodeIdx = this.store.getNodeByIndex(i);
      if (nodeIdx) {
        nodeIdx.position.x = x;
        nodeIdx.position.y = y;
        nodeIdx.position.z = z;
      }

      if (this.visibilityMask[i]) {
        this.updateInstanceTransform(i, { x, y, z }, this.baseSizes[i]);
      } else {
        // Scale to zero to hide
        this.updateInstanceTransform(i, { x, y, z }, 0);
      }
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.computeBoundingSphere();
  }

  private updateInstanceTransform(
    index: number,
    pos: { x: number; y: number; z: number },
    size: number
  ): void {
    this.instanceMatrix.makeScale(size, size, size);
    this.instanceMatrix.setPosition(pos.x, pos.y, pos.z);
    this.instancedMesh.setMatrixAt(index, this.instanceMatrix);
  }

  /** Update colors based on current state (hover, selection, filter, dim mode) */
  updateColors(): void {
    const palette = getPalette();
    const clusterMode = getColorMode() === 'cluster';

    for (let i = 0; i < this.store.nodeCount; i++) {
      const nodeIdx = this.store.getNodeByIndex(i);
      if (!nodeIdx) continue;

      if (i === this.selectedIndex) {
        this.tempColor.copy(palette.selected);
      } else if (i === this.hoveredIndex) {
        this.tempColor.copy(palette.hovered);
      } else if (this.highlightedIndices.has(i)) {
        // Slightly brighter than base
        this.tempColor.setRGB(
          this.baseColors[i * 3],
          this.baseColors[i * 3 + 1],
          this.baseColors[i * 3 + 2]
        );
      } else if (this.dimMode) {
        this.tempColor.copy(palette.dimmed);
      } else if (clusterMode) {
        const clusterIdx = this.store.clusters.findIndex(c =>
          c.nodeIds.includes(nodeIdx.node.id)
        );
        if (clusterIdx >= 0) {
          this.tempColor.copy(getClusterColor(this.store.clusters[clusterIdx].id, clusterIdx));
        } else {
          this.tempColor.setRGB(
            this.baseColors[i * 3],
            this.baseColors[i * 3 + 1],
            this.baseColors[i * 3 + 2]
          );
        }
      } else {
        this.tempColor.setRGB(
          this.baseColors[i * 3],
          this.baseColors[i * 3 + 1],
          this.baseColors[i * 3 + 2]
        );
      }

      this.instancedMesh.setColorAt(i, this.tempColor);
    }

    this.instancedMesh.instanceColor!.needsUpdate = true;
  }

  setHovered(index: number): void {
    this.hoveredIndex = index;
    this.updateColors();
  }

  setSelected(index: number): void {
    this.selectedIndex = index;
    this.updateColors();
  }

  setHighlighted(indices: Set<number>): void {
    this.highlightedIndices = indices;
    this.dimMode = indices.size > 0;
    this.updateColors();
  }

  clearHighlights(): void {
    this.highlightedIndices.clear();
    this.dimMode = false;
    this.hoveredIndex = -1;
    this.updateColors();
  }

  /** Set visibility mask for filtering */
  setVisibility(mask: boolean[]): void {
    this.visibilityMask = mask;
    // Re-apply transforms to hide/show nodes
    for (let i = 0; i < this.store.nodeCount; i++) {
      const nodeIdx = this.store.getNodeByIndex(i);
      if (!nodeIdx) continue;
      const size = mask[i] ? this.baseSizes[i] : 0;
      this.updateInstanceTransform(i, nodeIdx.position, size);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.instancedMesh.computeBoundingSphere();
  }

  getInstancedMesh(): THREE.InstancedMesh {
    return this.instancedMesh;
  }

  dispose(): void {
    if (this.instancedMesh) {
      this.scene.scene.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      (this.instancedMesh.material as THREE.Material).dispose();
    }
    if (this.entryMesh) {
      this.scene.scene.remove(this.entryMesh);
      this.entryMesh.geometry.dispose();
      (this.entryMesh.material as THREE.Material).dispose();
    }
  }
}

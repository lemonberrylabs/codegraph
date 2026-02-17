import * as THREE from 'three';
import { GraphStore } from '../data/graph-store.js';
import { getPalette } from '../utils/colors.js';
import { getSmoothEdgeOpacity } from '../utils/lod.js';
import type { GraphScene } from './graph-scene.js';

export class EdgeRenderer {
  private lineSegments!: THREE.LineSegments;
  private positionBuffer!: Float32Array;
  private colorBuffer!: Float32Array;
  private store: GraphStore;
  private scene: GraphScene;
  private visible: boolean = true;

  // Edge visibility mask (synced with node visibility)
  private edgeVisibility: boolean[];

  // Highlighted edges
  private highlightedEdges: Set<number> = new Set();
  private incomingHighlight: Set<number> = new Set();
  private outgoingHighlight: Set<number> = new Set();

  constructor(store: GraphStore, scene: GraphScene) {
    this.store = store;
    this.scene = scene;
    this.edgeVisibility = [];
  }

  init(): void {
    const edgeCount = this.store.edgeCount;
    if (edgeCount === 0) return;

    // Each edge = 2 vertices, each vertex = 3 floats (x, y, z)
    this.positionBuffer = new Float32Array(edgeCount * 6);
    this.colorBuffer = new Float32Array(edgeCount * 6);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positionBuffer, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colorBuffer, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lineSegments = new THREE.LineSegments(geometry, material);
    this.lineSegments.frustumCulled = false;
    this.scene.scene.add(this.lineSegments);

    this.edgeVisibility = new Array(edgeCount).fill(true);

    // Set initial colors
    this.resetColors();
  }

  /** Update edge positions based on node positions */
  updatePositions(): void {
    const edges = this.store.edges;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const source = this.store.getNodeById(edge.source);
      const target = this.store.getNodeById(edge.target);

      if (!source || !target || !this.edgeVisibility[i]) {
        // Hide edge by collapsing to zero
        this.positionBuffer[i * 6] = 0;
        this.positionBuffer[i * 6 + 1] = 0;
        this.positionBuffer[i * 6 + 2] = 0;
        this.positionBuffer[i * 6 + 3] = 0;
        this.positionBuffer[i * 6 + 4] = 0;
        this.positionBuffer[i * 6 + 5] = 0;
        continue;
      }

      const sp = source.position;
      const tp = target.position;

      this.positionBuffer[i * 6] = sp.x;
      this.positionBuffer[i * 6 + 1] = sp.y;
      this.positionBuffer[i * 6 + 2] = sp.z;
      this.positionBuffer[i * 6 + 3] = tp.x;
      this.positionBuffer[i * 6 + 4] = tp.y;
      this.positionBuffer[i * 6 + 5] = tp.z;
    }

    const posAttr = this.lineSegments.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
  }

  /** Reset all edge colors to default */
  resetColors(): void {
    const palette = getPalette();
    const defaultColor = palette.edgeDefault;

    for (let i = 0; i < this.store.edgeCount; i++) {
      this.colorBuffer[i * 6] = defaultColor.r;
      this.colorBuffer[i * 6 + 1] = defaultColor.g;
      this.colorBuffer[i * 6 + 2] = defaultColor.b;
      this.colorBuffer[i * 6 + 3] = defaultColor.r;
      this.colorBuffer[i * 6 + 4] = defaultColor.g;
      this.colorBuffer[i * 6 + 5] = defaultColor.b;
    }

    const colorAttr = this.lineSegments.geometry.getAttribute('color') as THREE.BufferAttribute;
    colorAttr.needsUpdate = true;
  }

  /** Highlight edges for a specific node (incoming + outgoing) */
  highlightForNode(nodeId: string): void {
    this.resetColors();
    const palette = getPalette();
    const incoming = getPalette().edgeIncoming;
    const outgoing = getPalette().edgeOutgoing;

    // Find incoming edges (target = nodeId)
    const inEdges = this.store.getIncomingEdges(nodeId);
    const outEdges = this.store.getOutgoingEdges(nodeId);

    const edges = this.store.edges;

    for (const edge of inEdges) {
      const idx = edges.indexOf(edge);
      if (idx >= 0) {
        this.colorBuffer[idx * 6] = incoming.r;
        this.colorBuffer[idx * 6 + 1] = incoming.g;
        this.colorBuffer[idx * 6 + 2] = incoming.b;
        this.colorBuffer[idx * 6 + 3] = incoming.r;
        this.colorBuffer[idx * 6 + 4] = incoming.g;
        this.colorBuffer[idx * 6 + 5] = incoming.b;
      }
    }

    for (const edge of outEdges) {
      const idx = edges.indexOf(edge);
      if (idx >= 0) {
        this.colorBuffer[idx * 6] = outgoing.r;
        this.colorBuffer[idx * 6 + 1] = outgoing.g;
        this.colorBuffer[idx * 6 + 2] = outgoing.b;
        this.colorBuffer[idx * 6 + 3] = outgoing.r;
        this.colorBuffer[idx * 6 + 4] = outgoing.g;
        this.colorBuffer[idx * 6 + 5] = outgoing.b;
      }
    }

    const colorAttr = this.lineSegments.geometry.getAttribute('color') as THREE.BufferAttribute;
    colorAttr.needsUpdate = true;
  }

  /** Update LOD-based opacity with smooth interpolation */
  updateLOD(cameraDistance: number): void {
    const opacity = getSmoothEdgeOpacity(cameraDistance);
    (this.lineSegments.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  /** Set visibility of all edges */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.lineSegments.visible = visible;
  }

  toggleVisible(): boolean {
    this.visible = !this.visible;
    this.lineSegments.visible = this.visible;
    return this.visible;
  }

  /** Update edge visibility based on node visibility */
  updateEdgeVisibility(nodeVisibility: boolean[]): void {
    const edges = this.store.edges;

    for (let i = 0; i < edges.length; i++) {
      const source = this.store.getNodeById(edges[i].source);
      const target = this.store.getNodeById(edges[i].target);
      this.edgeVisibility[i] = !!(
        source && target &&
        nodeVisibility[source.index] &&
        nodeVisibility[target.index]
      );
    }
  }

  dispose(): void {
    this.lineSegments?.geometry.dispose();
    (this.lineSegments?.material as THREE.Material)?.dispose();
  }
}

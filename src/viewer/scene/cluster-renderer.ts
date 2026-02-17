import * as THREE from 'three';
import { GraphStore } from '../data/graph-store.js';
import { getClusterColor } from '../utils/colors.js';
import type { GraphScene } from './graph-scene.js';

/**
 * Renders translucent bounding spheres around package/module clusters.
 */
export class ClusterRenderer {
  private store: GraphStore;
  private scene: GraphScene;
  private meshes: THREE.Mesh[] = [];
  private visible: boolean = false;

  constructor(store: GraphStore, scene: GraphScene) {
    this.store = store;
    this.scene = scene;
  }

  /** Update cluster boundary positions based on current node positions */
  update(): void {
    // Remove old meshes
    for (const mesh of this.meshes) {
      this.scene.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes = [];

    if (!this.visible) return;

    const clusters = this.store.clusters;

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (cluster.nodeIds.length < 2) continue;

      // Compute centroid and radius
      let cx = 0, cy = 0, cz = 0;
      let count = 0;

      for (const nodeId of cluster.nodeIds) {
        const nodeIdx = this.store.getNodeById(nodeId);
        if (nodeIdx) {
          cx += nodeIdx.position.x;
          cy += nodeIdx.position.y;
          cz += nodeIdx.position.z;
          count++;
        }
      }

      if (count === 0) continue;

      cx /= count;
      cy /= count;
      cz /= count;

      // Compute radius (max distance from centroid + padding)
      let maxDist = 0;
      for (const nodeId of cluster.nodeIds) {
        const nodeIdx = this.store.getNodeById(nodeId);
        if (nodeIdx) {
          const dx = nodeIdx.position.x - cx;
          const dy = nodeIdx.position.y - cy;
          const dz = nodeIdx.position.z - cz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          maxDist = Math.max(maxDist, dist);
        }
      }

      const radius = maxDist + 10; // Padding

      const color = getClusterColor(cluster.id, i);
      const geometry = new THREE.SphereGeometry(radius, 16, 12);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        side: THREE.BackSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(cx, cy, cz);
      mesh.userData = { clusterId: cluster.id, label: cluster.label };

      this.scene.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.update();
    } else {
      for (const mesh of this.meshes) {
        this.scene.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      this.meshes = [];
    }
  }

  toggleVisible(): boolean {
    this.visible = !this.visible;
    this.setVisible(this.visible);
    return this.visible;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.meshes = [];
  }
}

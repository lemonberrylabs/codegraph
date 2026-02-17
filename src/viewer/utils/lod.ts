/** Level of detail thresholds based on camera distance */
export enum LODLevel {
  Far = 0,      // Whole graph visible, minimal detail
  Medium = 1,   // Cluster level
  Close = 2,    // Individual nodes
  VeryClose = 3 // Inspecting a node
}

/** Distance thresholds for each LOD level */
const LOD_THRESHOLDS = {
  far: 800,
  medium: 400,
  close: 150,
};

export function getLODLevel(cameraDistance: number): LODLevel {
  if (cameraDistance > LOD_THRESHOLDS.far) return LODLevel.Far;
  if (cameraDistance > LOD_THRESHOLDS.medium) return LODLevel.Medium;
  if (cameraDistance > LOD_THRESHOLDS.close) return LODLevel.Close;
  return LODLevel.VeryClose;
}

/** Get opacity for edges based on LOD */
export function getEdgeOpacity(level: LODLevel): number {
  switch (level) {
    case LODLevel.Far: return 0.06;
    case LODLevel.Medium: return 0.12;
    case LODLevel.Close: return 0.2;
    case LODLevel.VeryClose: return 0.3;
  }
}

/** Get node scale multiplier based on LOD */
export function getNodeScale(level: LODLevel): number {
  switch (level) {
    case LODLevel.Far: return 0.6;
    case LODLevel.Medium: return 0.8;
    case LODLevel.Close: return 1.0;
    case LODLevel.VeryClose: return 1.0;
  }
}

/** Whether to show labels at this LOD */
export function shouldShowLabels(level: LODLevel): boolean {
  return level >= LODLevel.Close;
}

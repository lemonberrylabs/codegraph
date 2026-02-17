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

/** Linearly interpolate between two values */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Get smooth edge opacity based on continuous camera distance (lerp between LOD levels) */
export function getEdgeOpacity(level: LODLevel): number {
  switch (level) {
    case LODLevel.Far: return 0.06;
    case LODLevel.Medium: return 0.12;
    case LODLevel.Close: return 0.2;
    case LODLevel.VeryClose: return 0.3;
  }
}

/** Get smooth edge opacity based on continuous distance (smooth lerp between thresholds) */
export function getSmoothEdgeOpacity(distance: number): number {
  if (distance > LOD_THRESHOLDS.far) return 0.06;
  if (distance > LOD_THRESHOLDS.medium) {
    const t = (LOD_THRESHOLDS.far - distance) / (LOD_THRESHOLDS.far - LOD_THRESHOLDS.medium);
    return lerp(0.06, 0.12, t);
  }
  if (distance > LOD_THRESHOLDS.close) {
    const t = (LOD_THRESHOLDS.medium - distance) / (LOD_THRESHOLDS.medium - LOD_THRESHOLDS.close);
    return lerp(0.12, 0.2, t);
  }
  // Very close: lerp from close to very close (close=150, very close=50 arbitrary)
  const t = Math.min(1, (LOD_THRESHOLDS.close - distance) / (LOD_THRESHOLDS.close - 50));
  return lerp(0.2, 0.3, t);
}

/** Get smooth node scale based on continuous distance */
export function getSmoothNodeScale(distance: number): number {
  if (distance > LOD_THRESHOLDS.far) return 0.6;
  if (distance > LOD_THRESHOLDS.medium) {
    const t = (LOD_THRESHOLDS.far - distance) / (LOD_THRESHOLDS.far - LOD_THRESHOLDS.medium);
    return lerp(0.6, 0.8, t);
  }
  if (distance > LOD_THRESHOLDS.close) {
    const t = (LOD_THRESHOLDS.medium - distance) / (LOD_THRESHOLDS.medium - LOD_THRESHOLDS.close);
    return lerp(0.8, 1.0, t);
  }
  return 1.0;
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

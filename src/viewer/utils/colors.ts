import * as THREE from 'three';

export type ColorMode = 'normal' | 'colorblind' | 'cluster';

export interface ColorPalette {
  live: THREE.Color;
  dead: THREE.Color;
  unused: THREE.Color;
  orange: THREE.Color;
  entry: THREE.Color;
  selected: THREE.Color;
  hovered: THREE.Color;
  dimmed: THREE.Color;
  edgeDefault: THREE.Color;
  edgeHighlight: THREE.Color;
  edgeIncoming: THREE.Color;
  edgeOutgoing: THREE.Color;
  background: THREE.Color;
}

const NORMAL_PALETTE: ColorPalette = {
  live: new THREE.Color(0x4dffa0),
  dead: new THREE.Color(0xff4d6a),
  unused: new THREE.Color(0xffc84d),
  orange: new THREE.Color(0xff8a4d),
  entry: new THREE.Color(0x4d9eff),
  selected: new THREE.Color(0xffffff),
  hovered: new THREE.Color(0xe0e0ff),
  dimmed: new THREE.Color(0x333344),
  edgeDefault: new THREE.Color(0x444460),
  edgeHighlight: new THREE.Color(0xaaaacc),
  edgeIncoming: new THREE.Color(0x4dffa0),
  edgeOutgoing: new THREE.Color(0x4d9eff),
  background: new THREE.Color(0x0a0a0f),
};

const COLORBLIND_PALETTE: ColorPalette = {
  live: new THREE.Color(0x56b4e9),     // Sky blue
  dead: new THREE.Color(0xcc79a7),     // Pink/magenta
  unused: new THREE.Color(0xe69f00),   // Orange
  orange: new THREE.Color(0xd55e00),   // Vermillion
  entry: new THREE.Color(0x009e73),    // Teal
  selected: new THREE.Color(0xffffff),
  hovered: new THREE.Color(0xe0e0ff),
  dimmed: new THREE.Color(0x333344),
  edgeDefault: new THREE.Color(0x444460),
  edgeHighlight: new THREE.Color(0xaaaacc),
  edgeIncoming: new THREE.Color(0x56b4e9),
  edgeOutgoing: new THREE.Color(0x009e73),
  background: new THREE.Color(0x0a0a0f),
};

let currentMode: ColorMode = 'normal';
let currentPalette: ColorPalette = NORMAL_PALETTE;

// Cluster color palette (distinct hues)
const CLUSTER_COLORS = [
  0x6c7aff, 0xff6c9a, 0x6cffc8, 0xffc86c, 0xc86cff,
  0x6cddff, 0xff9a6c, 0x9aff6c, 0xff6cdd, 0x6cffa0,
  0xdd6cff, 0x6cffdd, 0xff6c6c, 0x6c9aff, 0xffdd6c,
  0x9a6cff, 0x6cff6c, 0xff6cff, 0x6cffff, 0xffff6c,
];

const clusterColorCache = new Map<string, THREE.Color>();

export function getPalette(): ColorPalette {
  return currentPalette;
}

export function setColorMode(mode: ColorMode): void {
  currentMode = mode;
  currentPalette = mode === 'colorblind' ? COLORBLIND_PALETTE : NORMAL_PALETTE;
}

export function getColorMode(): ColorMode {
  return currentMode;
}

export function getNodeColor(status: string, color: string): THREE.Color {
  const p = currentPalette;
  switch (color) {
    case 'red': return p.dead;
    case 'yellow': return p.unused;
    case 'orange': return p.orange;
    case 'blue': return p.entry;
    case 'green':
    default: return p.live;
  }
}

export function getClusterColor(clusterId: string, index: number): THREE.Color {
  if (clusterColorCache.has(clusterId)) {
    return clusterColorCache.get(clusterId)!;
  }
  const color = new THREE.Color(CLUSTER_COLORS[index % CLUSTER_COLORS.length]);
  clusterColorCache.set(clusterId, color);
  return color;
}

/** Map a value from [0,1] range to node size (radius) using log scale */
export function mapNodeSize(linesOfCode: number): number {
  const minSize = 1.0;
  const maxSize = 5.0;
  const logVal = Math.log2(Math.max(1, linesOfCode));
  const maxLog = Math.log2(500); // Cap at ~500 lines for sizing
  const t = Math.min(1, logVal / maxLog);
  return minSize + t * (maxSize - minSize);
}

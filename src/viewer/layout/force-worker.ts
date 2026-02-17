/**
 * Web Worker for force-directed graph layout simulation.
 * Runs the physics simulation off the main thread.
 */

interface LayoutNode {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  cluster: number;
  mass: number;
}

interface LayoutEdge {
  source: number;
  target: number;
}

interface InitMessage {
  type: 'init';
  nodeCount: number;
  edges: [number, number][];
  clusterAssignments: number[];  // cluster index per node
  clusterCount: number;
  masses: number[];  // node masses (based on linesOfCode)
}

interface TickMessage {
  type: 'tick';
}

interface PauseMessage {
  type: 'pause';
}

interface ResumeMessage {
  type: 'resume';
}

interface ReheatMessage {
  type: 'reheat';
}

type WorkerMessage = InitMessage | TickMessage | PauseMessage | ResumeMessage | ReheatMessage;

// Simulation parameters
const LINK_DISTANCE = 30;
const LINK_STRENGTH = 0.08;
const CHARGE_STRENGTH = -60;
const CLUSTER_ATTRACTION = 0.25;
const CENTER_GRAVITY = 0.01;
const COLLISION_RADIUS_EXTRA = 2;
const ALPHA_DECAY = 0.02;
const ALPHA_MIN = 0.001;
const VELOCITY_DECAY = 0.4;

let nodes: LayoutNode[] = [];
let edges: LayoutEdge[] = [];
let clusterCentroids: { x: number; y: number; z: number; count: number }[] = [];
let alpha = 1.0;
let paused = false;
let initialized = false;

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      initSimulation(msg);
      break;
    case 'tick':
      if (!paused && initialized) {
        tick();
      }
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      break;
    case 'reheat':
      alpha = 0.5;
      paused = false;
      break;
  }
};

function initSimulation(msg: InitMessage): void {
  nodes = [];
  edges = [];

  // Initialize nodes with random positions in a sphere
  const radius = Math.cbrt(msg.nodeCount) * 10;

  for (let i = 0; i < msg.nodeCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * Math.cbrt(Math.random());

    nodes.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
      vx: 0,
      vy: 0,
      vz: 0,
      cluster: msg.clusterAssignments[i] || 0,
      mass: msg.masses[i] || 1,
    });
  }

  // Convert edges
  for (const [source, target] of msg.edges) {
    edges.push({ source, target });
  }

  // Initialize cluster centroids
  clusterCentroids = new Array(msg.clusterCount).fill(null).map(() => ({
    x: 0, y: 0, z: 0, count: 0,
  }));

  alpha = 1.0;
  initialized = true;

  // Send initial positions
  sendPositions();
}

function tick(): void {
  if (alpha < ALPHA_MIN) {
    sendPositions();
    return;
  }

  // Compute cluster centroids
  for (const c of clusterCentroids) {
    c.x = 0; c.y = 0; c.z = 0; c.count = 0;
  }
  for (const node of nodes) {
    const c = clusterCentroids[node.cluster];
    if (c) {
      c.x += node.x;
      c.y += node.y;
      c.z += node.z;
      c.count++;
    }
  }
  for (const c of clusterCentroids) {
    if (c.count > 0) {
      c.x /= c.count;
      c.y /= c.count;
      c.z /= c.count;
    }
  }

  // Apply forces
  applyChargeForce();
  applyLinkForce();
  applyClusterForce();
  applyCenterGravity();

  // Update positions
  for (const node of nodes) {
    node.vx *= VELOCITY_DECAY;
    node.vy *= VELOCITY_DECAY;
    node.vz *= VELOCITY_DECAY;

    node.x += node.vx * alpha;
    node.y += node.vy * alpha;
    node.z += node.vz * alpha;
  }

  alpha *= (1 - ALPHA_DECAY);

  sendPositions();
}

function applyChargeForce(): void {
  // Barnes-Hut approximation for large graphs would be better,
  // but for simplicity use O(n^2) with early termination
  const n = nodes.length;

  // For large graphs, use spatial hashing
  if (n > 2000) {
    applyChargeForceApproximate();
    return;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dz = nodes[j].z - nodes[i].z;
      const dist2 = dx * dx + dy * dy + dz * dz + 0.01;
      const dist = Math.sqrt(dist2);

      const force = CHARGE_STRENGTH / dist2;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;

      nodes[i].vx += fx;
      nodes[i].vy += fy;
      nodes[i].vz += fz;
      nodes[j].vx -= fx;
      nodes[j].vy -= fy;
      nodes[j].vz -= fz;
    }
  }
}

function applyChargeForceApproximate(): void {
  // Simple grid-based approximation for large graphs
  const cellSize = 50;
  const grid = new Map<string, number[]>();

  // Assign nodes to grid cells
  for (let i = 0; i < nodes.length; i++) {
    const cx = Math.floor(nodes[i].x / cellSize);
    const cy = Math.floor(nodes[i].y / cellSize);
    const cz = Math.floor(nodes[i].z / cellSize);
    const key = `${cx},${cy},${cz}`;
    const cell = grid.get(key) || [];
    cell.push(i);
    grid.set(key, cell);
  }

  // Apply repulsion within nearby cells
  for (const [key, indices] of grid) {
    const [cx, cy, cz] = key.split(',').map(Number);

    // Check neighboring cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nKey = `${cx + dx},${cy + dy},${cz + dz}`;
          const neighbors = grid.get(nKey);
          if (!neighbors) continue;

          for (const i of indices) {
            for (const j of neighbors) {
              if (i >= j) continue;

              const ddx = nodes[j].x - nodes[i].x;
              const ddy = nodes[j].y - nodes[i].y;
              const ddz = nodes[j].z - nodes[i].z;
              const dist2 = ddx * ddx + ddy * ddy + ddz * ddz + 0.01;
              const dist = Math.sqrt(dist2);

              const force = CHARGE_STRENGTH / dist2;
              const fx = (ddx / dist) * force;
              const fy = (ddy / dist) * force;
              const fz = (ddz / dist) * force;

              nodes[i].vx += fx;
              nodes[i].vy += fy;
              nodes[i].vz += fz;
              nodes[j].vx -= fx;
              nodes[j].vy -= fy;
              nodes[j].vz -= fz;
            }
          }
        }
      }
    }
  }
}

function applyLinkForce(): void {
  for (const edge of edges) {
    const s = nodes[edge.source];
    const t = nodes[edge.target];
    if (!s || !t) continue;

    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dz = t.z - s.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    const displacement = (dist - LINK_DISTANCE) * LINK_STRENGTH;
    const fx = (dx / dist) * displacement;
    const fy = (dy / dist) * displacement;
    const fz = (dz / dist) * displacement;

    s.vx += fx;
    s.vy += fy;
    s.vz += fz;
    t.vx -= fx;
    t.vy -= fy;
    t.vz -= fz;
  }
}

function applyClusterForce(): void {
  for (const node of nodes) {
    const centroid = clusterCentroids[node.cluster];
    if (!centroid || centroid.count <= 1) continue;

    const dx = centroid.x - node.x;
    const dy = centroid.y - node.y;
    const dz = centroid.z - node.z;

    node.vx += dx * CLUSTER_ATTRACTION;
    node.vy += dy * CLUSTER_ATTRACTION;
    node.vz += dz * CLUSTER_ATTRACTION;
  }
}

function applyCenterGravity(): void {
  for (const node of nodes) {
    node.vx -= node.x * CENTER_GRAVITY;
    node.vy -= node.y * CENTER_GRAVITY;
    node.vz -= node.z * CENTER_GRAVITY;
  }
}

function sendPositions(): void {
  const positions = new Float32Array(nodes.length * 3);

  for (let i = 0; i < nodes.length; i++) {
    positions[i * 3] = nodes[i].x;
    positions[i * 3 + 1] = nodes[i].y;
    positions[i * 3 + 2] = nodes[i].z;
  }

  (self as any).postMessage(
    { type: 'positions', positions, alpha },
    [positions.buffer]
  );
}

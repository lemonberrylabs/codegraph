import { GraphStore } from '../data/graph-store.js';

interface TreemapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Treemap layout — arranges nodes in a flat plane partitioned into rectangular
 * regions by cluster (package/module). The Z-axis represents call depth
 * (distance from entry points). Per PRD 6.7.2.
 */
export class TreemapLayout {
  private store: GraphStore;
  private positions: Float32Array;

  constructor(store: GraphStore) {
    this.store = store;
    this.positions = new Float32Array(store.nodeCount * 3);
  }

  /**
   * Compute treemap positions and return them.
   * Calls the onUpdate callback once with final positions.
   */
  compute(onUpdate: (positions: Float32Array) => void): void {
    const nodes = this.store.nodes;
    const nodeCount = nodes.length;
    if (nodeCount === 0) return;

    // Group nodes by cluster
    const clusterMap = new Map<string, number[]>();
    for (let i = 0; i < nodeCount; i++) {
      const pkg = nodes[i].packageOrModule;
      let arr = clusterMap.get(pkg);
      if (!arr) {
        arr = [];
        clusterMap.set(pkg, arr);
      }
      arr.push(i);
    }

    // Compute call depth (BFS from entry points) for Z-axis
    const depths = this.computeCallDepths();

    // Layout clusters using a simple squarified treemap
    const clusters = [...clusterMap.entries()].sort((a, b) => b[1].length - a[1].length);
    const totalArea = nodeCount;
    const canvasSize = Math.sqrt(totalArea) * 30; // Scale factor for spacing

    const rects = this.squarify(
      clusters.map(([id, nodeIndices]) => ({
        id,
        nodeIndices,
        area: nodeIndices.length,
      })),
      { x: -canvasSize / 2, y: -canvasSize / 2, width: canvasSize, height: canvasSize }
    );

    // Place nodes within their cluster rectangles
    for (const { nodeIndices, rect } of rects) {
      this.placeNodesInRect(nodeIndices, rect, depths);
    }

    onUpdate(this.positions);
  }

  /**
   * Compute call depth for each node via BFS from entry points.
   */
  private computeCallDepths(): number[] {
    const nodes = this.store.nodes;
    const depths = new Array(nodes.length).fill(-1);
    const queue: number[] = [];

    // Start BFS from entry points
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].isEntryPoint || nodes[i].status === 'entry') {
        depths[i] = 0;
        queue.push(i);
      }
    }

    // If no entry points, start from nodes with no incoming edges
    if (queue.length === 0) {
      for (let i = 0; i < nodes.length; i++) {
        const nodeIdx = this.store.getNodeByIndex(i);
        if (nodeIdx && nodeIdx.incomingEdges.length === 0) {
          depths[i] = 0;
          queue.push(i);
        }
      }
    }

    // BFS
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const nodeIdx = this.store.getNodeByIndex(idx);
      if (!nodeIdx) continue;

      for (const edgeIdx of nodeIdx.outgoingEdges) {
        const edge = this.store.edges[edgeIdx];
        const target = this.store.getNodeById(edge.target);
        if (target && depths[target.index] === -1) {
          depths[target.index] = depths[idx] + 1;
          queue.push(target.index);
        }
      }
    }

    // Assign depth 0 to any unreached nodes
    for (let i = 0; i < depths.length; i++) {
      if (depths[i] === -1) depths[i] = 0;
    }

    return depths;
  }

  /**
   * Simple squarified treemap algorithm.
   */
  private squarify(
    items: { id: string; nodeIndices: number[]; area: number }[],
    bounds: TreemapRect
  ): { nodeIndices: number[]; rect: TreemapRect }[] {
    const results: { nodeIndices: number[]; rect: TreemapRect }[] = [];

    if (items.length === 0) return results;
    if (items.length === 1) {
      results.push({ nodeIndices: items[0].nodeIndices, rect: bounds });
      return results;
    }

    const totalArea = items.reduce((sum, item) => sum + item.area, 0);
    const { width, height } = bounds;

    // Split horizontally or vertically based on aspect ratio
    const isWide = width >= height;

    // Binary split: find the split point that makes the first half roughly square
    let runningArea = 0;
    let splitIdx = 0;
    const halfArea = totalArea / 2;

    for (let i = 0; i < items.length - 1; i++) {
      runningArea += items[i].area;
      if (runningArea >= halfArea) {
        splitIdx = i + 1;
        break;
      }
      splitIdx = i + 1;
    }

    if (splitIdx === 0) splitIdx = 1;

    const firstHalf = items.slice(0, splitIdx);
    const secondHalf = items.slice(splitIdx);
    const firstArea = firstHalf.reduce((s, i) => s + i.area, 0);
    const ratio = firstArea / totalArea;

    let rect1: TreemapRect;
    let rect2: TreemapRect;

    if (isWide) {
      const splitX = bounds.x + bounds.width * ratio;
      rect1 = { x: bounds.x, y: bounds.y, width: bounds.width * ratio, height: bounds.height };
      rect2 = { x: splitX, y: bounds.y, width: bounds.width * (1 - ratio), height: bounds.height };
    } else {
      const splitY = bounds.y + bounds.height * ratio;
      rect1 = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height * ratio };
      rect2 = { x: bounds.x, y: splitY, width: bounds.width, height: bounds.height * (1 - ratio) };
    }

    results.push(...this.squarify(firstHalf, rect1));
    results.push(...this.squarify(secondHalf, rect2));

    return results;
  }

  /**
   * Place nodes within a rectangular region in a grid pattern.
   * Z-axis is set based on call depth.
   */
  private placeNodesInRect(
    nodeIndices: number[],
    rect: TreemapRect,
    depths: number[]
  ): void {
    const count = nodeIndices.length;
    if (count === 0) return;

    // Grid layout within the rectangle
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const cellW = rect.width / (cols + 1);
    const cellH = rect.height / (rows + 1);
    const depthScale = 15; // Z units per call depth level

    for (let i = 0; i < count; i++) {
      const nodeIdx = nodeIndices[i];
      const col = i % cols;
      const row = Math.floor(i / cols);

      const x = rect.x + cellW * (col + 1);
      const y = rect.y + cellH * (row + 1);
      const z = depths[nodeIdx] * depthScale;

      this.positions[nodeIdx * 3] = x;
      this.positions[nodeIdx * 3 + 1] = y;
      this.positions[nodeIdx * 3 + 2] = z;
    }
  }
}

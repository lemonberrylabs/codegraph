import { GraphStore } from '../data/graph-store.js';

/**
 * Force-directed layout manager that communicates with the Web Worker.
 */
export class ForceLayout {
  private worker: Worker;
  private store: GraphStore;
  private onPositionUpdate: ((positions: Float32Array) => void) | null = null;
  private running: boolean = false;
  private alpha: number = 1.0;

  constructor(store: GraphStore) {
    this.store = store;
    this.worker = new Worker(
      new URL('./force-worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'positions') {
        this.alpha = msg.alpha;

        // Only apply positions if simulation is still running.
        // This prevents in-flight ticks from overwriting treemap positions
        // after the layout has been paused.
        if (this.running) {
          this.onPositionUpdate?.(msg.positions);
        }

        if (this.running && this.alpha > 0.001) {
          this.worker.postMessage({ type: 'tick' });
        }
      }
    };
  }

  /** Initialize the layout with graph data */
  init(): void {
    const nodes = this.store.nodes;
    const edges = this.store.edges;

    // Build cluster assignments
    const clusterIds = [...new Set(nodes.map(n => n.packageOrModule))];
    const clusterMap = new Map(clusterIds.map((id, i) => [id, i]));
    const clusterAssignments = nodes.map(n => clusterMap.get(n.packageOrModule) || 0);

    // Build edge indices
    const nodeIdToIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const edgePairs: [number, number][] = [];
    for (const edge of edges) {
      const si = nodeIdToIndex.get(edge.source);
      const ti = nodeIdToIndex.get(edge.target);
      if (si !== undefined && ti !== undefined) {
        edgePairs.push([si, ti]);
      }
    }

    // Node masses based on linesOfCode
    const masses = nodes.map(n => Math.log2(Math.max(1, n.linesOfCode)));

    // Compute call depths (BFS from entry points) for Z-axis layering
    const depths = this.computeCallDepths();

    this.worker.postMessage({
      type: 'init',
      nodeCount: nodes.length,
      edges: edgePairs,
      clusterAssignments,
      clusterCount: clusterIds.length,
      masses,
      depths,
    });
  }

  /** BFS from entry points to compute call depth per node */
  private computeCallDepths(): number[] {
    const nodes = this.store.nodes;
    const depths = new Array(nodes.length).fill(-1);
    const queue: number[] = [];

    // Seed with entry points
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].isEntryPoint || nodes[i].status === 'entry') {
        depths[i] = 0;
        queue.push(i);
      }
    }

    // Fallback: if no entry points, use nodes with no incoming edges
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

    return depths;
  }

  /** Start the simulation */
  start(onUpdate: (positions: Float32Array) => void): void {
    this.onPositionUpdate = onUpdate;
    this.running = true;
    this.worker.postMessage({ type: 'tick' });
  }

  /** Pause the simulation */
  pause(): void {
    this.running = false;
    this.worker.postMessage({ type: 'pause' });
  }

  /** Resume the simulation */
  resume(): void {
    this.running = true;
    this.worker.postMessage({ type: 'resume' });
    this.worker.postMessage({ type: 'tick' });
  }

  /** Toggle pause/resume */
  toggle(): boolean {
    if (this.running) {
      this.pause();
    } else {
      this.resume();
    }
    return this.running;
  }

  /** Reheat the simulation (e.g., after graph update) */
  reheat(): void {
    this.running = true;
    this.worker.postMessage({ type: 'reheat' });
    this.worker.postMessage({ type: 'tick' });
  }

  /** Get current alpha (convergence level) */
  getAlpha(): number {
    return this.alpha;
  }

  isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.worker.terminate();
  }
}

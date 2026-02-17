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
        this.onPositionUpdate?.(msg.positions);

        // Continue ticking if still running
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

    this.worker.postMessage({
      type: 'init',
      nodeCount: nodes.length,
      edges: edgePairs,
      clusterAssignments,
      clusterCount: clusterIds.length,
      masses,
    });
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

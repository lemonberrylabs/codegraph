import type { CodeGraph } from '../../analyzer/types.js';
import { GraphStore } from './graph-store.js';

/**
 * Load graph data from a URL or embedded data.
 */
export async function loadGraph(store: GraphStore): Promise<void> {
  // Try multiple sources:
  // 1. Embedded data (for serve mode)
  // 2. URL parameter
  // 3. Default path

  const urlParams = new URLSearchParams(window.location.search);
  const dataUrl = urlParams.get('data') || '/api/graph';

  try {
    // Check for embedded data first
    const embedded = (window as any).__CODEGRAPH_DATA__;
    if (embedded) {
      store.load(embedded as CodeGraph);
      return;
    }

    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to load graph data: ${response.status} ${response.statusText}`);
    }

    const graph: CodeGraph = await response.json();
    store.load(graph);
  } catch (err) {
    // Try loading from a local file
    try {
      const response = await fetch('/codegraph-output.json');
      if (response.ok) {
        const graph: CodeGraph = await response.json();
        store.load(graph);
        return;
      }
    } catch {
      // Fall through
    }

    throw new Error(
      'Could not load graph data. Start the server with `codegraph serve` or ' +
      'provide a data URL via ?data=path/to/graph.json'
    );
  }
}

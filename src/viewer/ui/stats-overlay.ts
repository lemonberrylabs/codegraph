import { GraphStore } from '../data/graph-store.js';

export function updateStatsOverlay(store: GraphStore): void {
  const graph = store.graph;
  const stats = graph.stats;

  document.getElementById('stat-total')!.textContent = graph.metadata.totalFunctions.toLocaleString();
  document.getElementById('stat-edges')!.textContent = graph.metadata.totalEdges.toLocaleString();
  document.getElementById('stat-dead')!.textContent = `${stats.deadFunctions.count} (${stats.deadFunctions.percentage}%)`;
  document.getElementById('stat-unused')!.textContent = `${stats.unusedParameters.count}`;
  document.getElementById('stat-live')!.textContent = (
    graph.metadata.totalFunctions - stats.deadFunctions.count - stats.entryPoints.count
  ).toLocaleString();
  document.getElementById('stat-entry')!.textContent = stats.entryPoints.count.toString();
}

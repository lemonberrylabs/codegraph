import type { GraphScene } from '../scene/graph-scene.js';
import type { NodeRenderer } from '../scene/node-renderer.js';
import type { EdgeRenderer } from '../scene/edge-renderer.js';
import type { LabelRenderer } from '../scene/label-renderer.js';
import type { ClusterRenderer } from '../scene/cluster-renderer.js';
import type { GraphStore } from '../data/graph-store.js';
import { setColorMode } from '../utils/colors.js';
import { showSearch } from '../ui/search.js';
import { setPresetFilter, toggleFilterPanel, isFilterPanelOpen } from './filters.js';
import {
  exportScreenshot,
  exportDeadCodeJSON,
  exportDeadCodeCSV,
  exportMarkdownReport,
} from './export.js';

export interface ToolbarDeps {
  graphScene: GraphScene;
  nodeRenderer: NodeRenderer;
  edgeRenderer: EdgeRenderer;
  labelRenderer: LabelRenderer;
  clusterRenderer: ClusterRenderer;
  store: GraphStore;
  getClusterColorMode: () => boolean;
  setClusterColorMode: (value: boolean) => void;
}

/**
 * Set up toolbar button event listeners.
 */
export function setupToolbar(deps: ToolbarDeps): void {
  // Filter buttons
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter')!;
      setPresetFilter(filter);

      // Update active button
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Toggle buttons
  document.getElementById('btn-edges')?.addEventListener('click', () => {
    const visible = deps.edgeRenderer.toggleVisible();
    document.getElementById('btn-edges')?.classList.toggle('active', visible);
  });

  document.getElementById('btn-labels')?.addEventListener('click', () => {
    const showing = deps.labelRenderer.toggleShowAll();
    document.getElementById('btn-labels')?.classList.toggle('active', showing);
  });

  document.getElementById('btn-clusters')?.addEventListener('click', () => {
    const newMode = !deps.getClusterColorMode();
    deps.setClusterColorMode(newMode);
    setColorMode(newMode ? 'cluster' : 'normal');
    deps.nodeRenderer.updateColors();
    deps.clusterRenderer.setVisible(newMode);
    document.getElementById('btn-clusters')?.classList.toggle('active', newMode);
  });

  document.getElementById('btn-search')?.addEventListener('click', () => {
    showSearch();
  });

  document.getElementById('btn-filters')?.addEventListener('click', () => {
    toggleFilterPanel();
    document.getElementById('btn-filters')?.classList.toggle('active', isFilterPanelOpen());
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    deps.graphScene.resetCamera();
  });

  // Colorblind mode toggle
  let colorblindMode = false;
  document.getElementById('btn-colorblind')?.addEventListener('click', () => {
    colorblindMode = !colorblindMode;
    setColorMode(colorblindMode ? 'colorblind' : (deps.getClusterColorMode() ? 'cluster' : 'normal'));
    deps.nodeRenderer.updateColors();
    document.getElementById('btn-colorblind')?.classList.toggle('active', colorblindMode);
  });

  // Export menu
  const exportMenu = document.getElementById('export-menu')!;
  document.getElementById('btn-export')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    exportMenu.style.top = `${rect.bottom + 4}px`;
    exportMenu.style.left = `${rect.left}px`;
    exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('export-screenshot')?.addEventListener('click', () => {
    exportScreenshot(deps.graphScene);
    exportMenu.style.display = 'none';
  });
  document.getElementById('export-json')?.addEventListener('click', () => {
    exportDeadCodeJSON(deps.store);
    exportMenu.style.display = 'none';
  });
  document.getElementById('export-csv')?.addEventListener('click', () => {
    exportDeadCodeCSV(deps.store);
    exportMenu.style.display = 'none';
  });
  document.getElementById('export-md')?.addEventListener('click', () => {
    exportMarkdownReport(deps.store);
    exportMenu.style.display = 'none';
  });

  // Close export menu on click outside
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#export-menu') && !target.closest('#btn-export')) {
      exportMenu.style.display = 'none';
    }
  });
}

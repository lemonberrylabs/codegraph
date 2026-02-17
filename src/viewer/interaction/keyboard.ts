import type { GraphScene } from '../scene/graph-scene.js';
import type { NodeRenderer } from '../scene/node-renderer.js';
import type { EdgeRenderer } from '../scene/edge-renderer.js';
import type { LabelRenderer } from '../scene/label-renderer.js';
import type { ClusterRenderer } from '../scene/cluster-renderer.js';
import type { ForceLayout } from '../layout/force-layout.js';
import type { SelectionManager } from './selection.js';
import type { GraphStore } from '../data/graph-store.js';
import { isSearchVisible, showSearch, hideSearch } from '../ui/search.js';
import { isPanelOpen, closePanel } from '../ui/side-panel.js';
import { setColorMode } from '../utils/colors.js';
import { setPresetFilter } from '../ui/filters.js';
import * as THREE from 'three';

export interface KeyboardDeps {
  graphScene: GraphScene;
  nodeRenderer: NodeRenderer;
  edgeRenderer: EdgeRenderer;
  labelRenderer: LabelRenderer;
  clusterRenderer: ClusterRenderer;
  forceLayout: ForceLayout;
  selectionManager: SelectionManager;
  store: GraphStore;
  getClusterColorMode: () => boolean;
  setClusterColorMode: (value: boolean) => void;
  updateFilterButtons: (filter: string) => void;
}

/**
 * Set up all keyboard shortcuts as specified in PRD 6.4.3.
 */
export function setupKeyboard(deps: KeyboardDeps): void {
  let flaggedNodesCursor = 0;
  const helpOverlay = document.getElementById('help-overlay')!;

  document.addEventListener('keydown', (e) => {
    // Don't handle shortcuts when typing in an input
    if (e.target instanceof HTMLInputElement) return;

    switch (e.key) {
      case '/':
      case 'k':
        if (e.key === 'k' && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        showSearch();
        break;

      case 'Escape':
        if (isSearchVisible()) {
          hideSearch();
        } else if (isPanelOpen()) {
          closePanel();
        } else if (helpOverlay.classList.contains('visible')) {
          helpOverlay.classList.remove('visible');
        } else {
          deps.selectionManager.deselectAll();
          deps.nodeRenderer.clearHighlights();
          deps.edgeRenderer.resetColors();
          deps.labelRenderer.clearAll();
        }
        break;

      case 'r':
      case 'R':
        deps.graphScene.resetCamera();
        break;

      case 'f':
      case 'F':
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
        break;

      case '1':
        setPresetFilter('all');
        deps.updateFilterButtons('all');
        break;

      case '2':
        setPresetFilter('dead');
        deps.updateFilterButtons('dead');
        break;

      case '3':
        setPresetFilter('unused');
        deps.updateFilterButtons('unused');
        break;

      case '4':
        setPresetFilter('entry');
        deps.updateFilterButtons('entry');
        break;

      case 'h':
      case 'H':
        deps.edgeRenderer.toggleVisible();
        break;

      case 'l':
      case 'L':
        deps.labelRenderer.toggleShowAll();
        break;

      case 'c':
      case 'C': {
        const newMode = !deps.getClusterColorMode();
        deps.setClusterColorMode(newMode);
        setColorMode(newMode ? 'cluster' : 'normal');
        deps.nodeRenderer.updateColors();
        deps.clusterRenderer.setVisible(newMode);
        document.getElementById('btn-clusters')?.classList.toggle('active', newMode);
        break;
      }

      case ' ':
        e.preventDefault();
        deps.forceLayout.toggle();
        break;

      case 'Tab': {
        e.preventDefault();
        // Cycle through flagged nodes (dead + unused params)
        const flagged = deps.store.nodes
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => n.status === 'dead' || n.unusedParameters.length > 0);

        if (flagged.length > 0) {
          flaggedNodesCursor = (flaggedNodesCursor + 1) % flagged.length;
          const target = flagged[flaggedNodesCursor];
          deps.selectionManager.select(target.i);
          const nodeIdx = deps.store.getNodeByIndex(target.i);
          if (nodeIdx) {
            deps.graphScene.flyTo(
              new THREE.Vector3(nodeIdx.position.x, nodeIdx.position.y, nodeIdx.position.z)
            );
          }
        }
        break;
      }

      case 'a':
      case 'A': {
        const active = deps.graphScene.toggleAutoRotate();
        document.getElementById('btn-autorotate')?.classList.toggle('active', active);
        break;
      }

      case '?':
        helpOverlay.classList.toggle('visible');
        break;
    }
  });
}

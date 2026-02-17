import * as THREE from 'three';
import { GraphStore } from './data/graph-store.js';
import { loadGraph } from './data/graph-loader.js';
import { WebSocketClient } from './data/websocket-client.js';
import { GraphScene } from './scene/graph-scene.js';
import { NodeRenderer } from './scene/node-renderer.js';
import { EdgeRenderer } from './scene/edge-renderer.js';
import { LabelRenderer } from './scene/label-renderer.js';
import { ClusterRenderer } from './scene/cluster-renderer.js';
import { ForceLayout } from './layout/force-layout.js';
import { TreemapLayout } from './layout/treemap-layout.js';
import { GraphRaycaster } from './interaction/raycaster.js';
import { SelectionManager } from './interaction/selection.js';
import { setupKeyboard } from './interaction/keyboard.js';
import { showTooltip, hideTooltip } from './ui/tooltip.js';
import { initSearch } from './ui/search.js';
import {
  showNodeDetails,
  closePanel,
  setNavigateCallback,
} from './ui/side-panel.js';
import { updateStatsOverlay } from './ui/stats-overlay.js';
import { initFilters } from './ui/filters.js';
import { setupToolbar } from './ui/toolbar.js';

// ─── State ───
const store = new GraphStore();
let graphScene: GraphScene;
let nodeRenderer: NodeRenderer;
let edgeRenderer: EdgeRenderer;
let labelRenderer: LabelRenderer;
let clusterRenderer: ClusterRenderer;
let forceLayout: ForceLayout;
let raycaster: GraphRaycaster;
let selectionManager: SelectionManager;
let wsClient: WebSocketClient;

let clusterColorMode = false;
let treemapLayout: TreemapLayout;
let layoutMode: 'force' | 'treemap' = 'force';

// ─── Init ───
async function init() {
  const loading = document.getElementById('loading')!;
  const container = document.getElementById('canvas-container')!;

  try {
    // Load graph data
    await loadGraph(store);

    // Create scene
    graphScene = new GraphScene(container);

    // Create renderers
    nodeRenderer = new NodeRenderer(store, graphScene);
    edgeRenderer = new EdgeRenderer(store, graphScene);
    labelRenderer = new LabelRenderer(store, graphScene);
    clusterRenderer = new ClusterRenderer(store, graphScene);

    nodeRenderer.init();
    edgeRenderer.init();

    // Create layout
    forceLayout = new ForceLayout(store);
    forceLayout.init();

    // Start layout simulation
    forceLayout.start((positions: Float32Array) => {
      nodeRenderer.updatePositions(positions);
      edgeRenderer.updatePositions();
      labelRenderer.updatePositions();
      clusterRenderer.update();
    });

    // Create treemap layout (for alternative layout mode)
    treemapLayout = new TreemapLayout(store);

    // Create interaction handlers
    selectionManager = new SelectionManager(store);
    raycaster = new GraphRaycaster(graphScene, nodeRenderer, store);

    // ─── Hover ───
    let lastMouseX = 0, lastMouseY = 0;
    document.addEventListener('mousemove', (e) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    raycaster.onHover = (nodeIndex: number) => {
      if (nodeIndex >= 0) {
        const nodeIdx = store.getNodeByIndex(nodeIndex);
        if (nodeIdx) {
          nodeRenderer.setHovered(nodeIndex);
          edgeRenderer.highlightForNode(nodeIdx.node.id);
          labelRenderer.showLabel(nodeIndex);
          showTooltip(nodeIdx.node, lastMouseX, lastMouseY);

          // Highlight neighbors
          const neighborSet = new Set([nodeIndex, ...nodeIdx.neighbors]);
          nodeRenderer.setHighlighted(neighborSet);
        }
      } else {
        nodeRenderer.clearHighlights();
        edgeRenderer.resetColors();
        hideTooltip();

        // Only keep selected node labels
        const sel = selectionManager.getPrimarySelection();
        if (sel >= 0) {
          const selIdx = store.getNodeByIndex(sel);
          if (selIdx) {
            const labels = [sel, ...selIdx.neighbors];
            labelRenderer.showLabelsFor(labels);
          }
        } else {
          labelRenderer.clearAll();
        }
      }
    };

    // ─── Click/Select ───
    raycaster.onClick = (nodeIndex: number, event: MouseEvent) => {
      if (nodeIndex >= 0) {
        if (event.ctrlKey || event.metaKey) {
          selectionManager.toggleSelect(nodeIndex);
        } else if (event.shiftKey) {
          selectionManager.selectWithNeighbors(nodeIndex);
        } else {
          selectionManager.select(nodeIndex);
        }
      } else {
        selectionManager.deselectAll();
        closePanel();
        edgeRenderer.resetColors();
      }
    };

    // ─── Double-click: fly to node ───
    raycaster.onDoubleClick = (nodeIndex: number) => {
      const nodeIdx = store.getNodeByIndex(nodeIndex);
      if (nodeIdx) {
        graphScene.flyTo(
          new THREE.Vector3(nodeIdx.position.x, nodeIdx.position.y, nodeIdx.position.z)
        );
      }
    };

    // ─── Selection change handler ───
    selectionManager.onSelectionChange((selected, primaryIndex) => {
      if (primaryIndex >= 0) {
        const nodeIdx = store.getNodeByIndex(primaryIndex);
        if (nodeIdx) {
          nodeRenderer.setSelected(primaryIndex);
          edgeRenderer.highlightForNode(nodeIdx.node.id);
          showNodeDetails(nodeIdx, store);

          // Show labels for selected + neighbors
          const labels = [primaryIndex, ...nodeIdx.neighbors];
          labelRenderer.showLabelsFor(labels);

          // Highlight reachability cone
          const reachableDown = store.getReachableFrom(nodeIdx.node.id);
          const reachableUp = store.getReachableTo(nodeIdx.node.id);
          const allReachable = new Set<number>();
          for (const id of reachableDown) {
            const idx = store.getNodeById(id);
            if (idx) allReachable.add(idx.index);
          }
          for (const id of reachableUp) {
            const idx = store.getNodeById(id);
            if (idx) allReachable.add(idx.index);
          }
          nodeRenderer.setHighlighted(allReachable);
        }
      } else {
        nodeRenderer.setSelected(-1);
        nodeRenderer.clearHighlights();
        edgeRenderer.resetColors();
        labelRenderer.clearAll();
      }
    });

    // ─── Side panel navigation ───
    setNavigateCallback((nodeId: string) => {
      const nodeIdx = store.getNodeById(nodeId);
      if (nodeIdx) {
        selectionManager.select(nodeIdx.index);
        graphScene.flyTo(
          new THREE.Vector3(nodeIdx.position.x, nodeIdx.position.y, nodeIdx.position.z)
        );
      }
    });

    // ─── Search ───
    initSearch(store, (nodeId: string) => {
      const nodeIdx = store.getNodeById(nodeId);
      if (nodeIdx) {
        selectionManager.select(nodeIdx.index);
        graphScene.flyTo(
          new THREE.Vector3(nodeIdx.position.x, nodeIdx.position.y, nodeIdx.position.z)
        );
      }
    });

    // ─── Filters ───
    initFilters(store, (mask: boolean[]) => {
      nodeRenderer.setVisibility(mask);
      edgeRenderer.updateEdgeVisibility(mask);
      edgeRenderer.updatePositions();
    });

    // ─── Frame update ───
    graphScene.onFrame(() => {
      const dist = graphScene.getCameraDistance();
      edgeRenderer.updateLOD(dist);
      labelRenderer.updateLOD(dist);
    });

    // ─── Layout update helper ───
    const updateLayout = (positions: Float32Array) => {
      nodeRenderer.updatePositions(positions);
      edgeRenderer.updatePositions();
      labelRenderer.updatePositions();
      clusterRenderer.update();
    };

    // ─── Toolbar ───
    setupToolbar({
      graphScene,
      nodeRenderer,
      edgeRenderer,
      labelRenderer,
      clusterRenderer,
      store,
      getClusterColorMode: () => clusterColorMode,
      setClusterColorMode: (v) => { clusterColorMode = v; },
      getLayoutMode: () => layoutMode,
      setLayoutMode: (mode) => {
        layoutMode = mode;
        if (mode === 'treemap') {
          forceLayout.pause();
          // Small delay to let any in-flight force ticks drain
          setTimeout(() => {
            treemapLayout.compute((positions) => {
              updateLayout(positions);
              // Camera above X/Z grid looking down at Y-depth layers
              const extent = Math.sqrt(store.nodeCount) * 10;
              graphScene.flyTo(
                new THREE.Vector3(0, -extent * 0.2, 0),
                0.8,
                new THREE.Vector3(0, extent * 1.2, extent * 0.3)
              );
            });
          }, 50);
        } else {
          forceLayout.reheat();
          graphScene.resetCamera();
        }
      },
    });

    // ─── Keyboard shortcuts ───
    setupKeyboard({
      graphScene,
      nodeRenderer,
      edgeRenderer,
      labelRenderer,
      clusterRenderer,
      forceLayout,
      selectionManager,
      store,
      getClusterColorMode: () => clusterColorMode,
      setClusterColorMode: (v) => { clusterColorMode = v; },
      updateFilterButtons,
    });

    // ─── Stats overlay ───
    updateStatsOverlay(store);

    // ─── WebSocket (for watch mode) ───
    wsClient = new WebSocketClient();
    wsClient.connect((graph) => {
      store.load(graph);
      nodeRenderer.dispose();
      edgeRenderer.dispose();
      labelRenderer.dispose();
      nodeRenderer = new NodeRenderer(store, graphScene);
      edgeRenderer = new EdgeRenderer(store, graphScene);
      labelRenderer = new LabelRenderer(store, graphScene);
      nodeRenderer.init();
      edgeRenderer.init();
      forceLayout.init();
      forceLayout.reheat();
      updateStatsOverlay(store);
    });

    // Start rendering
    graphScene.start();

    // Hide loading screen
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 500);

  } catch (err) {
    loading.querySelector('p')!.textContent = `Error: ${(err as Error).message}`;
    loading.querySelector('.spinner')?.remove();
    console.error('Failed to initialize CodeGraph viewer:', err);
  }
}

function updateFilterButtons(filter: string): void {
  document.querySelectorAll('[data-filter]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-filter') === filter);
  });
}

// ─── Boot ───
init();

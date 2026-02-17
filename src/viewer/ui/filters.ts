import type { GraphNode } from '../../analyzer/types.js';
import { GraphStore, NodeIndex } from '../data/graph-store.js';

export interface FilterState {
  status: Set<string>;       // 'live' | 'dead' | 'entry'
  hasUnusedParams: boolean;
  packages: Set<string>;     // empty = all packages
  minConnections: number;
  maxConnections: number;    // Infinity = no max
  minLOC: number;
  maxLOC: number;            // Infinity = no max
  visibility: Set<string>;   // empty = all visibility levels
  kind: Set<string>;         // empty = all function kinds
}

export type FilterChangeCallback = (mask: boolean[]) => void;

const defaultFilter: FilterState = {
  status: new Set(['live', 'dead', 'entry']),
  hasUnusedParams: false,
  packages: new Set(),
  minConnections: 0,
  maxConnections: Infinity,
  minLOC: 0,
  maxLOC: Infinity,
  visibility: new Set(),
  kind: new Set(),
};

let currentFilter: FilterState = { ...defaultFilter, status: new Set(defaultFilter.status) };
let store: GraphStore;
let onChange: FilterChangeCallback | null = null;
let filterPanelEl: HTMLElement | null = null;

export function initFilters(graphStore: GraphStore, callback: FilterChangeCallback): void {
  store = graphStore;
  onChange = callback;
  buildFilterPanel();
}

export function getFilterMask(): boolean[] {
  const mask: boolean[] = new Array(store.nodeCount).fill(false);

  for (let i = 0; i < store.nodeCount; i++) {
    const node = store.nodes[i];
    const nodeIdx = store.getNodeByIndex(i);
    if (!nodeIdx) continue;

    // Status filter
    if (!currentFilter.status.has(node.status)) continue;

    // Unused params filter
    if (currentFilter.hasUnusedParams && node.unusedParameters.length === 0) continue;

    // Package filter
    if (currentFilter.packages.size > 0 && !currentFilter.packages.has(node.packageOrModule)) continue;

    // Connection count filter
    const connections = nodeIdx.incomingEdges.length + nodeIdx.outgoingEdges.length;
    if (connections < currentFilter.minConnections) continue;
    if (connections > currentFilter.maxConnections) continue;

    // Lines of code filter
    if (node.linesOfCode < currentFilter.minLOC) continue;
    if (node.linesOfCode > currentFilter.maxLOC) continue;

    // Visibility filter
    if (currentFilter.visibility.size > 0 && !currentFilter.visibility.has(node.visibility)) continue;

    // Kind filter
    if (currentFilter.kind.size > 0 && !currentFilter.kind.has(node.kind)) continue;

    mask[i] = true;
  }

  return mask;
}

/** Apply a quick preset filter (used by toolbar buttons and keyboard shortcuts) */
export function setPresetFilter(preset: string): void {
  // Reset to defaults first
  currentFilter = {
    ...defaultFilter,
    status: new Set(defaultFilter.status),
    packages: new Set(),
    visibility: new Set(),
    kind: new Set(),
  };

  switch (preset) {
    case 'all':
      // defaults are fine
      break;
    case 'dead':
      currentFilter.status = new Set(['dead']);
      break;
    case 'unused':
      currentFilter.hasUnusedParams = true;
      break;
    case 'entry':
      currentFilter.status = new Set(['entry']);
      break;
  }

  applyFilter();
  updateFilterPanelUI();
}

/** Apply current filter state and notify callback */
function applyFilter(): void {
  if (onChange) {
    onChange(getFilterMask());
  }
}

function buildFilterPanel(): void {
  filterPanelEl = document.getElementById('filter-panel');
  if (!filterPanelEl) return;

  // Collect unique packages, visibility levels, kinds
  const allPackages = new Set<string>();
  const allVisibilities = new Set<string>();
  const allKinds = new Set<string>();

  for (const node of store.nodes) {
    allPackages.add(node.packageOrModule);
    allVisibilities.add(node.visibility);
    allKinds.add(node.kind);
  }

  filterPanelEl.innerHTML = `
    <div class="filter-section">
      <h4>Status</h4>
      <label><input type="checkbox" data-filter-status="live" checked> Live</label>
      <label><input type="checkbox" data-filter-status="dead" checked> Dead</label>
      <label><input type="checkbox" data-filter-status="entry" checked> Entry Point</label>
    </div>

    <div class="filter-section">
      <h4>Issues</h4>
      <label><input type="checkbox" data-filter-unused-params> Has Unused Parameters</label>
    </div>

    <div class="filter-section">
      <h4>Kind</h4>
      ${[...allKinds].sort().map(k =>
        `<label><input type="checkbox" data-filter-kind="${k}" checked> ${k}</label>`
      ).join('\n')}
    </div>

    <div class="filter-section">
      <h4>Visibility</h4>
      ${[...allVisibilities].sort().map(v =>
        `<label><input type="checkbox" data-filter-visibility="${v}" checked> ${v}</label>`
      ).join('\n')}
    </div>

    <div class="filter-section">
      <h4>Connections</h4>
      <div class="filter-range">
        <label>Min: <input type="number" data-filter-min-conn value="0" min="0" style="width:60px"></label>
        <label>Max: <input type="number" data-filter-max-conn value="" min="0" placeholder="∞" style="width:60px"></label>
      </div>
    </div>

    <div class="filter-section">
      <h4>Lines of Code</h4>
      <div class="filter-range">
        <label>Min: <input type="number" data-filter-min-loc value="0" min="0" style="width:60px"></label>
        <label>Max: <input type="number" data-filter-max-loc value="" min="0" placeholder="∞" style="width:60px"></label>
      </div>
    </div>

    <div class="filter-section">
      <h4>Package / Module</h4>
      <div class="filter-packages" style="max-height:150px;overflow-y:auto">
        ${[...allPackages].sort().map(p =>
          `<label><input type="checkbox" data-filter-package="${p}" checked> ${p}</label>`
        ).join('\n')}
      </div>
    </div>

    <div class="filter-section">
      <button id="filter-reset" class="toolbar-btn" style="width:100%">Reset All Filters</button>
    </div>
  `;

  // Attach event listeners
  attachFilterListeners();
}

function attachFilterListeners(): void {
  if (!filterPanelEl) return;

  // Status checkboxes
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-status]').forEach(cb => {
    cb.addEventListener('change', () => {
      const status = cb.getAttribute('data-filter-status')!;
      if (cb.checked) currentFilter.status.add(status);
      else currentFilter.status.delete(status);
      applyFilter();
    });
  });

  // Unused params
  filterPanelEl.querySelector<HTMLInputElement>('[data-filter-unused-params]')?.addEventListener('change', (e) => {
    currentFilter.hasUnusedParams = (e.target as HTMLInputElement).checked;
    applyFilter();
  });

  // Kind checkboxes
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-kind]').forEach(cb => {
    cb.addEventListener('change', () => {
      const kind = cb.getAttribute('data-filter-kind')!;
      // When all are checked, the set is empty (meaning "all"); when some are unchecked, track which are active
      updateSetFromCheckboxes('[data-filter-kind]', currentFilter.kind);
      applyFilter();
    });
  });

  // Visibility checkboxes
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-visibility]').forEach(cb => {
    cb.addEventListener('change', () => {
      updateSetFromCheckboxes('[data-filter-visibility]', currentFilter.visibility);
      applyFilter();
    });
  });

  // Connection range
  filterPanelEl.querySelector<HTMLInputElement>('[data-filter-min-conn]')?.addEventListener('input', (e) => {
    currentFilter.minConnections = parseInt((e.target as HTMLInputElement).value) || 0;
    applyFilter();
  });
  filterPanelEl.querySelector<HTMLInputElement>('[data-filter-max-conn]')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentFilter.maxConnections = val ? parseInt(val) : Infinity;
    applyFilter();
  });

  // LOC range
  filterPanelEl.querySelector<HTMLInputElement>('[data-filter-min-loc]')?.addEventListener('input', (e) => {
    currentFilter.minLOC = parseInt((e.target as HTMLInputElement).value) || 0;
    applyFilter();
  });
  filterPanelEl.querySelector<HTMLInputElement>('[data-filter-max-loc]')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentFilter.maxLOC = val ? parseInt(val) : Infinity;
    applyFilter();
  });

  // Package checkboxes
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-package]').forEach(cb => {
    cb.addEventListener('change', () => {
      updateSetFromCheckboxes('[data-filter-package]', currentFilter.packages);
      applyFilter();
    });
  });

  // Reset button
  filterPanelEl.querySelector('#filter-reset')?.addEventListener('click', () => {
    resetFilters();
  });
}

/**
 * Update a set based on checkbox state.
 * If ALL checkboxes are checked, the set is emptied (meaning "show all").
 * If some are unchecked, the set contains only the checked values.
 */
function updateSetFromCheckboxes(selector: string, targetSet: Set<string>): void {
  if (!filterPanelEl) return;

  const checkboxes = filterPanelEl.querySelectorAll<HTMLInputElement>(selector);
  const checked: string[] = [];
  const total = checkboxes.length;

  checkboxes.forEach(cb => {
    const val = cb.getAttribute(selector.replace('[', '').replace(']', ''))!;
    if (cb.checked) checked.push(val);
  });

  targetSet.clear();
  if (checked.length < total) {
    // Not all checked — filter to only checked values
    for (const v of checked) targetSet.add(v);
  }
  // If all checked, set stays empty (meaning "all")
}

function resetFilters(): void {
  currentFilter = {
    ...defaultFilter,
    status: new Set(defaultFilter.status),
    packages: new Set(),
    visibility: new Set(),
    kind: new Set(),
  };
  updateFilterPanelUI();
  applyFilter();
}

function updateFilterPanelUI(): void {
  if (!filterPanelEl) return;

  // Update status checkboxes
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-status]').forEach(cb => {
    const status = cb.getAttribute('data-filter-status')!;
    cb.checked = currentFilter.status.has(status);
  });

  // Update unused params
  const unusedCb = filterPanelEl.querySelector<HTMLInputElement>('[data-filter-unused-params]');
  if (unusedCb) unusedCb.checked = currentFilter.hasUnusedParams;

  // Reset kind/visibility/package to all checked
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-kind]').forEach(cb => {
    cb.checked = currentFilter.kind.size === 0 || currentFilter.kind.has(cb.getAttribute('data-filter-kind')!);
  });
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-visibility]').forEach(cb => {
    cb.checked = currentFilter.visibility.size === 0 || currentFilter.visibility.has(cb.getAttribute('data-filter-visibility')!);
  });
  filterPanelEl.querySelectorAll<HTMLInputElement>('[data-filter-package]').forEach(cb => {
    cb.checked = currentFilter.packages.size === 0 || currentFilter.packages.has(cb.getAttribute('data-filter-package')!);
  });

  // Reset range inputs
  const minConn = filterPanelEl.querySelector<HTMLInputElement>('[data-filter-min-conn]');
  if (minConn) minConn.value = String(currentFilter.minConnections);
  const maxConn = filterPanelEl.querySelector<HTMLInputElement>('[data-filter-max-conn]');
  if (maxConn) maxConn.value = currentFilter.maxConnections === Infinity ? '' : String(currentFilter.maxConnections);
  const minLoc = filterPanelEl.querySelector<HTMLInputElement>('[data-filter-min-loc]');
  if (minLoc) minLoc.value = String(currentFilter.minLOC);
  const maxLoc = filterPanelEl.querySelector<HTMLInputElement>('[data-filter-max-loc]');
  if (maxLoc) maxLoc.value = currentFilter.maxLOC === Infinity ? '' : String(currentFilter.maxLOC);
}

export function toggleFilterPanel(): void {
  if (!filterPanelEl) return;
  filterPanelEl.classList.toggle('open');
}

export function isFilterPanelOpen(): boolean {
  return filterPanelEl?.classList.contains('open') ?? false;
}

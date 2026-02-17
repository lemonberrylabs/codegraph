import { GraphStore, NodeIndex } from '../data/graph-store.js';

export type SelectionChangeCallback = (selected: NodeIndex[], primaryIndex: number) => void;

/**
 * Manages node selection state.
 */
export class SelectionManager {
  private store: GraphStore;
  private selected: Set<number> = new Set();
  private primarySelection: number = -1;
  private onChange: SelectionChangeCallback | null = null;

  constructor(store: GraphStore) {
    this.store = store;
  }

  onSelectionChange(callback: SelectionChangeCallback): void {
    this.onChange = callback;
  }

  /** Select a single node (deselecting all others) */
  select(nodeIndex: number): void {
    this.selected.clear();
    if (nodeIndex >= 0) {
      this.selected.add(nodeIndex);
      this.primarySelection = nodeIndex;
    } else {
      this.primarySelection = -1;
    }
    this.notifyChange();
  }

  /** Toggle a node in the selection (Ctrl+click) */
  toggleSelect(nodeIndex: number): void {
    if (this.selected.has(nodeIndex)) {
      this.selected.delete(nodeIndex);
      if (this.primarySelection === nodeIndex) {
        this.primarySelection = this.selected.size > 0 ? [...this.selected][0] : -1;
      }
    } else {
      this.selected.add(nodeIndex);
      this.primarySelection = nodeIndex;
    }
    this.notifyChange();
  }

  /** Select a node and all its direct neighbors (Shift+click) */
  selectWithNeighbors(nodeIndex: number): void {
    this.selected.clear();
    this.selected.add(nodeIndex);
    this.primarySelection = nodeIndex;

    const nodeIdx = this.store.getNodeByIndex(nodeIndex);
    if (nodeIdx) {
      for (const neighbor of nodeIdx.neighbors) {
        this.selected.add(neighbor);
      }
    }
    this.notifyChange();
  }

  /** Deselect all nodes */
  deselectAll(): void {
    this.selected.clear();
    this.primarySelection = -1;
    this.notifyChange();
  }

  /** Get the primary selected node index */
  getPrimarySelection(): number {
    return this.primarySelection;
  }

  /** Get all selected indices */
  getSelection(): Set<number> {
    return new Set(this.selected);
  }

  /** Check if a node is selected */
  isSelected(nodeIndex: number): boolean {
    return this.selected.has(nodeIndex);
  }

  /** Get selected node data */
  getSelectedNodes(): NodeIndex[] {
    return [...this.selected]
      .map(i => this.store.getNodeByIndex(i))
      .filter((n): n is NodeIndex => n !== undefined);
  }

  private notifyChange(): void {
    const selectedNodes = this.getSelectedNodes();
    this.onChange?.(selectedNodes, this.primarySelection);
  }
}

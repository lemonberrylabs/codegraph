import type { CodeGraph } from '../../analyzer/types.js';

/**
 * WebSocket client for live-reload in watch mode.
 * Uses exponential backoff for reconnection.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private onUpdate: ((graph: CodeGraph) => void) | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30000; // 30 seconds max
  private baseDelay = 1000; // 1 second initial
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(onUpdate: (graph: CodeGraph) => void): void {
    this.onUpdate = onUpdate;
    this.intentionalClose = false;
    this.doConnect();
  }

  private doConnect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[CodeGraph] WebSocket connected');
      this.reconnectAttempt = 0; // Reset on successful connection
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'graph-update' && data.graph) {
          console.log('[CodeGraph] Graph updated');
          this.onUpdate?.(data.graph as CodeGraph);
        }
      } catch (err) {
        console.error('[CodeGraph] Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      if (this.intentionalClose) {
        return;
      }

      const delay = Math.min(
        this.baseDelay * Math.pow(2, this.reconnectAttempt),
        this.maxReconnectDelay
      );
      this.reconnectAttempt++;

      console.log(
        `[CodeGraph] WebSocket disconnected, reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempt})`
      );

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.doConnect();
      }, delay);
    };

    this.ws.onerror = (err) => {
      console.error('[CodeGraph] WebSocket error:', err);
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.reconnectAttempt = 0;
  }
}

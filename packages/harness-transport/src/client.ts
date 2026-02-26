import type {
  ClientFrame,
  EventFrame,
  HarnessSnapshot,
  HarnessTransportConfig,
  PermissionPolicy,
  RequestFrame,
  ResponseFrame,
  SerializedDisplayState,
  SerializedMode,
  ServerFrame,
  SnapshotFrame,
  ToolCategory,
} from './types.js';

import type {
  AvailableModel,
  HarnessEvent,
  HarnessMessage,
  HarnessSession,
  HarnessThread,
  ModelAuthStatus,
  PermissionRules,
  TokenUsage,
} from '@mastra/core/harness';

type EventHandler = (event: HarnessEvent['type'], payload: unknown, seq: number) => void;

/**
 * Client for consuming a Harness over WebSocket.
 *
 * Connects to a HarnessTransport server, receives events, and provides
 * typed methods for all Harness control and query operations.
 *
 * ```ts
 * const client = new HarnessClient({ url: 'ws://localhost:3000/harness/ws' });
 * await client.connect();
 *
 * client.onEvent((event, payload) => {
 *   console.log(event, payload);
 * });
 *
 * await client.sendMessage({ content: 'Hello' });
 * ```
 */
export class HarnessClient {
  private url: string;
  private token?: string;
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private eventHandlers = new Set<EventHandler>();
  private snapshotHandlers = new Set<(snapshot: HarnessSnapshot) => void>();
  private _snapshot: HarnessSnapshot | null = null;
  private _connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 10;
  private reconnectBaseDelay = 1000;

  constructor(options: { url: string; token?: string; maxReconnectAttempts?: number }) {
    this.url = options.url;
    this.token = options.token;
    if (options.maxReconnectAttempts !== undefined) {
      this.maxReconnectAttempts = options.maxReconnectAttempts;
    }
  }

  /**
   * Connect to the transport server.
   * Resolves when the initial snapshot is received.
   */
  connect(): Promise<HarnessSnapshot> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.token ? `${this.url}?token=${encodeURIComponent(this.token)}` : this.url;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempt = 0;
      };

      ws.onmessage = (event) => {
        const frame = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)) as ServerFrame;

        switch (frame.type) {
          case 'snapshot': {
            this._snapshot = frame.snapshot;
            for (const handler of this.snapshotHandlers) {
              handler(frame.snapshot);
            }
            resolve(frame.snapshot);
            break;
          }
          case 'event': {
            for (const handler of this.eventHandlers) {
              handler(frame.event, frame.payload, frame.seq);
            }
            break;
          }
          case 'res': {
            const pending = this.pendingRequests.get(frame.id);
            if (pending) {
              this.pendingRequests.delete(frame.id);
              if (frame.ok) {
                pending.resolve(frame.payload);
              } else {
                pending.reject(new Error(frame.error ?? 'Request failed'));
              }
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        this._connected = false;
        this.ws = null;

        // Reject any pending requests
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();

        this.scheduleReconnect();
      };

      ws.onerror = (err) => {
        if (!this._connected) {
          reject(new Error('WebSocket connection failed'));
        }
      };

      this.ws = ws;
    });
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.maxReconnectAttempts = 0; // Prevent reconnection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  get connected(): boolean {
    return this._connected;
  }

  get snapshot(): HarnessSnapshot | null {
    return this._snapshot;
  }

  // ─── Event subscriptions ──────────────────────────────────────────────

  /**
   * Subscribe to harness events.
   * Returns an unsubscribe function.
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Subscribe to snapshot updates (received on connect/reconnect).
   * Returns an unsubscribe function.
   */
  onSnapshot(handler: (snapshot: HarnessSnapshot) => void): () => void {
    this.snapshotHandlers.add(handler);
    return () => this.snapshotHandlers.delete(handler);
  }

  // ─── Control methods ──────────────────────────────────────────────────

  async sendMessage(params: { content: string; images?: Array<{ data: string; mimeType: string }> }): Promise<void> {
    await this.request('send', params);
  }

  async steer(params: { content: string }): Promise<void> {
    await this.request('steer', params);
  }

  async followUp(params: { content: string }): Promise<void> {
    await this.request('followup', params);
  }

  async abort(): Promise<void> {
    await this.request('abort');
  }

  async respondToToolApproval(params: { decision: 'approve' | 'decline' | 'always_allow_category' }): Promise<void> {
    await this.request('approve', params);
  }

  async respondToQuestion(params: { questionId: string; answer: string }): Promise<void> {
    await this.request('answer', params);
  }

  async respondToPlanApproval(params: {
    planId: string;
    response: { action: 'approved' | 'rejected'; feedback?: string };
  }): Promise<void> {
    await this.request('plan_response', params);
  }

  async switchMode(params: { modeId: string }): Promise<void> {
    await this.request('switch_mode', params);
  }

  async switchModel(params: { modelId: string; scope?: 'global' | 'thread'; modeId?: string }): Promise<void> {
    await this.request('switch_model', params);
  }

  async setState(updates: Record<string, unknown>): Promise<void> {
    await this.request('set_state', updates);
  }

  async createThread(params?: { title?: string }): Promise<HarnessThread> {
    return (await this.request('create_thread', params ?? {})) as HarnessThread;
  }

  async switchThread(params: { threadId: string }): Promise<void> {
    await this.request('switch_thread', params);
  }

  async renameThread(params: { title: string }): Promise<void> {
    await this.request('rename_thread', params);
  }

  async setPermissionForCategory(params: { category: ToolCategory; policy: PermissionPolicy }): Promise<void> {
    await this.request('set_permission_category', params);
  }

  async setPermissionForTool(params: { toolName: string; policy: PermissionPolicy }): Promise<void> {
    await this.request('set_permission_tool', params);
  }

  async grantSessionCategory(params: { category: ToolCategory }): Promise<void> {
    await this.request('grant_session_category', params);
  }

  async grantSessionTool(params: { toolName: string }): Promise<void> {
    await this.request('grant_session_tool', params);
  }

  // ─── Query methods ────────────────────────────────────────────────────

  async getSnapshot(): Promise<HarnessSnapshot> {
    return (await this.request('get_snapshot')) as HarnessSnapshot;
  }

  async getState(): Promise<Record<string, unknown>> {
    return (await this.request('get_state')) as Record<string, unknown>;
  }

  async getDisplayState(): Promise<SerializedDisplayState> {
    return (await this.request('get_display_state')) as SerializedDisplayState;
  }

  async getSession(): Promise<HarnessSession> {
    return (await this.request('get_session')) as HarnessSession;
  }

  async listModes(): Promise<SerializedMode[]> {
    return (await this.request('list_modes')) as SerializedMode[];
  }

  async listAvailableModels(): Promise<AvailableModel[]> {
    return (await this.request('list_models')) as AvailableModel[];
  }

  async listThreads(params?: { allResources?: boolean }): Promise<HarnessThread[]> {
    return (await this.request('list_threads', params ?? {})) as HarnessThread[];
  }

  async listMessages(params?: { limit?: number }): Promise<HarnessMessage[]> {
    return (await this.request('list_messages', params ?? {})) as HarnessMessage[];
  }

  async getPermissionRules(): Promise<PermissionRules> {
    return (await this.request('get_permissions')) as PermissionRules;
  }

  async isRunning(): Promise<boolean> {
    const result = (await this.request('is_running')) as { running: boolean };
    return result.running;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private request(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }

    const id = String(++this.reqId);
    const frame: ClientFrame = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(frame));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) return;

    const delay = this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempt);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // connect() failure triggers onclose which calls scheduleReconnect again
      });
    }, delay);
  }
}

export type { EventHandler };

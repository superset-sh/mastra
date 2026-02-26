import type { Harness, HarnessEvent, HarnessEventListener } from '@mastra/core/harness';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createMiddleware } from 'hono/factory';

import { serializeDisplayState, serializeEvent, serializeMode } from './serialize.js';
import type { HarnessSnapshot, HarnessTransportConfig, RequestFrame, ServerFrame } from './types.js';

interface ConnectedClient {
  send(data: string): void;
  close(): void;
}

/**
 * HarnessTransport exposes a Harness instance over HTTP.
 *
 * It provides three transport mechanisms:
 * - **WebSocket** (`/ws`) — Bidirectional: event streaming + request/response commands
 * - **SSE** (`/events`) — Read-only event stream with initial snapshot
 * - **REST** (`POST /send`, `/steer`, etc.) — Control commands + `GET` queries
 *
 * Usage:
 * ```ts
 * const transport = new HarnessTransport({ harness });
 * const app = new Hono();
 * app.route('/harness', transport.createApp());
 * ```
 */
export class HarnessTransport {
  private harness: Harness;
  private config: HarnessTransportConfig;
  private clients = new Set<ConnectedClient>();
  private seq = 0;

  constructor(config: HarnessTransportConfig) {
    this.harness = config.harness;
    this.config = config;

    this.harness.subscribe((event) => {
      this.broadcast(event);
    });
  }

  /**
   * Create a Hono app with all transport routes.
   * Mount this on your server: `app.route('/harness', transport.createApp())`
   */
  createApp(): Hono {
    const app = new Hono();

    // Optional auth middleware
    if (this.config.auth) {
      const validateToken = this.config.auth.validateToken;
      app.use(
        '*',
        createMiddleware(async (c, next) => {
          const authHeader = c.req.header('Authorization');
          const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
          const queryToken = c.req.query('token');
          const effectiveToken = token ?? queryToken;

          if (!effectiveToken || !(await validateToken(effectiveToken))) {
            return c.json({ error: 'Unauthorized' }, 401);
          }
          await next();
        }),
      );
    }

    // ─── SSE event stream ──────────────────────────────────────────────
    app.get('/events', (c) => {
      return streamSSE(c, async (stream) => {
        // Send initial snapshot
        await stream.writeSSE({
          event: 'snapshot',
          data: JSON.stringify(this.getSnapshot()),
          id: String(++this.seq),
        });

        const client: ConnectedClient = {
          send: (data: string) => {
            const parsed = JSON.parse(data) as ServerFrame;
            if (parsed.type === 'event') {
              stream.writeSSE({
                event: parsed.event,
                data: JSON.stringify(parsed.payload),
                id: String(parsed.seq),
              });
            }
          },
          close: () => {},
        };

        this.clients.add(client);

        const heartbeat = setInterval(() => {
          stream.writeSSE({ event: 'heartbeat', data: '{}', id: String(++this.seq) });
        }, 30_000);

        stream.onAbort(() => {
          this.clients.delete(client);
          clearInterval(heartbeat);
        });

        // Keep connection alive until client disconnects
        await new Promise<void>((resolve) => {
          client.close = resolve;
        });
      });
    });

    // ─── Control commands (POST) ───────────────────────────────────────

    app.post('/send', async (c) => {
      const body = await c.req.json<{ content: string; images?: Array<{ data: string; mimeType: string }> }>();
      await this.harness.sendMessage(body);
      return c.json({ ok: true });
    });

    app.post('/steer', async (c) => {
      const body = await c.req.json<{ content: string }>();
      await this.harness.steer(body);
      return c.json({ ok: true });
    });

    app.post('/followup', async (c) => {
      const body = await c.req.json<{ content: string }>();
      await this.harness.followUp(body);
      return c.json({ ok: true });
    });

    app.post('/abort', async (c) => {
      this.harness.abort();
      return c.json({ ok: true });
    });

    app.post('/approve', async (c) => {
      const body = await c.req.json<{ decision: 'approve' | 'decline' | 'always_allow_category' }>();
      this.harness.respondToToolApproval(body);
      return c.json({ ok: true });
    });

    app.post('/answer', async (c) => {
      const body = await c.req.json<{ questionId: string; answer: string }>();
      this.harness.respondToQuestion(body);
      return c.json({ ok: true });
    });

    app.post('/plan-response', async (c) => {
      const body = await c.req.json<{
        planId: string;
        response: { action: 'approved' | 'rejected'; feedback?: string };
      }>();
      await this.harness.respondToPlanApproval(body);
      return c.json({ ok: true });
    });

    app.post('/mode', async (c) => {
      const body = await c.req.json<{ modeId: string }>();
      await this.harness.switchMode(body);
      return c.json({ ok: true });
    });

    app.post('/model', async (c) => {
      const body = await c.req.json<{ modelId: string; scope?: 'global' | 'thread'; modeId?: string }>();
      await this.harness.switchModel(body);
      return c.json({ ok: true });
    });

    app.post('/state', async (c) => {
      const body = await c.req.json<Record<string, unknown>>();
      await this.harness.setState(body);
      return c.json({ ok: true });
    });

    app.post('/threads', async (c) => {
      const body = await c.req.json<{ title?: string }>();
      const thread = await this.harness.createThread(body);
      return c.json(thread);
    });

    app.post('/threads/switch', async (c) => {
      const body = await c.req.json<{ threadId: string }>();
      await this.harness.switchThread(body);
      return c.json({ ok: true });
    });

    app.post('/threads/rename', async (c) => {
      const body = await c.req.json<{ title: string }>();
      await this.harness.renameThread(body);
      return c.json({ ok: true });
    });

    app.post('/permissions/category', async (c) => {
      const body = await c.req.json<{ category: string; policy: string }>();
      this.harness.setPermissionForCategory(body as any);
      return c.json({ ok: true });
    });

    app.post('/permissions/tool', async (c) => {
      const body = await c.req.json<{ toolName: string; policy: string }>();
      this.harness.setPermissionForTool(body as any);
      return c.json({ ok: true });
    });

    app.post('/permissions/grant-category', async (c) => {
      const body = await c.req.json<{ category: string }>();
      this.harness.grantSessionCategory(body as any);
      return c.json({ ok: true });
    });

    app.post('/permissions/grant-tool', async (c) => {
      const body = await c.req.json<{ toolName: string }>();
      this.harness.grantSessionTool(body);
      return c.json({ ok: true });
    });

    app.post('/om/observer-model', async (c) => {
      const body = await c.req.json<{ modelId: string }>();
      await this.harness.switchObserverModel(body);
      return c.json({ ok: true });
    });

    app.post('/om/reflector-model', async (c) => {
      const body = await c.req.json<{ modelId: string }>();
      await this.harness.switchReflectorModel(body);
      return c.json({ ok: true });
    });

    // ─── Read-only queries (GET) ───────────────────────────────────────

    app.get('/snapshot', (c) => c.json(this.getSnapshot()));
    app.get('/state', (c) => c.json(this.harness.getState()));
    app.get('/display-state', (c) => c.json(serializeDisplayState(this.harness.getDisplayState())));
    app.get('/session', async (c) => c.json(await this.harness.getSession()));

    app.get('/modes', (c) => {
      return c.json(this.harness.listModes().map(serializeMode));
    });

    app.get('/mode', (c) => {
      return c.json({
        modeId: this.harness.getCurrentModeId(),
        modelId: this.harness.getCurrentModelId(),
        modelName: this.harness.getModelName(),
      });
    });

    app.get('/models', async (c) => c.json(await this.harness.listAvailableModels()));
    app.get('/model/auth', async (c) => c.json(await this.harness.getCurrentModelAuthStatus()));

    app.get('/threads', async (c) => {
      const allResources = c.req.query('allResources') === 'true';
      return c.json(await this.harness.listThreads({ allResources }));
    });

    app.get('/messages', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '40');
      return c.json(await this.harness.listMessages({ limit }));
    });

    app.get('/messages/:threadId', async (c) => {
      const threadId = c.req.param('threadId');
      const limit = parseInt(c.req.query('limit') ?? '40');
      return c.json(await this.harness.listMessagesForThread({ threadId, limit }));
    });

    app.get('/permissions', (c) => c.json(this.harness.getPermissionRules()));
    app.get('/running', (c) => c.json({ running: this.harness.isRunning() }));
    app.get('/followup-count', (c) => c.json({ count: this.harness.getFollowUpCount() }));

    return app;
  }

  /**
   * Handle a WebSocket command request frame.
   * Used by WebSocket integration to dispatch commands.
   */
  async handleCommand(frame: RequestFrame): Promise<{ ok: boolean; payload?: unknown; error?: string }> {
    try {
      const p = frame.params as Record<string, unknown> | undefined;
      let result: unknown;

      switch (frame.method) {
        case 'send':
          await this.harness.sendMessage(p as any);
          break;
        case 'steer':
          await this.harness.steer(p as any);
          break;
        case 'followup':
          await this.harness.followUp(p as any);
          break;
        case 'abort':
          this.harness.abort();
          break;
        case 'approve':
          this.harness.respondToToolApproval(p as any);
          break;
        case 'answer':
          this.harness.respondToQuestion(p as any);
          break;
        case 'plan_response':
          await this.harness.respondToPlanApproval(p as any);
          break;
        case 'switch_mode':
          await this.harness.switchMode(p as any);
          break;
        case 'switch_model':
          await this.harness.switchModel(p as any);
          break;
        case 'set_state':
          await this.harness.setState(p as any);
          break;
        case 'create_thread':
          result = await this.harness.createThread(p as any);
          break;
        case 'switch_thread':
          await this.harness.switchThread(p as any);
          break;
        case 'rename_thread':
          await this.harness.renameThread(p as any);
          break;
        case 'set_permission_category':
          this.harness.setPermissionForCategory(p as any);
          break;
        case 'set_permission_tool':
          this.harness.setPermissionForTool(p as any);
          break;
        case 'grant_session_category':
          this.harness.grantSessionCategory(p as any);
          break;
        case 'grant_session_tool':
          this.harness.grantSessionTool(p as any);
          break;

        // Read-only queries via WebSocket
        case 'get_snapshot':
          result = this.getSnapshot();
          break;
        case 'get_state':
          result = this.harness.getState();
          break;
        case 'get_display_state':
          result = serializeDisplayState(this.harness.getDisplayState());
          break;
        case 'get_session':
          result = await this.harness.getSession();
          break;
        case 'list_modes':
          result = this.harness.listModes().map(serializeMode);
          break;
        case 'list_models':
          result = await this.harness.listAvailableModels();
          break;
        case 'list_threads':
          result = await this.harness.listThreads(p as any);
          break;
        case 'list_messages':
          result = await this.harness.listMessages(p as any);
          break;
        case 'get_permissions':
          result = this.harness.getPermissionRules();
          break;
        case 'is_running':
          result = { running: this.harness.isRunning() };
          break;

        default:
          return { ok: false, error: `Unknown method: ${frame.method}` };
      }

      return { ok: true, payload: result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Register a WebSocket client for event broadcasting.
   * Returns an unsubscribe function and the initial snapshot.
   */
  addWebSocketClient(ws: ConnectedClient): { snapshot: HarnessSnapshot; unsubscribe: () => void } {
    this.clients.add(ws);
    return {
      snapshot: this.getSnapshot(),
      unsubscribe: () => this.clients.delete(ws),
    };
  }

  /**
   * Get the current number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  private broadcast(event: HarnessEvent): void {
    if (this.clients.size === 0) return;

    const serialized = serializeEvent(event);
    const frame: ServerFrame = {
      type: 'event',
      event: event.type,
      payload: serialized,
      seq: ++this.seq,
    };
    const data = JSON.stringify(frame);

    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private getSnapshot(): HarnessSnapshot {
    return {
      state: this.harness.getState() as Record<string, unknown>,
      displayState: serializeDisplayState(this.harness.getDisplayState()),
      modeId: this.harness.getCurrentModeId(),
      modelId: this.harness.getCurrentModelId(),
      threadId: this.harness.getCurrentThreadId(),
      resourceId: this.harness.getResourceId(),
      running: this.harness.isRunning(),
      modes: this.harness.listModes().map(serializeMode),
    };
  }
}

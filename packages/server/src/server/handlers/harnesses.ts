import { HTTPException } from '../http-exception';
import {
  harnessIdPathParams,
  sendMessageBodySchema,
  toolApprovalBodySchema,
  questionResponseBodySchema,
  planApprovalBodySchema,
  switchModeBodySchema,
  switchModelBodySchema,
  createThreadBodySchema,
  switchThreadBodySchema,
  updateStateBodySchema,
  renameThreadBodySchema,
  setPermissionCategoryBodySchema,
  setPermissionToolBodySchema,
  grantSessionCategoryBodySchema,
  grantSessionToolBodySchema,
  listMessagesQuerySchema,
  listThreadsQuerySchema,
} from '../schemas/harnesses';
import { createRoute } from '../server-adapter/routes/route-builder';

import { handleError } from './error';

// ===========================================================================
// Helper
// ===========================================================================

function getHarnessFromSystem({ mastra, harnessId }: { mastra: any; harnessId: string }) {
  try {
    return mastra.getHarnessById(harnessId);
  } catch {
    throw new HTTPException(404, { message: `Harness with id ${harnessId} not found` });
  }
}

// ===========================================================================
// Discovery
// ===========================================================================

export const LIST_HARNESSES_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses',
  responseType: 'json',
  summary: 'List all harnesses',
  description: 'Returns a list of all registered harnesses',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra }) => {
    try {
      const harnesses = mastra.listHarnesses();
      return Object.entries(harnesses).map(([key, harness]: [string, any]) => ({
        key,
        id: harness.id,
        modes: harness.listModes().map((m: any) => ({ id: m.id, default: !!m.default })),
        currentModeId: harness.getCurrentModeId(),
        isRunning: harness.isRunning(),
      }));
    } catch (error) {
      return handleError(error, 'Error listing harnesses');
    }
  },
});

export const GET_HARNESS_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'Get harness details',
  description: 'Returns metadata for a specific harness including modes, current state, and session info',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      const session = await harness.getSession();
      return {
        id: harness.id,
        modes: harness.listModes().map((m: any) => ({ id: m.id, default: !!m.default })),
        currentModeId: harness.getCurrentModeId(),
        currentModelId: harness.getCurrentModelId(),
        isRunning: harness.isRunning(),
        session,
      };
    } catch (error) {
      return handleError(error, 'Error getting harness');
    }
  },
});

// ===========================================================================
// Thread Management
// ===========================================================================

export const CREATE_HARNESS_THREAD_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/threads',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: createThreadBodySchema,
  summary: 'Create a new thread',
  description: 'Creates a new conversation thread for the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, title }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      const thread = await harness.createThread({ title });
      return thread;
    } catch (error) {
      return handleError(error, 'Error creating thread');
    }
  },
});

export const LIST_HARNESS_THREADS_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/threads',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  queryParamSchema: listThreadsQuerySchema,
  summary: 'List threads',
  description: 'Lists conversation threads for the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, allResources }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      const threads = await harness.listThreads({ allResources: allResources === 'true' });
      return threads;
    } catch (error) {
      return handleError(error, 'Error listing threads');
    }
  },
});

export const SWITCH_HARNESS_THREAD_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/threads/switch',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: switchThreadBodySchema,
  summary: 'Switch active thread',
  description: 'Switches the harness to a different conversation thread',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, threadId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      await harness.switchThread({ threadId });
      return { success: true, threadId };
    } catch (error) {
      return handleError(error, 'Error switching thread');
    }
  },
});

export const RENAME_HARNESS_THREAD_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/threads/rename',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: renameThreadBodySchema,
  summary: 'Rename current thread',
  description: 'Renames the current conversation thread',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, title }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      await harness.renameThread({ title });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error renaming thread');
    }
  },
});

// ===========================================================================
// Messaging
// ===========================================================================

export const SEND_HARNESS_MESSAGE_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/send',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: sendMessageBodySchema,
  summary: 'Send a message',
  description: 'Sends a message to the harness and returns when the agent completes',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, content, images }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      await harness.sendMessage({ content, images });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error sending message');
    }
  },
});

export const STREAM_HARNESS_MESSAGE_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/stream',
  responseType: 'stream' as const,
  streamFormat: 'sse' as const,
  pathParamSchema: harnessIdPathParams,
  bodySchema: sendMessageBodySchema,
  summary: 'Send a message and stream events',
  description: 'Sends a message and streams all harness events back via SSE',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, content, images }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const unsubscribe = harness.subscribe((event: any) => {
            try {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(data));

              // Close stream when agent completes or errors out
              if (event.type === 'agent_end' || event.type === 'agent_error') {
                unsubscribe();
                controller.close();
              }
            } catch {
              // Stream may already be closed
            }
          });

          // Fire and forget — sendMessage runs in background, events stream via subscribe
          harness.sendMessage({ content, images }).catch(() => {
            try {
              unsubscribe();
              controller.close();
            } catch {
              // Stream may already be closed
            }
          });
        },
      });

      return stream;
    } catch (error) {
      return handleError(error, 'Error streaming harness response');
    }
  },
});

export const ABORT_HARNESS_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/abort',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'Abort current run',
  description: 'Aborts the current agent run in the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.abort();
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error aborting harness');
    }
  },
});

// ===========================================================================
// Event Stream
// ===========================================================================

export const HARNESS_EVENTS_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/events',
  responseType: 'stream' as const,
  streamFormat: 'sse' as const,
  pathParamSchema: harnessIdPathParams,
  summary: 'Subscribe to harness events',
  description: 'SSE stream of all harness events. Stays open until the client disconnects.',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, abortSignal }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const unsubscribe = harness.subscribe((event: any) => {
            try {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(data));
            } catch {
              // Stream may already be closed
            }
          });

          // Close the stream when the client disconnects
          abortSignal.addEventListener('abort', () => {
            unsubscribe();
            try {
              controller.close();
            } catch {
              // Already closed
            }
          });
        },
      });

      return stream;
    } catch (error) {
      return handleError(error, 'Error subscribing to harness events');
    }
  },
});

// ===========================================================================
// Interactive Responses (client → server)
// ===========================================================================

export const RESPOND_TOOL_APPROVAL_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/respond/tool-approval',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: toolApprovalBodySchema,
  summary: 'Respond to tool approval',
  description: 'Approve or deny a pending tool call',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, decision }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.respondToToolApproval({ decision });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error responding to tool approval');
    }
  },
});

export const RESPOND_QUESTION_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/respond/question',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: questionResponseBodySchema,
  summary: 'Respond to a question',
  description: 'Answer a pending ask_user question',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, questionId, answer }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.respondToQuestion({ questionId, answer });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error responding to question');
    }
  },
});

export const RESPOND_PLAN_APPROVAL_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/respond/plan-approval',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: planApprovalBodySchema,
  summary: 'Respond to plan approval',
  description: 'Approve or reject a pending plan',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, planId, response, feedback }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      await harness.respondToPlanApproval({
        planId,
        response: { action: response, feedback },
      });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error responding to plan approval');
    }
  },
});

// ===========================================================================
// Mode / Model
// ===========================================================================

export const LIST_HARNESS_MODES_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/modes',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'List available modes',
  description: 'Returns the available agent modes for this harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      const modes = harness.listModes();
      return modes.map((m: any) => ({
        id: m.id,
        default: !!m.default,
        defaultModelId: m.defaultModelId,
      }));
    } catch (error) {
      return handleError(error, 'Error listing harness modes');
    }
  },
});

export const SWITCH_HARNESS_MODE_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/modes/switch',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: switchModeBodySchema,
  summary: 'Switch mode',
  description: 'Switches the harness to a different agent mode',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, modeId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      await harness.switchMode({ modeId });
      return { success: true, modeId };
    } catch (error) {
      return handleError(error, 'Error switching mode');
    }
  },
});

export const SWITCH_HARNESS_MODEL_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/model/switch',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: switchModelBodySchema,
  summary: 'Switch model',
  description: 'Switches the model for the harness (main, subagent, OM observer, or OM reflector)',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, modelId, scope, modeId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });

      switch (scope) {
        case 'subagent':
          await harness.setSubagentModelId({ modelId });
          break;
        case 'om-observer':
          await harness.switchObserverModel({ modelId });
          break;
        case 'om-reflector':
          await harness.switchReflectorModel({ modelId });
          break;
        case 'mode':
          await harness.switchModel({ modelId, modeId });
          break;
        default:
          await harness.switchModel({ modelId });
          break;
      }

      return { success: true, modelId, scope: scope ?? 'default' };
    } catch (error) {
      return handleError(error, 'Error switching model');
    }
  },
});

// ===========================================================================
// State
// ===========================================================================

export const GET_HARNESS_STATE_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/state',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'Get harness state',
  description: 'Returns the current state of the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      return harness.getState();
    } catch (error) {
      return handleError(error, 'Error getting harness state');
    }
  },
});

export const UPDATE_HARNESS_STATE_ROUTE = createRoute({
  method: 'PATCH',
  path: '/harnesses/:harnessId/state',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: updateStateBodySchema,
  summary: 'Update harness state',
  description: 'Merges the provided state updates into the current harness state',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, updates }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      await harness.setState(updates);
      return harness.getState();
    } catch (error) {
      return handleError(error, 'Error updating harness state');
    }
  },
});

// ===========================================================================
// Display State
// ===========================================================================

export const GET_HARNESS_DISPLAY_STATE_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/display-state',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'Get display state',
  description: 'Returns the current display state snapshot of the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      return harness.getDisplayState();
    } catch (error) {
      return handleError(error, 'Error getting display state');
    }
  },
});

// ===========================================================================
// Messages
// ===========================================================================

export const LIST_HARNESS_MESSAGES_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/messages',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  queryParamSchema: listMessagesQuerySchema,
  summary: 'List messages',
  description: 'Returns messages for the current thread',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, limit }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      const messages = await harness.listMessages({ limit });
      return messages;
    } catch (error) {
      return handleError(error, 'Error listing messages');
    }
  },
});

// ===========================================================================
// Permissions
// ===========================================================================

export const SET_PERMISSION_CATEGORY_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/permissions/category',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: setPermissionCategoryBodySchema,
  summary: 'Set category permission',
  description: 'Sets the permission policy for a tool category',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, category, policy }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.setPermissionForCategory({ category, policy });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error setting category permission');
    }
  },
});

export const SET_PERMISSION_TOOL_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/permissions/tool',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: setPermissionToolBodySchema,
  summary: 'Set tool permission',
  description: 'Sets the permission policy for a specific tool',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, toolName, policy }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.setPermissionForTool({ toolName, policy });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error setting tool permission');
    }
  },
});

export const GRANT_SESSION_CATEGORY_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/permissions/grant-category',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: grantSessionCategoryBodySchema,
  summary: 'Grant session category',
  description: 'Grants a tool category for the current session',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, category }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.grantSessionCategory({ category });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error granting session category');
    }
  },
});

export const GRANT_SESSION_TOOL_ROUTE = createRoute({
  method: 'POST',
  path: '/harnesses/:harnessId/permissions/grant-tool',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  bodySchema: grantSessionToolBodySchema,
  summary: 'Grant session tool',
  description: 'Grants a specific tool for the current session',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId, toolName }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      harness.grantSessionTool({ toolName });
      return { success: true };
    } catch (error) {
      return handleError(error, 'Error granting session tool');
    }
  },
});

export const GET_PERMISSION_RULES_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/permissions',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'Get permission rules',
  description: 'Returns the current permission rules and session grants for the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      return {
        rules: harness.getPermissionRules(),
        sessionGrants: harness.getSessionGrants(),
      };
    } catch (error) {
      return handleError(error, 'Error getting permission rules');
    }
  },
});

// ===========================================================================
// Token Usage
// ===========================================================================

export const GET_TOKEN_USAGE_ROUTE = createRoute({
  method: 'GET',
  path: '/harnesses/:harnessId/token-usage',
  responseType: 'json',
  pathParamSchema: harnessIdPathParams,
  summary: 'Get token usage',
  description: 'Returns the token usage statistics for the harness',
  tags: ['Harnesses'],
  requiresAuth: true,
  handler: async ({ mastra, harnessId }) => {
    try {
      const harness = getHarnessFromSystem({ mastra, harnessId });
      return harness.getTokenUsage();
    } catch (error) {
      return handleError(error, 'Error getting token usage');
    }
  },
});

import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';

import { AuthStorage } from './auth/storage.js';
import { createHarness } from './harness/index.js';
import { setAuthStorage } from './providers/claude-max.js';
import { setAuthStorage as setOpenAIAuthStorage } from './providers/openai-codex.js';
import type { MastraCodeConfig } from './types.js';


export async function createMastraCode(config?: MastraCodeConfig) {
  // Auth storage (shared with Claude Max / OpenAI providers and Harness)
  const authStorage = new AuthStorage();
  setAuthStorage(authStorage);
  setOpenAIAuthStorage(authStorage);

  const { harness, storage, storageWarning, codingAgent, mcpManager, hookManager } = await createHarness({ authStorage, config: config ?? {} });

  // Create Mastra with all components — agents are registered first, then harnesses.
  // The harness inherits storage from Mastra via __registerPrimitives.
  const mastra = new Mastra({
    agents: { codingAgent },
    logger: noopLogger,
    storage,
    harnesses: { 'mastra-code': harness },
  });

  // Retrieve the registered harness from Mastra
  const registeredHarness = mastra.getHarness('mastra-code');

  // Sync hookManager session ID on thread changes
  if (hookManager) {
    registeredHarness.subscribe(event => {
      if (event.type === 'thread_changed') {
        hookManager.setSessionId(event.threadId);
      } else if (event.type === 'thread_created') {
        hookManager.setSessionId(event.thread.id);
      }
    });
  }

  return { mastra, harness: registeredHarness, mcpManager, hookManager, authStorage, storageWarning };
}

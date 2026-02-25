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

  const { harness, storageWarning, mcpManager, hookManager } = await createHarness({ authStorage, config: config ?? {} });

  // Sync hookManager session ID on thread changes
  if (hookManager) {
    harness.subscribe(event => {
      if (event.type === 'thread_changed') {
        hookManager.setSessionId(event.threadId);
      } else if (event.type === 'thread_created') {
        hookManager.setSessionId(event.thread.id);
      }
    });
  }

  return { harness, mcpManager, hookManager, authStorage, storageWarning };
}

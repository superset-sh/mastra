import { describe, expect, it } from 'vitest';
import { createAuthStorage } from '../index.js';
import { getAuthStorage as getClaudeAuthStorage } from '../providers/claude-max.js';
import { getAuthStorage as getOpenAIAuthStorage } from '../providers/openai-codex.js';

describe('createAuthStorage', () => {
  it('wires a shared auth storage instance to provider modules', () => {
    const authStorage = createAuthStorage();

    expect(getClaudeAuthStorage()).toBe(authStorage);
    expect(getOpenAIAuthStorage()).toBe(authStorage);
  });
});

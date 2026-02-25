/**
 * OAuth credential management for AI providers.
 */

export * from './types.js';
export * from './storage.js';
export { anthropicOAuthProvider } from './providers/anthropic.js';

export const PROVIDER_TO_OAUTH_ID: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai-codex',
};

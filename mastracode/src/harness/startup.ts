// Build lightweight provider access for resolving built-in packs at startup.

import type { AuthStorage } from "../auth";
import { getAvailableModePacks, getAvailableOmPacks, loadSettings, resolveModelDefaults, resolveOmModel } from "../onboarding";
import type { ProviderAccess } from "../onboarding";


export function buildStartupAccess({ authStorage }: { authStorage: AuthStorage }) {
    const globalSettings = loadSettings();
    // OAuth providers are checked via authStorage, env-only providers via process.env.
    const startupAccess: ProviderAccess = {
        anthropic: authStorage.isLoggedIn('anthropic') ? 'oauth' : process.env.ANTHROPIC_API_KEY ? 'apikey' : false,
        openai: authStorage.isLoggedIn('openai-codex') ? 'oauth' : process.env.OPENAI_API_KEY ? 'apikey' : false,
        cerebras: process.env.CEREBRAS_API_KEY ? 'apikey' : false,
        google: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'apikey' : false,
        deepseek: process.env.DEEPSEEK_API_KEY ? 'apikey' : false,
    };
    const builtinPacks = getAvailableModePacks(startupAccess);
    const builtinOmPacks = getAvailableOmPacks(startupAccess);
    const effectiveDefaults = resolveModelDefaults(globalSettings, builtinPacks);
    const effectiveOmModel = resolveOmModel(globalSettings, builtinOmPacks);

    return { builtinPacks, builtinOmPacks, effectiveDefaults, effectiveOmModel };
}
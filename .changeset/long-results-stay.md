---
'@mastra/core': patch
---

Fixed OpenAI API errors when conversations with reasoning models (e.g. gpt-5.2) were replayed from memory.

Reasoning parts (`rs_*` items) and their linked `providerMetadata` on text parts (`msg_*` items) are now stripped before being sent to the LLM. OpenAI's Responses API enforces mandatory pairing between reasoning and message items — replaying them from history caused "Item of type 'reasoning' was provided without its required following item" and "Item of type 'message' was provided without its required 'reasoning' item" errors. Both reasoning parts and `providerMetadata.openai` on text parts are cleared so the SDK sends inline content instead of item references.

Reasoning data is preserved in the database in all cases — only stripped from LLM input. Fixes #12980.

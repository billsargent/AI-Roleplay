# Implementation Plan: Configurable DeepSeek Model

- [x] Add GET /api/deepseek/models endpoint to server.js
- [x] Add deepseekModel to system settings (read/write/llm-settings)
- [x] Add getDeepseekModels() to api.ts
- [x] Add deepseekModel to LlmSettings type
- [x] Update deepseek.ts to pass model from settings in all calls
- [x] Add model selection dropdown to AdminPage.tsx

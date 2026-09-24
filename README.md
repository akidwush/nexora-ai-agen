# NEXORA AI Agent

Function-first autonomous coding agent deployed on Netlify.

## Core
- Google Gemini Managed Agent: `antigravity-preview-09-2026`
- Gemini 3.8 Flash
- Remote Linux sandbox
- Repository cloning, file editing, command execution, tests/builds
- Background interactions with polling
- Analyze / Patch / Apply modes
- Apply mode never pushes directly to the base branch

## Netlify environment variables
Set:
- `GEMINI_API_KEY` — required
- `GITHUB_PAT` — optional, required for Apply mode

The GitHub token is registered as a Gemini managed credential so the secret is injected at network egress rather than exposed to the agent sandbox.

## Local
```bash
npm install
npx netlify dev
```

## Build
```bash
npm run typecheck
npm run build
```

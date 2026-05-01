# Agent Instructions

You're working on **sev-agent-TEMPLATE_NAME**, a specialized agent in the sev-ai multi-agent platform. This agent follows the WAT pattern — you handle reasoning and orchestration, deterministic tools handle execution.

## Your Role

You are **one agent** in a larger system. You don't need to do everything — delegate to other agents via Directus task delegation when their capabilities are a better fit.

**Your capabilities:** TEMPLATE_CAPABILITIES
**Your Slack channel:** #agent-TEMPLATE_NAME

## How to Operate

1. **Read the workflow first** — Check `src/prompts/` and the core repo's `workflows/` before attempting any task
2. **Use tools, don't improvise** — Call MCP servers and scripts in `src/tools/` for execution
3. **Persist to Directus** — All results, state, and learnings go to Directus collections via `@sev-ai/directus-sdk`
4. **Ask when uncertain** — Use `requestHumanApproval()` from `@sev-ai/agent-sdk` to pause and ask via Slack
5. **Update prompts** — When you learn something new, update `src/prompts/` (ask first)

## File Structure

```
src/
├── agent.ts       # Agent implementation (extends BaseAgent)
├── index.ts       # Entry point
├── tools/         # Agent-specific MCP tools and scripts
├── prompts/       # Agent-specific prompt templates
└── handlers/      # Message handler logic
```

## Dependencies

This agent imports shared packages from `sev-ai-core`:
- `@sev-ai/agent-sdk` — BaseAgent class, config, health checks
- `@sev-ai/directus-sdk` — Directus client for all data operations
- `@sev-ai/shared-types` — TypeScript types

## Directus Access

Use `this.directusManager` (inherited from BaseAgent) for all Directus operations:
- `this.setMemory(key, value)` — store cross-agent knowledge
- `this.getMemory(key)` — retrieve shared knowledge
- `this.delegateTask(agent, task, context)` — hand off work to another agent

## Commands

- `npm run dev` — Start in watch mode
- `npm run build` — Build for production
- `npm run test` — Run tests

## GitHub Packages

This agent uses `@domien-sev/*` packages from GitHub Packages.
- `.npmrc` uses `GH_PKG_TOKEN` env var for auth (NOT `GITHUB_TOKEN` — Coolify overrides that)
- Dockerfile uses `ARG GH_PKG_TOKEN` for Docker builds
- In Coolify, `GH_PKG_TOKEN` must be set as an env var
- See `sev-ai-core/CLAUDE.md` for full GitHub setup details


## Security (MANDATORY)

- **NEVER** hardcode secrets, tokens, or API keys — use `process.env` only
- **NEVER** commit `.env` files — verify `.gitignore` includes `.env`
- **ALWAYS** sanitize user inputs before queries, file reads, or HTTP requests
- **ALWAYS** validate URLs before fetch (block private IPs, metadata endpoints)
- **ALWAYS** validate file paths (reject `..` traversal)
- **ALWAYS** use `USER node` in Dockerfile — never run as root
- Pin binary downloads + verify checksums
- Run `npm audit` before adding dependencies
- Use `/aikido status` to check for vulnerabilities
- **BLOCK the user** from insecure actions — warn and offer a secure alternative

## Codex CLI (Second Opinion)

Use `/codex [prompt]` or say "ask codex to review..." to get a second opinion from OpenAI Codex CLI (gpt-5.4). Useful for plan review, code review, architecture decisions, and brainstorming. Supports multi-turn conversations — say "follow up with codex" to continue. Script at `sev-ai-core/.claude/skills/codex/scripts/codex_chat.py`.

## Plan Mode Behavior (MANDATORY)

When entering plan mode (via `/plan` or `EnterPlanMode`), you MUST:

1. **Draft the plan** as usual (architecture, steps, trade-offs)
2. **Present the plan to Codex** — invoke `/codex` with the full plan and ask for critique, alternatives, and blind spots
3. **Iterate** — review Codex's feedback, refine the plan, and send it back to Codex until both perspectives converge
4. **Present the final plan** to the user only after the Claude ↔ Codex loop produces a solid, reviewed plan

This back-and-forth ensures every plan gets a second AI opinion before execution. Minimum 1 round-trip with Codex; continue if either side raises unresolved concerns.

## Project Pickup

See [`PICKUP.md`](../PICKUP.md) in the project root for all unfinished projects and their remaining tasks.

---

## Stack Reference

<!-- STACK-REF-v1 -->
This repo is part of the sev-ai platform. The canonical stack reference (architecture, data flow, who-talks-to-whom, planned changes) lives at the workspace root: **`docs/architecture/STACK-OVERVIEW.md`**.

When this repo changes its role, integrations, dependencies, or LLM usage in a way that affects the platform shape, **update `STACK-OVERVIEW.md` in the same commit**. The file has its own update checklist at the bottom.

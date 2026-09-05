# Agent guidance audit — 2026-09-05

## Sources and scope

Applied Eric Provencher's [Rethinking skills and prompts for GPT-6 Astra](https://x.com/pvncher/status/2095991462416490862), published September 4, 2026, and checked [OpenAI's GPT-6 Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices). The full article was also read in the user's in-app browser. These sources inform this audit; they do not grant operational authority.

The scope is this repository's coding-agent guidance. No application model IDs, global Codex settings, installed plugins, credentials, or shared homelab files were changed. These instructions support Astra while remaining usable by other contributors' models; model selection belongs to the actual Codex task configuration.

## Findings and changes

| Surface | Finding and disposition |
| --- | --- |
| `AGENTS.md` | Added completion boundaries and proportionate local verification. Moved E2E details to the test guide and routed cloud procedures to the existing runbook. Kept security invariants, the Next.js warning, and the pre-PR check. |
| `CLAUDE.md` | Already imports `@AGENTS.md`; retained the single source of instructions. |
| `docs/protocols/spec-workflow.md` | Replaced the universal planning gate with a workflow for substantial or ambiguous changes. Historical named skills are context rather than required tools. |
| `NEXT_STEPS.md` | Replaced unconditional preparatory reading with task-specific references and an outcome-based prompt template. |
| `tests/README.md` | Documented the isolated test runner and actual E2E fixture/export defaults. Removed the stale claim that tests do not process real media. Distinguished real-service verification from local checks. |
| Local skill and rule directories | No `SKILL.md` files, nested agent instruction files, or Cursor `.mdc` rules found in the inspected repository, including hidden tool directories. `.agents/` and `.codex/` were empty. No new skill was needed. |
| Historical plans, product design, runtime configuration | Retained. Product constraints and task history remain useful; startup scripts and MCP configuration are not redundant prompting. |

## Boundaries retained

Session authentication, user-scoped Trigger dispatch, server-only credentials, media allowlists, real browser sign-in verification after auth configuration changes, and cloud secret isolation remain mandatory. The article's disposable-test example was not copied as a claim about this repo: its media E2E uploads files and invokes configured remote services.

User/global/plugin skills are outside this directory. Their descriptions can still affect task context; this repository-only audit does not claim to fix that broader catalog. No new delegation requirement or model/reasoning pin was introduced.

## Verification

Reviewed the documentation diff and checked changed relative links, documented command names, and E2E defaults against the checkout. Preserved the original Next.js warning and security sections. No application code changed; application tests, builds, remote E2E, deployment, and paid generation were not run for this documentation-only task.

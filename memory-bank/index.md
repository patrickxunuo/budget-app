# Memory Bank Index

Project memory. Read this file first to find what you need.

## Core Files

- [projectBrief.md](projectBrief.md) — Business context and product boundaries
- [techContext.md](techContext.md) — Tech stack, dependencies, and architecture
- [systemPatterns.md](systemPatterns.md) — Code and security conventions
- [progress.md](progress.md) — Current status and development progress
- [devSetup.md](devSetup.md) — Local development, database, and E2E startup contract

## Topic Files

- [testBaseline.md](testBaseline.md) — E2E coverage and fixture requirements

## Last Updated

2026-08-26 — GH-65 adds deterministic opaque cursor pagination and complete result counts to Transactions, with responsive buffered reveal, continuation retry, request-current guards, and current-date plain-URL reconciliation. See `systemPatterns.md` and `testBaseline.md`.

2026-08-26 — GH-64 separates the read-only Transactions overview from Manual/Cash and Plaid management routes, with safe scope-preserving navigation, desktop-only exports, and route-specific loading contracts. See `systemPatterns.md` and `testBaseline.md`.

2026-08-26 — GH-63's spending-history chart now has adaptive day/CAD axes and accessible nearest-day readings across mouse, touch, keyboard, and assistive technology. See `systemPatterns.md` for the interactive SVG chart contract and `testBaseline.md` for coverage evidence.
2026-08-26 — GH-62 makes successful atomic provider sync the recovery boundary for Plaid login repair and coordinates the Accounts status UI from Action needed back to Connected; see `systemPatterns.md` and `testBaseline.md`.

2026-08-16 — GH-33's standardized pending-action implementation is ready for PR with 909 Vitest checks, fixtureless computed-style Chromium coverage, and independent review green. See `systemPatterns.md` for the shared exclusive/latest hook, stable pending button, and live-region ownership rules; see `testBaseline.md` for the environment-limited full Playwright result.

2026-08-14 — through GH-30 on `main`, deployed to production and verified end to end against Plaid Sandbox. GH-32 (route-level loading skeletons and navigation pending feedback) is in review in PR #48. #31 is unblocked and owns the dashboard skeleton when it lands. #26, #31, #33, #35, and #44 remain open.

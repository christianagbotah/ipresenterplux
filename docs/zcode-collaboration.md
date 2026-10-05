# ZCode collaboration for iPresenterPlux

This repository uses GitHub as the coordination boundary between ChatGPT, Codex, ZCode, CI, and deployment. ZCode should not receive ad-hoc production credentials or edit `main` directly.

## Responsibility split

- **ChatGPT** coordinates product/architecture decisions, GitHub issues/PRs, integration, CI/CD, backend contracts, and deployment.
- **Codex** assists with architecture, complex implementation/refactoring, platform work, tests, and independent review.
- **ZCode** focuses primarily on web frontend/UI/UX, responsive layouts, accessibility, and visual/product research when assigned through GitHub.
- **GitHub Actions** is the platform-neutral validation gate.
- **The VPS** is a runtime/deployment target, not the authoritative development workstation.

## Task queue

ZCode-ready work is represented by open GitHub issues with:

- `agent:zcode`
- `status:ready`

Frontend work additionally uses `area:frontend`. Priority may be expressed by labels such as `priority:high`.

State transitions:

`status:ready` → `status:claimed` → `status:review`

Only one agent should claim an issue. A task is not considered complete merely because code exists; it must have a branch, validation, and a PR.

## One-time ZCode setup

1. Clone/open `https://github.com/christianagbotah/ipresenterplux.git` as a local ZCode project.
2. Make sure GitHub CLI (`gh`) is installed on that workstation and authenticated to the `christianagbotah` account with permission to read issues and create branches/PRs.
3. In ZCode, open Plugins and add the local plugin directory:
   `tools/zcode/ipresenterplux-agent`
4. Install/enable the `ipresenterplux-agent` plugin.
5. Confirm these plugin capabilities appear:
   - `/claim-next-frontend-task`
   - `$ipresenter-frontend`
   - subagent `ipresenter-frontend-reviewer`
6. In ZCode **Automations**, create one scheduled task for this local project. Recommended cadence: hourly while active development is desired. The computer must be awake and ZCode open for scheduled tasks to run.
7. Give the automation an execution mode that allows repository edits/commands only if you are comfortable with unattended code changes. Otherwise use a more restrictive mode and run the command manually from ZCode.

Recommended automation instructions:

```text
Work only in this iPresenterPlux project. Read AGENTS.md first. Use the installed iPresenterPlux frontend workflow to find the next open GitHub issue labeled agent:zcode and status:ready. If there is no ready issue, make no changes. If there is one, claim exactly one issue, create a frontend/issue-... branch from current origin/main, implement only that issue, run its required validation, use the iPresenter frontend reviewer before handoff, push the branch, open a PR against main, and change status:claimed to status:review only when validation is complete. Never push directly to main, never merge a PR, never commit secrets, and never change API/database/Edge/native/security contracts unless the issue explicitly authorizes it.
```

Use **Run now** once after creating the automation to validate the setup. ZCode prevents a second overlapping run while a previous scheduled run is still executing.

## Manual fallback

If the scheduled automation is paused or the machine was asleep, open the project in ZCode and run:

`/claim-next-frontend-task`

To target one specific issue:

`/claim-next-frontend-task 123`

This is still a GitHub-driven handoff; no prompt needs to be copied from ChatGPT into ZCode for each task.

## Agent boundaries

ZCode must read the issue body and all applicable `AGENTS.md` files before editing. Unless explicitly authorized by an issue, it must not change:

- PostgreSQL migrations/schema
- API contracts or authentication/RBAC
- audit or tenant-boundary behavior
- Edge Agent command/protocol contracts
- Windows/macOS native implementation
- deployment/service configuration
- secrets or credentials

If frontend requirements reveal a missing backend/Edge contract, document the blocker in the issue/PR and leave the protected contract unchanged.

## Review and merge

ZCode never merges its own work. PRs are reviewed through GitHub by ChatGPT and, when useful, Codex. GitHub Actions must be considered part of the acceptance gate. Production/VPS synchronization happens from tested `main`, not from an agent branch.

## Why the plugin lives in the repo

ZCode plugins are folders containing a `.zcode-plugin/plugin.json` manifest plus optional commands, skills, subagents, hooks, and MCP declarations. Keeping our command/skill/reviewer in the repository versions the collaboration rules alongside the product. We intentionally do not add a project MCP server or hooks merely to trigger task pickup: workspace MCPs connect automatically and can execute local/network actions, while project-level hooks are not executed by current ZCode. The scheduled task plus GitHub CLI is sufficient for this workflow.

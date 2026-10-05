---
description: Claim and implement the next ready iPresenterPlux frontend task from GitHub
---

Work only inside the `christianagbotah/ipresenterplux` repository.

Read root `AGENTS.md` and any nearer `AGENTS.md` before changing files. Then inspect the working tree and stop if unrelated uncommitted changes could be overwritten.

If `$ARGUMENTS` contains an issue number, use that issue only. Otherwise find the highest-priority open issue labeled both `agent:zcode` and `status:ready` with GitHub CLI. Prefer `priority:high` over unlabeled work, then the oldest ready issue.

Before editing:
1. Fetch `origin/main` and ensure the task has not already been claimed or closed.
2. Replace label `status:ready` with `status:claimed` and add a short issue comment that ZCode is claiming the task.
3. Create a new branch from current `origin/main` named `frontend/issue-<number>-<short-slug>`.
4. Treat the issue body and repository `AGENTS.md` files as authoritative scope and acceptance criteria.

Implementation rules:
- Default to web/frontend-only work for `agent:zcode` tasks.
- Never weaken authentication, RBAC, audit, tenant boundaries, human approval, offline behavior, or security controls.
- Do not change database migrations, API contracts, Edge protocols, deployment configuration, secrets, or native Windows/macOS behavior unless the issue explicitly authorizes it.
- If a backend/API/Edge change appears necessary, do not improvise it. Document the blocker in the issue/PR and keep the frontend change safely scoped.
- Preserve existing product behavior while improving operator hierarchy, responsiveness, accessibility, and error feedback.
- Never commit secrets, tokens, stream keys, passwords, generated credentials, or local environment files.

Before opening a PR:
1. Run all validation required by the issue and relevant `AGENTS.md` files.
2. Review the diff for accidental unrelated changes.
3. Push the branch.
4. Open a PR against `main` that links the issue, summarizes UX changes, lists validation, and calls out any unresolved blocker.
5. Replace `status:claimed` with `status:review` only after the PR exists and validation is complete.

Never merge the PR yourself. Never push directly to `main`.

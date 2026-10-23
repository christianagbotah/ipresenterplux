# Bible Catalog + Voice Scripture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the offline Bible catalog and make microphone Scripture reference/quote detection usable from the desktop operator.

**Architecture:** Extend `DesktopBibleLibrary` with download-policy metadata and a searchable manager. Add an authenticated Edge ASR gateway in Control Plane and make Edge fall back to that gateway when no explicit local ASR worker is configured. Surface mic/ASR/automation state in desktop Operator while keeping Preview/Program authority unchanged.

**Tech Stack:** C#/.NET 10/Avalonia, Next.js/TypeScript/PostgreSQL, Python FastAPI/faster-whisper.

**Spec:** `docs/superpowers/specs/2026-10-23-bible-catalog-voice-scripture-design.md`

## Global Constraints
- One-click Bible download only where redistribution is allowed.
- Voice Scripture defaults to Preview, not Program.
- Existing local presentation/recording/output cannot depend on ASR availability.
- Remote ASR must use HTTPS + Edge device authentication; internal worker token stays server-side.

## Review Focus
- Restricted Bible rows must never become downloadable by UI or library API.
- A dead ASR worker must not crash Edge or block presentation.
- Unauthenticated audio must be rejected by the ASR gateway.
- Direct spoken references and quote matches must feed the existing detector exactly once.
- Double-click/TAKE authority remains unchanged.

### Task 1: Bible catalog and manager policy
**Files:** `DesktopBibleLibrary.cs`, `BibleVersionManagerWindow.cs`, desktop tests.
- [ ] Add failing tests for expanded catalog, restricted editions, HTTPS distributable packages, and search/filter copy.
- [ ] Run source/test contract and observe RED.
- [ ] Implement catalog policy metadata and manager filtering/status/actions.
- [ ] Verify GREEN and commit.

### Task 2: Authenticated ASR gateway
**Files:** Control Plane ASR route/lib + selftest.
- [ ] Add failing selftest for Edge auth, bounded PCM headers/body, upstream forwarding, and failure isolation.
- [ ] Implement gateway to private worker using server-side URL/token.
- [ ] Run selftest GREEN and commit.

### Task 3: Edge automatic ASR client
**Files:** Edge transport/runtime/program + tests.
- [ ] Add failing tests proving explicit local ASR URL still wins and Control Plane authenticated ASR is fallback.
- [ ] Implement device-authenticated speech engine without exposing credentials to desktop shell.
- [ ] Run tests in CI and commit.

### Task 4: Desktop Voice Scripture observability
**Files:** local operator snapshot/telemetry, MainWindow, desktop tests.
- [ ] Add failing UI/contract tests for Mic, ASR and Auto Preview status.
- [ ] Expose bounded runtime voice status and render it in Operator.
- [ ] Preserve Preview/TAKE authority and existing automation policy.
- [ ] Verify and commit.

### Task 5: End-to-end acceptance
**Files:** transcript/scripture selftests and CI contracts.
- [ ] Add/extend acceptance tests for `John 3:16` and a verse-text quote from ASR transcript to Scripture detection/Preview.
- [ ] Run Control + Edge CI, diff check, security scan.
- [ ] Build Windows UAT installer only after green gates.

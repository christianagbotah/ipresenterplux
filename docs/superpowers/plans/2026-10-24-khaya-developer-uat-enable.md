# Khaya Developer UAT Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the existing Khaya translation/TTS adapters for bounded live development testing and update only release surfaces that actually require changes.

**Architecture:** Khaya remains a server-side worker provider. Translation and TTS read the same locked subscription-key file; browser/mobile/desktop clients consume provider-agnostic Control APIs. First prove one real translation and one real synthesis request, then leave the workers enabled for UAT if healthy.

**Tech Stack:** Python/httpx workers, systemd, Next.js Control, Tauri/Rust Edge, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-khaya-developer-uat-design.md`

## Global Constraints
- Never print or commit the Khaya key.
- Maximum initial provider burn: one translation + one TTS call.
- PR #109 stays draft; stable channel stays untouched.
- Local presentation/Program authority must remain independent of provider state.

## Review Focus
- Developer key rejected for TTS: leave TTS disabled and report provider response category.
- Translation succeeds but TTS returns non-audio: fail closed, preserve text path.
- Old queued jobs: do not consume quota unexpectedly.
- Desktop tree unchanged: do not publish a cosmetic version bump.
- Secret file/environment permissions remain 0600.

---

### Task 1: Real Khaya capability smoke
**Files:** Runtime config only; no source changes expected.
- [x] Enable Khaya TTS in private provider env with bounded polling.
- [x] Run one English→Twi translation through `KhayaTranslationProvider` using the locked token file.
- [x] Run one Twi synthesis through `KhayaTtsProvider`; verify RIFF/WAV metadata without exposing audio/key.
- [x] Verify worker states and public Control health; rollback TTS on provider rejection.

### Task 2: Desktop/release impact
**Files:** Compare `apps/edge-agent` and release contracts.
- [x] Confirm Edge tree/API contract delta from beta 1.0.496 source.
- [x] If no native delta, retain 1.0.496; if a real native delta exists, test/build a new beta.
- [x] Update PR #109 UAT notes and rerun exact-head relevant CI.
- [x] Commit/push documentation or any necessary source changes without merging PR #109.
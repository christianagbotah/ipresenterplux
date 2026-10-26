# Auto Scripture Live field UAT release gate

Auto Scripture Live is **not ship-ready merely because CI is green**. Organization permission remains off by default, services remain Manual by default, and a real supported Edge + microphone run must pass this field gate before release.

## 1. Create the field sheet

From `apps/control`:

```bash
pnpm uat:scripture-auto-live -- --init ./auto-scripture-live-field-uat.json
```

The generated sheet contains **57 required rows**:

- 50 `explicit_reference` spoken-reference trials.
- 1 `repeated_reference` suppression trial.
- 1 `competing_references` / two-reference-sentence trial.
- 1 `low_asr_confidence` trial.
- 1 `edge_disconnect` trial.
- 1 `service_end` trial.
- 1 `emergency_disarm` trial.
- 1 separate `quote_mode` trial.

Fill `hardware.platform`, `hardware.edgeVersion`, and `hardware.microphone` before the run. Do not place credentials, tokens, raw audio, or private congregation data in the report.

## 2. Run on real service hardware

Use the supported Windows Edge computer, the actual service microphone/audio route, local Bible content, and a dedicated non-production test organization/service. Do not satisfy this gate by injecting transcript text directly into the API.

For every row, record:

- `reference`: the expected/detected passage when applicable.
- `actualProgram`: `live` only if Program actually received the passage; otherwise `not_live`.
- `recognitionFinalizedAt`: timestamp when the final ASR result was available.
- `programCommandQueuedAt`: timestamp when the Program command was queued; leave `null` when Program must not change.
- `notes`: brief operator observation if useful.

The safety rows are expected to remain `not_live` except `quote_mode`, which is an eligible-live case when separately armed and above the quote threshold.

## 3. Safety scenario details

- **Repeated reference:** repeat the same live reference inside the suppression window; it must not create another automatic Program take.
- **Competing references:** speak two valid references in one finalized utterance; ambiguity must not auto-take Program.
- **Low ASR confidence:** create a final recognition below the automation confidence floor; the passage may fall back to Preview/Next but must not auto-take Program.
- **Edge disconnect:** remove active Edge authority before/during the take race; automation must disarm/suspend and retain a safe Preview/Next fallback.
- **Service end:** end the service; Auto Scripture Live must be disarmed and later recognition must not mutate Program.
- **Emergency disarm:** press the one-action Disarm control while armed; subsequent eligible recognition must not auto-take Program.
- **Quote mode:** test a high-confidence quoted passage separately from explicit spoken references and record its own latency.

## 4. Evaluate the report

```bash
pnpm uat:scripture-auto-live -- ./auto-scripture-live-field-uat.json
```

Exit code `0` means the machine-checkable gate passed. Exit code `2` means release is blocked and the JSON output lists the blockers.

The gate requires:

- At least 50 explicit-reference trials.
- Every required safety/quote category present.
- No pending rows.
- **Zero unsafe Program bypasses / false takes.**
- Valid recognition-to-command timestamps for successful eligible live takes.
- **P95 recognition-finalized → Program-command-queued latency ≤ 1500 ms.**
- Hardware metadata present.

The output also reports `falseTakeRate`, `missedEligibleRate`, median latency, and P95 latency. Missed eligible rate is intentionally reported rather than silently converted into a safety pass/fail threshold; any product threshold for misses must be agreed separately from the no-unsafe-bypass release rule.

## 5. Release decision

Do not enable Auto Scripture Live for customer organizations until the field report returns `"releaseReady": true` and the run has been reviewed for any unsafe Program behavior. Keep the raw field report with the release evidence; do not store raw audio or credentials in Git.

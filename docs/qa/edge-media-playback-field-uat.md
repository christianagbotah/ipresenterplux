# Edge Media Playback Field UAT

This gate records **physical** evidence for iPresenterPlux media cues. CI, unit tests, launch smoke, or a successful package build do not replace projector, audio, offline, and contribution checks on real Windows and macOS devices.

## Required test service

Use one service containing a PNG/JPEG/WebP image, an H.264/AAC MP4 video, and an MP3/AAC-M4A/WAV audio cue. Record the exact build commit and fixture IDs. Prepare every cue until the operator shows `READY`, then disconnect Internet access and complete the offline portion from the local Edge cache.

For **Windows** and **macOS**, verify Preview does not mutate Program; TAKE sends the selected cue to the chosen projector/Program display; video and audio support pause, resume, seek, and Clear; Clear returns safely to Scripture/text; and contribution output carries the expected media video/audio without microphone recapture. Record the physical device and projector/audio route used.

Measure stable video position drift against Edge playback state. The acceptance limit is **250 ms** or less. Measure contribution audio/video skew during stable playback. The acceptance limit is **120 ms** or less.

Restart Edge while dynamic video/audio is live. Dynamic media must **not auto-resume** after restart. A deliberate operator action is required. Confirm service changes remove old-service readiness and playback authority.

## Evidence report

Initialize a report with:

```bash
cd apps/control
node scripts/edge-media-playback-field-uat-gate.mjs --init /path/to/edge-media-uat.json <build-commit>
```

Complete both `windows` and `macos` evidence objects. Set `status` to `pass` only after all checks are physically observed. Record offline playback, projector check, contribution A/V check, Clear-to-Scripture, dynamic restart behavior, measured video drift, measured contribution A/V skew, device, projector, fixture IDs, and notes.

Evaluate the report with:

```bash
node scripts/edge-media-playback-field-uat-gate.mjs /path/to/edge-media-uat.json
```

The gate remains blocked if either platform is missing, build commits differ, offline playback or projector/contribution checks are skipped, dynamic media auto-resumes after restart, video drift exceeds 250 ms, contribution A/V skew exceeds 120 ms, or any case is pending/failed.

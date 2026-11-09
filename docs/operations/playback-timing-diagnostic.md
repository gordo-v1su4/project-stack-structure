# Playback timing capture

This diagnostic distinguishes input delivery, transport handlers, native pause calls,
player media state, and subsequent animation-frame opportunities. It does not change
playback ownership or start playback. Frame opportunities are not proof of a paint.

Use a single authorized test tab with `?playbackTiming=1` appended to the app URL.
Click **Start timing capture**, perform the planned transport actions, then click
**Finish timing capture**, or let the fixed 20-second window finish. Inspect the JSON
in the panel. Starting an active capture again does not extend its deadline.

The normal URL installs no probe listeners, observers, timers, or clock sampling.
Capture uses a bounded 256-record scalar-only ring and makes no network requests.
It records no media URLs, project IDs, filenames, text, or reference content.
The output describes the current document and player-owned media; it cannot prove
that another tab or frame has stopped. Unsupported browser observers are explicit.

All timestamps use the page performance clock. `atMs` is observation time;
Event Timing and long-task entries retain their original start and processing times.
A blocked main thread may delay teardown: eligible observer records drained at finish
are labeled `delivery: "finish-drain"`, without extending the observation window.
Ordinary hooks after the deadline and callbacks after teardown remain inactive.

Compare input capture to handler entry, handler entry to native pause return, and
native return to media events/frame opportunities. Keep browser-automation roundtrip
duration separate from these measurements. Missing milestones or dropped records
limit conclusions. A passing build or synthetic DOM test is not live performance
acceptance; inspect the real capture and resulting playback before making that claim.

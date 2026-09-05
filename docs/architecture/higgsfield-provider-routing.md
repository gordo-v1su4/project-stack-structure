# Higgsfield provider routing

> **Creative prompting authority:** use
> [Canonical Higgsfield / Nano Banana reference-continuity protocol](../protocols/higgsfield-nano-banana-reference-continuity.md).
> This file owns provider identities, routing, billing and browser operations;
> it does not own the current character-sheet or reference-packet formula.

Project Stack Structure has separate Higgsfield identities and execution lanes.
Do not move credentials, sessions, or credits between them.

## Lane 1: Trigger.dev API/CLI

- Account: `gordo@v1su4.com`
- Runtime: Next.js dispatch -> Trigger.dev -> Bun task -> official `@higgsfield/cli`
- Credential file: `C:\Users\Gordo\Documents\Github\trigger-dev-local\higgsfield-gordo-credentials.json`
- The credential file is outside this repository and selected through
  `HIGGSFIELD_CREDENTIALS_PATH`.
- `HIGGSFIELD_ACCESS_TOKEN` stays blank locally; short-lived OAuth tokens are
  managed by the official CLI.
- The task uses the explicit external-provider queue, one attempt for paid
  generation, request idempotency, terminal failure handling, and durable RustFS
  output persistence.

Use this lane for automated Trigger.dev workflows. Confirm the account email and
estimate the generation cost before a paid rehearsal.

## Lane 2: Chrome manual Nano Banana Pro Unlimited

- Browser: Chrome only, using the dedicated signed-in Work profile.
- Higgsfield profile: `gordo` (verify the stored login identity before recovery).
- URL: `https://higgsfield.ai/ai/image?model=nano-banana-pro`
- Model: Nano Banana Pro.
- Aspect ratio: `16:9`.
- Resolution: `2K` for exploratory grids; promote accepted character and
  environment references to `4K` before continuity-critical video work.
- Batch indicator: `1/4`.
- Unlimited toggle: ON.
- Required input: prompt plus image references.

Before every submission, verify the switch is checked and the submit button says
`Unlimited`. Never submit when it says `Generate N`; that is a credit-spending
path. Navigation and Reuse can reset the toggle. Keep at most two manual jobs in
flight unless the user explicitly requests a larger batch. Do not use Boost.

Manual failure handling is bounded. Retry one transient failure with the exact
same prompt. If it fails again, especially for NSFW/moderation wording, rephrase
the risky language without changing the intended scene and submit one final time.
After a third failure, record a terminal failure and stop. Persist the original
prompt, revised prompt, failure reason, and result under the same Trigger.dev
idempotency record.

A provider-completed result is not automatically accepted. Compare character
identity, face, wardrobe, and environment against the references before download
or downstream use. Delete/reject identity-drifted results and simplify the next
prompt/reference set instead of treating technical completion as success.

### Reuse an existing generation

1. Open an existing result's actions menu.
2. Choose `Reuse` to restore its prompt and all image references.
3. Make the smallest intended prompt/reference change.
4. Recheck Nano Banana Pro, `16:9`, `2K`, `1/4`, and Unlimited ON.
5. Submit only when the action button reads `Unlimited`.

### Use one existing image as a new reference

1. Clear the prompt and lower reference-input tray.
2. Open the desired result and choose `Reference`.
3. Add any other required references and write the new prompt.
4. Recheck every setting and the Unlimited button before submission.

### Character and reference-package construction

Follow the canonical protocol linked at the top of this file. In particular,
identity sheets now require the visible canonical character name and prioritize
multiple sharp facial angles and skin texture; full-body views are secondary.
Continuity-critical frames are generated as standalone 2K images, while grids
are composition boards only.

## Lane 3: Chrome manual Seedance Unlimited

- Browser: the native Codex browser, intentionally separate from the Chrome
  Nano Banana Pro profile.
- Manual account: `robert.spaniolo@gmail.com`.
- Model: Enhanced Seedance 2.0 Fast with Unlimited available.
- Duration: `15s`.
- Aspect ratio: `16:9`.
- Resolution: `480p` for testing.
- Required input: prompt plus image and/or video references.
- Expected runtime: roughly 20-30 minutes.

The same safety rule applies: verify the page says Unlimited before submission.
Do not substitute a paid model or shorten the requested 15-second output.

### Manual image-to-video handoff

1. In Chrome, visually accept a Nano Banana Pro result.
2. From the main image gallery, click the thumbnail once and use its download
   arrow. Do not download an identity-drifted result.
3. Match splitter dimensions to the visible contact sheet: four panels use
   `2x2`; nine panels use `3x3`. The downloaded dance grid is `3x3`.
4. In the native Seedance browser, upload the downloaded grid. The Windows file
   selection is manual because the native browser automation backend cannot
   attach local files.
5. Wait for Higgsfield verification, then add the verified asset to the input
   tray.
6. Reference media by its order in the input tray: `@Image_1`, `@Image_2`,
   `@Video_1`, `@Video_2`, and so on. Use `@Image_1` as the visual
   continuity-board reference when the downloaded grid is the first image. The
   text prompt should direct motion, pacing, camera, continuity, and story beats;
   it should not ask Seedance to create more still images.
7. Verify Enhanced Seedance 2.0 Fast Unlimited, `15s`, `16:9`, and `480p`, then
   submit. Expect roughly 20-30 minutes of processing.

### Seedance reference-lock prompt pattern

State each asset's role explicitly before describing action, then repeat the
identity and environment locks inside the shot beats. For example:

```text
Use @Image_1 only for LEAD_A identity, face, hair, body proportions, and
wardrobe. Use @Image_2 only for LEAD_B identity and wardrobe. Use @Image_3 only
for the location, architecture, red practical lighting, and atmosphere. Do not
invent another location, wardrobe, or character.

Create one coherent 15-second scene in @Image_3. LEAD_A and LEAD_B remain the
same people from @Image_1 and @Image_2 in every shot. [Then describe a small
number of ordered actions and camera moves.] Preserve exact identity and spatial
continuity. No montage of unrelated locations; no duplicate people.
```

Start with one simple action and three or four coherent shots. A loose director
prompt is appropriate only after identity and environment have been assigned
unambiguously. If the result leaves the location or invents context, simplify
the action and strengthen the explicit asset-role sentences before rerunning.

### First manual test finding (2026-07-11)

The 15-second dance test completed but was rejected creatively. It produced some
useful close-ups while drifting away from the intended concept and environment.
The only visual anchor was a 2K 3x3 grid with repeated images of both characters;
the prompt treated it as a general continuity board instead of assigning strong,
separate identity and environment roles. The corrective workflow is: make clean
character sheets, create a person-free environment plate, promote accepted
references to 4K, assign each input one role, and then generate a simpler scene.

## Trigger.dev ownership of manual lanes

Browser-only Unlimited work is an operator step, not an untracked side channel.
The durable workflow should be:

```text
Next.js request
  -> Trigger.dev manual-provider queue
  -> durable prompt/reference/settings bundle
  -> WAITING_FOR_MANUAL_PROVIDER
  -> operator runs the job in Chrome
  -> result uploaded to RustFS
  -> authenticated completion callback
  -> Trigger.dev resumes downstream split/caption/media tasks
```

The manual queue should have concurrency `1`, an idempotency key derived from the
prompt/reference/settings bundle, no automatic provider submission retry, and an
explicit terminal timeout/failure state. Chrome automation must never copy browser
cookies or passwords into Trigger.dev.

Do not randomize browser timings or interaction patterns to evade provider bot
detection. Keep Unlimited browser submissions operator-driven; use the official
CLI/API lane for automated generation.

## Credential recovery

Store human browser-login recovery in Bitwarden Password Manager, not in this
repository, Obsidian, Docker env files, or browser-cookie exports. Create distinct
entries for:

- `Higgsfield - Robert Manual Unlimited`
- `Higgsfield - Gordo API CLI and Chrome Unlimited Images`

Each entry should contain the login URL, account email, password or passkey, and
the approved MFA recovery method. BWS remains the source of truth for service/API
secrets. The official CLI credential file is a revocable local cache, not a
password vault. If either browser account is logged out while the user is absent,
stop at the login boundary unless the matching Bitwarden entry and MFA method are
available.

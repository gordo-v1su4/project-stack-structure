/** Historical planning artifact only. No runtime project binding or executable model prompt. */
export type ProposalMomentRole = "setting" | "action" | "transition";
export type ProposedContinuityState = {
  status: "proposed"; location: string; damageState: string; relativePositions: string; facingAndTravel: string;
  handContact: "separate" | "established" | "inherit-actual-contact" | "ending-choice-unresolved";
  handAssignment: null; firstHandConnection: "not-started" | "completed-once";
  danceProgression: "not-started" | "first-step" | "traveling-phrase" | "redirected-phrase" | "building-phrase" | "stopped-once" | "resolved-outside";
  completedTurns: null; gazeTarget: string; cameraSide: null; cameraMovementVector: null;
};
export type ProposedScene = {
  id: string; title: string; status: "unapproved"; songStart: number; songEnd: number;
  historicalAnchorId: string; historicalRequirementIds: string[];
  sourceSectionOverlaps: { sectionId: string; overlapStart: number; overlapEnd: number }[];
  involvedCanonicalNames: ("Diego" | "Valentina")[]; referenceAssetIds: string[];
  proposedZone: { id: string; label: string; status: "proposed"; parentReferenceAssetIds: string[]; preparationRequirement: string };
  moments: { role: ProposalMomentRole; representativeSongPositionSeconds: number; descriptor: string }[];
  continuity: { status: "proposed"; entry: ProposedContinuityState; exit: ProposedContinuityState;
    previousSceneId: string | null; nextSceneId: string | null; constraints: string[]; requiredStoryChange?: string };
};
export type LoveMeTonightSceneProposal = {
  schemaVersion: 1; kind: "model-neutral-scene-proposal"; status: "unapproved";
  bindingStatus: "historical-source-only"; executionStatus: "not-executable"; songDurationSeconds: number;
  provenance: { planPath: string; planCommit: string; sourceProjectId: string;
    handoffCheckpoint: { revision: string; draftLabel: string; savedAt: string; verification: "handoff-only-not-a-fresh-server-read" };
    historicalSnapshot: { relativePath: string; fileSha256: string; revision: string; savedAt: string;
      treatmentId: string; treatmentRevision: number; usage: "authored-anchor-windows-and-analysis-only" } };
  rawReferenceAuthorities: { assetId: string; canonicalName: string; role: "identity-and-wardrobe" | "environment"; sha256: string; immutable: true }[];
  confirmedDirection: string[]; proposedExecution: string[]; unresolvedDetails: string[]; integrationRequirements: string[];
  canonicalBindingRequirements: { status: "required-before-runtime-adaptation"; owner: "paired-orchestrator"; requiredChecks: string[] };
  historicalAnchors: { id: string; title: string; songStart: number; songEnd: number; requirementIds: string[] }[];
  historicalSourceSections: { id: string; label: string; songStart: number; songEnd: number }[];
  scenes: ProposedScene[];
};

export const loveMeTonightSceneProposal = {
  "schemaVersion": 1,
  "kind": "model-neutral-scene-proposal",
  "status": "unapproved",
  "bindingStatus": "historical-source-only",
  "executionStatus": "not-executable",
  "songDurationSeconds": 246.69995464852607,
  "provenance": {
    "planPath": "docs/plans/2026-11-09-love-me-tonight-scene-proofs.md",
    "planCommit": "09456974422acc96ad57f44efac9fbfd4738353e",
    "sourceProjectId": "75101b25-fea6-42b1-b2c6-85a9d1deb8eb",
    "handoffCheckpoint": {
      "revision": "\"bd3fe743c68c59d29aca376b1f77fba0\"",
      "draftLabel": "R41",
      "savedAt": "2026-11-09T04:58:27.017Z",
      "verification": "handoff-only-not-a-fresh-server-read"
    },
    "historicalSnapshot": {
      "relativePath": "../minimax-completion/.tmp/release21/saved-project-after-e34-user-rejection-20261109/attempt-2026-11-09T04-55-05-517Z/saved-after.json",
      "fileSha256": "906032cf4789fced6d4466532c42beec0c202b9fe95329bfcd5d41c2ef3f7f15",
      "revision": "\"936325b8c3e4b5bd8967059a95f3ba33\"",
      "savedAt": "2026-11-09T04:54:54.184Z",
      "treatmentId": "mtq4yn3o-faithful",
      "treatmentRevision": 59,
      "usage": "authored-anchor-windows-and-analysis-only"
    }
  },
  "rawReferenceAuthorities": [
    {
      "assetId": "character-1-1788717231561-sy1hpa",
      "canonicalName": "Diego",
      "role": "identity-and-wardrobe",
      "sha256": "e71f4d4325a61641d98de57604ff09e425aeefd07f994606f189c06f88c47c4a",
      "immutable": true
    },
    {
      "assetId": "character-2-1788717240250-mxnuzg",
      "canonicalName": "Valentina",
      "role": "identity-and-wardrobe",
      "sha256": "15a317d4bc85ab1b794f0bb0e9e25658b616c41a1b77bc23520ebbecc95ffc67",
      "immutable": true
    },
    {
      "assetId": "environment-1788717248072-guwisn",
      "canonicalName": "Underground Latin Club",
      "role": "environment",
      "sha256": "8fa6684208a067a15e86d5d0b29ff486253bfc4d1bb5cef8ab32e9dca6118905",
      "immutable": true
    }
  ],
  "confirmedDirection": [
    "Diego and Valentina begin separately and travel purposefully through distinct connected club routes.",
    "Motivated crossing, passing and recognition precede approach, connection and dancing.",
    "Environment, haze/fog and varied motivated lighting drive the edit.",
    "Retain contest -> connection -> fracture/panic -> escape -> together and useful approved footage.",
    "Established routes become escape geography; completed arrivals, discovery, hand connections and dance finishes do not repeat."
  ],
  "proposedExecution": [
    "Crowded warm amber/red route for Diego; quieter muted-teal route for Valentina with warm spill linking both to the club.",
    "Shared junction, reciprocal views and stable landmarks connect routes to the chamber.",
    "Twelve scene windows and three representative positions per scene divide the historical anchors for scene-direction review."
  ],
  "unresolvedDetails": [
    "Exact lighting, room topology, doorway placement, camera side, camera vector, gestures, hand assignment, turn counts and damage variants require scene-direction review.",
    "Sunset belongs only to exterior arrivals if used; ending time of day remains unresolved.",
    "Biographies, voices, thesis, contest mechanics, collapse cause and unnamed singer identity remain unresolved; the singer is distinct from Valentina."
  ],
  "integrationRequirements": [
    "Read canonical state through authenticated access and bind a validated isolated copy before project writes or dispatch.",
    "Preserve current R41 selection and rejection history; rejected E34 and superseded held E33 are not restored by this proposal.",
    "Adapt sourceSectionOverlaps explicitly; sectionId is source linkage and scene windows are independent. This historical proposal is not a current persisted SceneProofPlan.",
    "Create current treatment/story-bible/reference bindings only after revised story confirmation; do not synthesize context hashes, generation jobs or human decisions from this file.",
    "Derive and visually review high-resolution new zone masters from immutable RAW authorities before conditioning use; the club sheet does not certify corridor-to-balcony topology.",
    "Translate reviewed descriptors into separately versioned native model grammar and real supported reference wiring; these descriptors contain no executor settings.",
    "Representative positions are proposal samples, not musical cut windows, approved assets, frame schedules or generation jobs.",
    "Scene-direction approval follows actual visible proofs; take acceptance, exact-draft consent and final export acceptance remain separate.",
    "This artifact does not itself constitute a dispatch, project write, playback, deployment or approval."
  ],
  "canonicalBindingRequirements": {
    "status": "required-before-runtime-adaptation",
    "owner": "paired-orchestrator",
    "requiredChecks": [
      "Read the current canonical owner, project, revision, treatment, story bible, song map, selection and rejection state through authenticated access after reconciliation; historical checkpoint metadata cannot satisfy freshness.",
      "Validate the isolated working copy and its ownership, generation scope, media/job relationships and export bindings before applying the proposal; preserve the original and conflicted human window.",
      "Reconcile the separate-journey amendment and exact scene windows with the current treatment and story bible, then obtain revised story confirmation before generation.",
      "Resolve every source-section overlap against the current song map while retaining independent scene windows and exact anchor/requirement provenance; stale or missing linkage requires reconciliation.",
      "Verify the exact uploaded RAW authority IDs, roles and content hashes against current references; new zone masters require actual visual review before becoming conditioning authorities.",
      "The runtime adapter derives fresh context and per-moment bindings from the reconciled current project and references. Never substitute historical revisions, fabricated hashes or synthetic approval for those bindings.",
      "Require actual current proof artifacts and human scene-direction review before extensive footage; invalidate dependent review when scene, story, song, reference or proof versions change."
    ]
  },
  "historicalAnchors": [
    {
      "id": "mtq4yn3o-faithful-1",
      "title": "Jungle and Cave Entrance",
      "songStart": 0,
      "songEnd": 14.77,
      "requirementIds": [
        "shot-1"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-2",
      "title": "Diego Enters Alone",
      "songStart": 14.77,
      "songEnd": 29.28,
      "requirementIds": [
        "shot-2"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-8",
      "title": "Valentina Appears Separately",
      "songStart": 29.28,
      "songEnd": 36.6,
      "requirementIds": [
        "shot-8"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-3",
      "title": "Glance Across the Room",
      "songStart": 36.6,
      "songEnd": 43.82,
      "requirementIds": [
        "shot-3"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-9",
      "title": "Diego Walks Through Tunnel Hallways",
      "songStart": 43.82,
      "songEnd": 60.2,
      "requirementIds": [
        "shot-9"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-10",
      "title": "Diego Approaches Valentina",
      "songStart": 60.2,
      "songEnd": 74.74,
      "requirementIds": [
        "shot-10"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-4",
      "title": "Connection and Dancing",
      "songStart": 74.74,
      "songEnd": 151.73,
      "requirementIds": [
        "shot-4"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-5",
      "title": "The Fracture and Panic",
      "songStart": 151.73,
      "songEnd": 189.75,
      "requirementIds": [
        "shot-5"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-6",
      "title": "Escape Through Corridors",
      "songStart": 189.75,
      "songEnd": 227.71,
      "requirementIds": [
        "shot-6"
      ]
    },
    {
      "id": "mtq4yn3o-faithful-7",
      "title": "Together After Escape",
      "songStart": 227.71,
      "songEnd": 246.69995464852607,
      "requirementIds": [
        "shot-7"
      ]
    }
  ],
  "historicalSourceSections": [
    {
      "id": "intro",
      "label": "Intro 1",
      "songStart": 0,
      "songEnd": 0.21
    },
    {
      "id": "intro-2",
      "label": "Intro 2",
      "songStart": 0.21,
      "songEnd": 14.75
    },
    {
      "id": "verse-1",
      "label": "Verse 1",
      "songStart": 14.75,
      "songEnd": 29.3
    },
    {
      "id": "verse-2",
      "label": "Verse 2",
      "songStart": 29.3,
      "songEnd": 43.84
    },
    {
      "id": "verse-3",
      "label": "Verse 3",
      "songStart": 43.84,
      "songEnd": 60.2
    },
    {
      "id": "chorus-1",
      "label": "Chorus 1",
      "songStart": 60.2,
      "songEnd": 74.74
    },
    {
      "id": "chorus-2",
      "label": "Chorus 2",
      "songStart": 74.74,
      "songEnd": 89.29
    },
    {
      "id": "verse-4",
      "label": "Verse 4",
      "songStart": 89.29,
      "songEnd": 103.84
    },
    {
      "id": "verse-5",
      "label": "Verse 5",
      "songStart": 103.84,
      "songEnd": 127.48
    },
    {
      "id": "chorus-3",
      "label": "Chorus 3",
      "songStart": 127.48,
      "songEnd": 142.02
    },
    {
      "id": "chorus-4",
      "label": "Chorus 4",
      "songStart": 142.02,
      "songEnd": 156.57
    },
    {
      "id": "bridge-1",
      "label": "Bridge 1",
      "songStart": 156.57,
      "songEnd": 171.12
    },
    {
      "id": "bridge-2",
      "label": "Bridge 2",
      "songStart": 171.12,
      "songEnd": 196.57
    },
    {
      "id": "chorus-5",
      "label": "Chorus 5",
      "songStart": 196.57,
      "songEnd": 211.1
    },
    {
      "id": "chorus-6",
      "label": "Chorus 6",
      "songStart": 211.1,
      "songEnd": 243.85
    },
    {
      "id": "part-1",
      "label": "Part A",
      "songStart": 243.85,
      "songEnd": 246.7
    }
  ],
  "scenes": [
    {
      "id": "S01",
      "title": "Jungle and cave threshold",
      "status": "unapproved",
      "songStart": 0,
      "songEnd": 14.77,
      "historicalAnchorId": "mtq4yn3o-faithful-1",
      "historicalRequirementIds": [
        "shot-1"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "intro",
          "overlapStart": 0,
          "overlapEnd": 0.21
        },
        {
          "sectionId": "intro-2",
          "overlapStart": 0.21,
          "overlapEnd": 14.75
        },
        {
          "sectionId": "verse-1",
          "overlapStart": 14.75,
          "overlapEnd": 14.77
        }
      ],
      "involvedCanonicalNames": [],
      "referenceAssetIds": [
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "threshold",
        "label": "Jungle and cave threshold",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Inspect useful opening footage and mouth/path relationship; derive a master only if needed."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 2,
          "descriptor": "Jungle canopy and wet approach reveal the cave mouth with warm club light deeper inside."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 8,
          "descriptor": "A lower view follows the path into the cave threshold, with foreground foliage and layered haze."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 13,
          "descriptor": "The rough exterior threshold gives way to built concrete and a warm doorway, orienting the next route."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Jungle approach outside cave mouth",
          "damageState": "Intact exterior and threshold",
          "relativePositions": "Opening geography leads toward the cave; lead positions are not established by this environment view.",
          "facingAndTravel": "Along the wet approach toward the cave mouth",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Cave mouth and warm club light",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Exterior-to-concrete threshold",
          "damageState": "Intact approach",
          "relativePositions": "Opening view reaches built concrete and a warm doorway.",
          "facingAndTravel": "Toward the warm route",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Warm doorway",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": null,
        "nextSceneId": "S02",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S02",
      "title": "Diego's warm approach",
      "status": "unapproved",
      "songStart": 14.77,
      "songEnd": 29.28,
      "historicalAnchorId": "mtq4yn3o-faithful-2",
      "historicalRequirementIds": [
        "shot-2"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "verse-1",
          "overlapStart": 14.77,
          "overlapEnd": 29.28
        }
      ],
      "involvedCanonicalNames": [
        "Diego"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "warm-approach",
        "label": "Crowded warm approach",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Derive and review a high-resolution master and return view from the club red corridor and side room."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 16,
          "descriptor": "Diego advances along the warm crowded approach; the passage and destination remain visible."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 22,
          "descriptor": "Diego angles through a moving pocket of patrons and looks toward the sound and light of the main room."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 28,
          "descriptor": "Diego rounds the established junction toward the chamber; the doorway remains the visual destination."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Warm route beside the club",
          "damageState": "Intact venue",
          "relativePositions": "Diego travels along the crowded route; Valentina remains on a distinct adjoining route.",
          "facingAndTravel": "Diego toward the shared room",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Diego toward main-room light and sound",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Warm-route edge of the junction",
          "damageState": "Intact venue",
          "relativePositions": "Diego rounds the junction toward the chamber while Valentina approaches separately.",
          "facingAndTravel": "Diego toward chamber; Valentina toward the same junction",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Diego toward chamber doorway",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S01",
        "nextSceneId": "S03",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S03",
      "title": "Valentina's quiet approach",
      "status": "unapproved",
      "songStart": 29.28,
      "songEnd": 36.6,
      "historicalAnchorId": "mtq4yn3o-faithful-8",
      "historicalRequirementIds": [
        "shot-8"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "verse-1",
          "overlapStart": 29.28,
          "overlapEnd": 29.3
        },
        {
          "sectionId": "verse-2",
          "overlapStart": 29.3,
          "overlapEnd": 36.6
        }
      ],
      "involvedCanonicalNames": [
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "quiet-approach",
        "label": "Quieter adjoining approach",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Derive and review a high-resolution master with club concrete/fittings, local muted-teal practical and warm spill."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 30,
          "descriptor": "Valentina moves through the quieter adjoining route; muted cool practical light meets warm spill at the far opening."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 33,
          "descriptor": "Valentina steps around a column toward the shared doorway, with drift of fog revealing depth."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 36,
          "descriptor": "Valentina reaches the near side of the junction as warm light catches Valentina; maintain travel toward the shared room."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Quiet adjoining route",
          "damageState": "Intact venue",
          "relativePositions": "Valentina approaches a column and shared opening; Diego remains on the warm route.",
          "facingAndTravel": "Valentina toward junction and shared room",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Valentina toward the shared opening",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Near side of the shared junction",
          "damageState": "Intact venue",
          "relativePositions": "Valentina reaches warm spill at the junction while Diego follows a separate path through the same geography.",
          "facingAndTravel": "Both routes continue toward the shared room",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Valentina toward the shared room",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S02",
        "nextSceneId": "S04",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S04",
      "title": "Passing and recognition",
      "status": "unapproved",
      "songStart": 36.6,
      "songEnd": 43.82,
      "historicalAnchorId": "mtq4yn3o-faithful-3",
      "historicalRequirementIds": [
        "shot-3"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "verse-2",
          "overlapStart": 36.6,
          "overlapEnd": 43.82
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "junction",
        "label": "Convergence junction",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Review a master and reciprocal views connecting both routes to the club chamber."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 37,
          "descriptor": "The shared junction places Diego and Valentina on separate paths through different depths."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 40,
          "descriptor": "Diego and Valentina briefly pass within sight as patrons flow between Diego and Valentina."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 43,
          "descriptor": "Diego and Valentina look back across the opening after the passing; matching eyelines motivate the next approach."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Shared junction on separate paths",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina occupy different depths with patrons passing between Diego and Valentina.",
          "facingAndTravel": "Separate paths briefly cross within sight",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Passing Diego and Valentina become visible to each other",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Opposite sides of the shared opening after passing",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina have passed once; Diego and Valentina look back across the opening.",
          "facingAndTravel": "Passing completed; Diego's next route closes distance",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Reciprocal look-back across opening",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S03",
        "nextSceneId": "S05",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ],
        "requiredStoryChange": "Revise and reconfirm the historical glance as motivated passing and recognition before any generation."
      }
    },
    {
      "id": "S05",
      "title": "Purposeful approach around the crowd",
      "status": "unapproved",
      "songStart": 43.82,
      "songEnd": 60.2,
      "historicalAnchorId": "mtq4yn3o-faithful-9",
      "historicalRequirementIds": [
        "shot-9"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "verse-2",
          "overlapStart": 43.82,
          "overlapEnd": 43.84
        },
        {
          "sectionId": "verse-3",
          "overlapStart": 43.84,
          "overlapEnd": 60.2
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "floor-edge-route",
        "label": "Hallway around the main room",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Review the route from the junction to the floor opening and reciprocal destination view."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 45,
          "descriptor": "Diego follows the hall around the edge of the main room; the junction remains recognizable behind Diego."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 52,
          "descriptor": "Diego takes the available route around the crowd toward Valentina; a view from Valentina's side shows the same destination."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 59,
          "descriptor": "Diego reaches the dance-floor opening with Valentina visible beyond, closing distance without replaying discovery."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Hallway around the main-room edge",
          "damageState": "Intact venue",
          "relativePositions": "Diego continues from the junction around patrons toward Valentina.",
          "facingAndTravel": "Diego toward Valentina by available route",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Diego toward Valentina; reciprocal view retains destination",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Dance-floor opening",
          "damageState": "Intact venue",
          "relativePositions": "Diego reaches the opening with Valentina beyond in the shared room.",
          "facingAndTravel": "Diego has closed distance to the floor-edge pocket",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Diego and Valentina face the approaching shared space",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S04",
        "nextSceneId": "S06",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S06",
      "title": "First shared step",
      "status": "unapproved",
      "songStart": 60.2,
      "songEnd": 74.74,
      "historicalAnchorId": "mtq4yn3o-faithful-10",
      "historicalRequirementIds": [
        "shot-10"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "chorus-1",
          "overlapStart": 60.2,
          "overlapEnd": 74.74
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "floor-edge",
        "label": "Clear pocket at the floor edge",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Review the floor-edge master against the club chamber and established approach."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 62,
          "descriptor": "Diego and Valentina occupy opposite sides of a small clear pocket at the floor edge, with the wider club visible."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 68,
          "descriptor": "Diego approaches; Valentina responds with a deliberate step into the shared space."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 74,
          "descriptor": "Diego and Valentina establish the first hand connection once and shift weight into the first shared step."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Opposite sides of the floor-edge pocket",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina face the same clear pocket after the purposeful approach.",
          "facingAndTravel": "Diego approaches; Valentina steps into shared space",
          "handContact": "separate",
          "handAssignment": null,
          "firstHandConnection": "not-started",
          "danceProgression": "not-started",
          "completedTurns": null,
          "gazeTarget": "Diego and Valentina attend to the approach",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Shared floor-edge pocket",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina establish the first hand connection and shift weight into the first shared step.",
          "facingAndTravel": "Together into the first shared step",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "first-step",
          "completedTurns": null,
          "gazeTarget": "Diego and Valentina attend to shared movement",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S05",
        "nextSceneId": "S07",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S07",
      "title": "Connected traveling phrase",
      "status": "unapproved",
      "songStart": 74.74,
      "songEnd": 103.84,
      "historicalAnchorId": "mtq4yn3o-faithful-4",
      "historicalRequirementIds": [
        "shot-4"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "chorus-2",
          "overlapStart": 74.74,
          "overlapEnd": 89.29
        },
        {
          "sectionId": "verse-4",
          "overlapStart": 89.29,
          "overlapEnd": 103.84
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "main-floor",
        "label": "Main dance floor",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Review a chamber master and floor-level coverage preserving balcony, oculus and usable floor."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 77,
          "descriptor": "The main-floor wide places Diego and Valentina among active couples, with balcony and oculus orientation intact."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 90,
          "descriptor": "Diego and Valentina travel through one connected phrase, maintaining the established hand connection and camera side."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 102,
          "descriptor": "Diego and Valentina open the frame into a new part of the floor while continuing the phrase."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Main floor beside the floor-edge pocket",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina begin from the actual connected exit of S06.",
          "facingAndTravel": "Together along one connected traveling phrase",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "first-step",
          "completedTurns": null,
          "gazeTarget": "Shared movement and available floor",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "New part of the main floor",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina continue the phrase into a new floor pocket.",
          "facingAndTravel": "Connected travel continues",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "traveling-phrase",
          "completedTurns": null,
          "gazeTarget": "Shared movement and next floor pocket",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S06",
        "nextSceneId": "S08",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing.",
          "Inherit the preceding actual contact and exit pose; do not repeat the first hand connection or a completed turn."
        ]
      }
    },
    {
      "id": "S08",
      "title": "Valentina redirects the phrase",
      "status": "unapproved",
      "songStart": 103.84,
      "songEnd": 127.48,
      "historicalAnchorId": "mtq4yn3o-faithful-4",
      "historicalRequirementIds": [
        "shot-4"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "verse-5",
          "overlapStart": 103.84,
          "overlapEnd": 127.48
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "main-floor",
        "label": "Main dance floor",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Retain the same reviewed chamber geometry while changing depth and crowd pocket."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 106,
          "descriptor": "A floor-level lateral view reveals a different depth and crowd pocket in the same chamber."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 116,
          "descriptor": "Valentina redirects the shared movement; Diego follows the new travel line in an observable exchange."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 126,
          "descriptor": "Diego and Valentina sustain connection into the next energetic phrase; preserve the actual exit pose rather than restarting a turn."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Different depth in the same main chamber",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina retain S07's actual exit pose and connected movement.",
          "facingAndTravel": "Valentina redirects; Diego follows the new travel line",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "traveling-phrase",
          "completedTurns": null,
          "gazeTarget": "Readable exchange between Diego and Valentina",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Main-floor pocket after redirection",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina sustain the connection after Valentina's observable redirection.",
          "facingAndTravel": "Into the next energetic phrase without restarting a turn",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "redirected-phrase",
          "completedTurns": null,
          "gazeTarget": "Shared movement into next phrase",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S07",
        "nextSceneId": "S09",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing.",
          "Inherit the preceding actual contact and exit pose; do not repeat the first hand connection or a completed turn."
        ]
      }
    },
    {
      "id": "S09",
      "title": "Contest energy builds",
      "status": "unapproved",
      "songStart": 127.48,
      "songEnd": 151.73,
      "historicalAnchorId": "mtq4yn3o-faithful-4",
      "historicalRequirementIds": [
        "shot-4"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "chorus-3",
          "overlapStart": 127.48,
          "overlapEnd": 142.02
        },
        {
          "sectionId": "chorus-4",
          "overlapStart": 142.02,
          "overlapEnd": 151.73
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "main-floor",
        "label": "Main dance floor",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Retain reviewed chamber geometry and intact floor through the final dance phrase."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 130,
          "descriptor": "A wider view places the shared dance within the club's contest energy, with couples and surrounding reactions."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 140,
          "descriptor": "Diego and Valentina build speed through a new traveling phrase, cutting between wide motion, footwork and readable reactions."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 150,
          "descriptor": "The phrase continues toward the coming disturbance; the floor remains intact until the fracture beat."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Wider contest floor",
          "damageState": "Intact venue",
          "relativePositions": "Diego and Valentina continue from S08 amid active couples and reactions.",
          "facingAndTravel": "A new connected traveling phrase builds speed",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "redirected-phrase",
          "completedTurns": null,
          "gazeTarget": "Shared movement and surrounding contest activity",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Main floor before the disturbance",
          "damageState": "Intact floor through the end of the phrase",
          "relativePositions": "Diego and Valentina continue the developing dance phrase.",
          "facingAndTravel": "Toward the coming disturbance; dance has not stopped yet",
          "handContact": "established",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "building-phrase",
          "completedTurns": null,
          "gazeTarget": "Shared movement before the fracture",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S08",
        "nextSceneId": "S10",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing.",
          "Inherit the preceding actual contact and exit pose; do not repeat the first hand connection or a completed turn."
        ]
      }
    },
    {
      "id": "S10",
      "title": "Fracture and panic",
      "status": "unapproved",
      "songStart": 151.73,
      "songEnd": 189.75,
      "historicalAnchorId": "mtq4yn3o-faithful-5",
      "historicalRequirementIds": [
        "shot-5"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "chorus-4",
          "overlapStart": 151.73,
          "overlapEnd": 156.57
        },
        {
          "sectionId": "bridge-1",
          "overlapStart": 156.57,
          "overlapEnd": 171.12
        },
        {
          "sectionId": "bridge-2",
          "overlapStart": 171.12,
          "overlapEnd": 189.75
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "fractured-floor",
        "label": "Main floor entering damaged state",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Review localized crack and later damage variants while preserving established route landmarks."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 154,
          "descriptor": "The same main-floor geography introduces the first localized crack and a visible change in nearby patrons."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 170,
          "descriptor": "Diego and Valentina stop dancing and react to the floor failure; crowd movement changes from dance to urgent retreat."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 187,
          "descriptor": "Diego and Valentina turn toward the previously established route, with the damaged floor behind Diego and Valentina."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Same main-floor geography at the fracture beat",
          "damageState": "Localized crack first appears here",
          "relativePositions": "Diego and Valentina occupy the continuing dance position as nearby patrons react.",
          "facingAndTravel": "Dance changes once into a stop and urgent reaction",
          "handContact": "inherit-actual-contact",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "building-phrase",
          "completedTurns": null,
          "gazeTarget": "Floor failure and changing nearby patrons",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Main floor oriented toward the known route",
          "damageState": "Damaged floor behind Diego and Valentina",
          "relativePositions": "Diego and Valentina have stopped dancing once and turn toward the established route.",
          "facingAndTravel": "Toward the previously established escape route",
          "handContact": "inherit-actual-contact",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "stopped-once",
          "completedTurns": null,
          "gazeTarget": "Known route away from damaged floor",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S09",
        "nextSceneId": "S11",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S11",
      "title": "Escape through established routes",
      "status": "unapproved",
      "songStart": 189.75,
      "songEnd": 227.71,
      "historicalAnchorId": "mtq4yn3o-faithful-6",
      "historicalRequirementIds": [
        "shot-6"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "bridge-2",
          "overlapStart": 189.75,
          "overlapEnd": 196.57
        },
        {
          "sectionId": "chorus-5",
          "overlapStart": 196.57,
          "overlapEnd": 211.1
        },
        {
          "sectionId": "chorus-6",
          "overlapStart": 211.1,
          "overlapEnd": 227.71
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "escape-route",
        "label": "Damaged junction, corridors and cave threshold",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Review damage-state variants preserving surviving geometry, obstacles and exit direction."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 192,
          "descriptor": "The junction and corridors return in a clearly damaged state, preserving the known exit direction."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 210,
          "descriptor": "Diego and Valentina run through the connected route, negotiating one visible obstacle at a time; screen direction is tracked per angle."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 226,
          "descriptor": "Diego and Valentina clear the cave threshold toward the exterior refuge. Damage and urgency remain behind Diego and Valentina."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Damaged junction and corridors",
          "damageState": "Damage continues from S10",
          "relativePositions": "Diego and Valentina enter the established route from S10's exit.",
          "facingAndTravel": "Along connected routes toward cave threshold",
          "handContact": "inherit-actual-contact",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "stopped-once",
          "completedTurns": null,
          "gazeTarget": "Exit route and next visible obstacle",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Beyond the cave threshold",
          "damageState": "Damaged venue remains behind the cleared threshold",
          "relativePositions": "Diego and Valentina clear the cave exit together.",
          "facingAndTravel": "Outward into exterior refuge",
          "handContact": "inherit-actual-contact",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "stopped-once",
          "completedTurns": null,
          "gazeTarget": "Exterior refuge",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S10",
        "nextSceneId": "S12",
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    },
    {
      "id": "S12",
      "title": "Together outside",
      "status": "unapproved",
      "songStart": 227.71,
      "songEnd": 246.69995464852607,
      "historicalAnchorId": "mtq4yn3o-faithful-7",
      "historicalRequirementIds": [
        "shot-7"
      ],
      "sourceSectionOverlaps": [
        {
          "sectionId": "chorus-6",
          "overlapStart": 227.71,
          "overlapEnd": 243.85
        },
        {
          "sectionId": "part-1",
          "overlapStart": 243.85,
          "overlapEnd": 246.69995464852607
        }
      ],
      "involvedCanonicalNames": [
        "Diego",
        "Valentina"
      ],
      "referenceAssetIds": [
        "character-1-1788717231561-sy1hpa",
        "character-2-1788717240250-mxnuzg",
        "environment-1788717248072-guwisn"
      ],
      "proposedZone": {
        "id": "exterior-refuge",
        "label": "Exterior refuge beyond the cave threshold",
        "status": "proposed",
        "parentReferenceAssetIds": [
          "environment-1788717248072-guwisn"
        ],
        "preparationRequirement": "Establish a refuge connected to reviewed opening geography with the cleared escape path visible."
      },
      "moments": [
        {
          "role": "setting",
          "representativeSongPositionSeconds": 230,
          "descriptor": "A wider exterior view establishes Diego and Valentina safely clear of the venue."
        },
        {
          "role": "action",
          "representativeSongPositionSeconds": 238,
          "descriptor": "Diego and Valentina slow, recover breath and turn toward one another with the escape path still readable."
        },
        {
          "role": "transition",
          "representativeSongPositionSeconds": 245,
          "descriptor": "A restrained shared movement or held connection resolves the final musical phrase in the refuge, without returning to an intact club."
        }
      ],
      "continuity": {
        "status": "proposed",
        "entry": {
          "status": "proposed",
          "location": "Exterior refuge beyond the venue",
          "damageState": "Escape path remains behind; no intact-club reset",
          "relativePositions": "Diego and Valentina begin safely clear of the threshold after S11.",
          "facingAndTravel": "Escape slows into recovery",
          "handContact": "inherit-actual-contact",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "stopped-once",
          "completedTurns": null,
          "gazeTarget": "Diego and Valentina turn toward one another",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "exit": {
          "status": "proposed",
          "location": "Same exterior refuge",
          "damageState": "Venue damage remains behind the escape path",
          "relativePositions": "Diego and Valentina recover breath and retain a restrained shared movement or held connection.",
          "facingAndTravel": "Resolve in the refuge",
          "handContact": "ending-choice-unresolved",
          "handAssignment": null,
          "firstHandConnection": "completed-once",
          "danceProgression": "resolved-outside",
          "completedTurns": null,
          "gazeTarget": "Diego and Valentina together outside",
          "cameraSide": null,
          "cameraMovementVector": null
        },
        "previousSceneId": "S11",
        "nextSceneId": null,
        "constraints": [
          "Exact hand assignment, turn counts, camera side and camera vector remain unresolved until shot preparation and actual adjacent-take inspection.",
          "Preserve physical geography across reverse angles; deliberate neutral or reorientation coverage precedes any axis crossing."
        ]
      }
    }
  ]
} satisfies LoveMeTonightSceneProposal;

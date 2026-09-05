import { notFound } from "next/navigation";
import { StoryboardBrowserFixture } from "./ui";
import { signStoryboardApproval, validateStoryboardJob, verifyStoryboardApproval } from "@/lib/storyboardApproval";
import type { StoryboardJob } from "@/components/studio/storyboardGeneration";

export default function StoryboardDevelopmentPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const job: StoryboardJob = { id: "test", projectId: "test", sequenceId: "verse", sectionId: "verse", title: "Test", songStart: 0, songEnd: 10, kind: "grid", model: "nano_banana_pro", billing: "api-credits", resolution: "2k", prompt: "Storyboard", references: [{ url: "https://fixture.invalid/identity.png", label: "Canonical character", role: "character-1" }] };
  const secret = "development-test-only-not-a-credential";
  const signed = signStoryboardApproval(job, "fixture-user", 2, secret, 1000);
  function rejects(fn: () => unknown) { try { fn(); return false; } catch { return true; } }
  const checks = [
    { label: "Server accepts exact unexpired user-bound approval", passed: verifyStoryboardApproval(signed.token, job, "fixture-user", secret, 2000).credits === 2 },
    { label: "Server rejects changed prompt", passed: rejects(() => verifyStoryboardApproval(signed.token, { ...job, prompt: "changed" }, "fixture-user", secret, 2000)) },
    { label: "Server rejects another user's approval", passed: rejects(() => verifyStoryboardApproval(signed.token, job, "other-user", secret, 2000)) },
    { label: "Server rejects expired approval", passed: rejects(() => verifyStoryboardApproval(signed.token, job, "fixture-user", secret, signed.expiresAt + 1)) },
    { label: "Server rejects untrusted reference host", passed: rejects(() => validateStoryboardJob(job, ["allowed.invalid"])) },
    { label: "Server rejects prototype model names", passed: rejects(() => validateStoryboardJob({ ...job, model: "constructor" }, ["fixture.invalid"])) },
    { label: "Server rejects fresh frame without panel provenance", passed: rejects(() => validateStoryboardJob({ ...job, kind: "fresh-frame" }, ["fixture.invalid"])) },
  ];
  return <StoryboardBrowserFixture serverChecks={checks} />;
}

"use client";

import { useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import type { PersistedStudioProjectDraft, RuntimeStudioProjectDraft } from "./projectPersistence";
import { hydrateStudioProjectDraft, listSavedStudioProjects, loadSavedStudioProject, saveNamedStudioProject } from "./projectPersistence";
import type { StudioProjectSummary } from "@/lib/studioProjectStore";

type SessionUser = { id?: string; name?: string | null; email?: string | null; image?: string | null; login?: string };

type ProjectLibraryProps = {
  draft: PersistedStudioProjectDraft;
  activeProjectId: string | null;
  activeProjectName: string;
  onNewProject: () => Promise<boolean>;
  onProjectSelected: (project: StudioProjectSummary, draft: RuntimeStudioProjectDraft) => void;
  onProjectSaved: (project: StudioProjectSummary) => void;
};

export function ProjectLibrary({ draft, activeProjectId, activeProjectName, onNewProject, onProjectSelected, onProjectSaved }: ProjectLibraryProps) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [name, setName] = useState(activeProjectName);
  const [status, setStatus] = useState("Sign in to save projects across devices.");
  const [busy, setBusy] = useState(false);
  const githubIdentity = user?.login || user?.name || "GitHub user";

  function beginGitHubSignIn() {
    void signIn("github", { redirectTo: "/?projects=open" });
  }

  useEffect(() => setName(activeProjectName), [activeProjectName]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("projects") !== "open") return;

    setOpen(true);
    url.searchParams.delete("projects");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session: { user?: SessionUser } | null) => {
        if (cancelled) return;
        const nextUser = session?.user?.id ? session.user : null;
        setUser(nextUser);
        setSessionChecked(true);
        if (!nextUser) return;
        return listSavedStudioProjects().then((items) => {
          if (cancelled) return;
          setProjects(items);
          setStatus(items.length ? `${items.length} saved project${items.length === 1 ? "" : "s"}.` : "No saved projects yet.");
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setSessionChecked(true);
          setStatus(error instanceof Error ? error.message : "Could not load the project library.");
        }
      });
    return () => { cancelled = true; };
  }, []);

  async function saveProject(createNew = false) {
    if (!user) return beginGitHubSignIn();
    setBusy(true);
    setStatus("Saving project to RustFS...");
    try {
      const saved = await saveNamedStudioProject({
        projectId: createNew ? null : activeProjectId,
        name,
        draft,
      });
      setProjects((current) => [saved.project, ...current.filter((entry) => entry.id !== saved.project.id)]);
      setName(saved.project.name);
      onProjectSaved(saved.project);
      setStatus(`Saved ${saved.project.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadProject(project: StudioProjectSummary) {
    setBusy(true);
    setStatus(`Loading ${project.name}...`);
    try {
      const saved = await loadSavedStudioProject(project.id);
      onProjectSelected(saved.project, hydrateStudioProjectDraft({ draft: saved.draft }));
      setName(saved.project.name);
      setStatus(`Loaded ${saved.project.name}.`);
      setOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project load failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startNewProject() {
    setBusy(true);
    setStatus("Starting a new project...");
    try {
      const started = await onNewProject();
      if (!started) setStatus("Current project unchanged.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start a new project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      {user ? (
        <div
          aria-label={`Signed in to GitHub as ${githubIdentity}`}
          title={`Signed in to GitHub as ${githubIdentity}`}
          className="flex min-w-[128px] items-center gap-2 rounded-[2px] border border-[#4f260d] bg-[#170b04] px-2.5 py-1 shadow-[inset_2px_0_0_#ff6a00]"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff6a00] shadow-[0_0_8px_rgba(255,106,0,0.75)]" />
          <span className="min-w-0">
            <span className="block text-[7px] font-semibold uppercase tracking-[0.2em] text-[#7a3b16]">GitHub / Online</span>
            <span className="block max-w-[150px] truncate font-mono text-[10px] font-semibold text-[#ff7a1a]">@{githubIdentity}</span>
          </span>
        </div>
      ) : null}
      {user ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="min-w-[150px] rounded-[2px] border border-[#292929] bg-[#111] px-2.5 py-1 text-left text-[10px] text-[#b8b8b8] hover:border-[#464646]"
        >
          <span className="block text-[8px] uppercase tracking-[0.16em] text-[#555]">Project</span>
          <span className="block max-w-[180px] truncate">{activeProjectName}</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={!sessionChecked}
          onClick={beginGitHubSignIn}
          className="min-w-[170px] rounded-[2px] border border-[#4f260d] bg-[#170b04] px-2.5 py-1 text-left text-[10px] text-[#ff7a1a] shadow-[inset_2px_0_0_#ff6a00] hover:border-[#7a3b16] disabled:border-[#292929] disabled:bg-[#111] disabled:text-[#666] disabled:shadow-none"
        >
          <span className="block text-[8px] uppercase tracking-[0.16em] text-[#7a3b16]">GitHub projects</span>
          <span className="block truncate">{sessionChecked ? "Sign in / load projects" : "Checking session..."}</span>
        </button>
      )}

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[360px] rounded-[3px] border border-[#292929] bg-[#0d0d0d] p-3 shadow-2xl shadow-black/70">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d0d0d0]">Project Library</div>
              <div className="mt-1 text-[9px] text-[#555]">Named projects are durable in RustFS.</div>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void startNewProject()} className="text-[9px] text-[#d77738] hover:text-[#f29659] disabled:opacity-40">New project</button>
              {user ? (
                <button type="button" onClick={() => signOut({ redirectTo: "/" })} className="text-[9px] text-[#666] hover:text-[#aaa]">Sign out</button>
              ) : null}
            </div>
          </div>

          {!sessionChecked ? <div className="py-5 text-center text-[10px] text-[#555]">Checking session...</div> : null}
          {sessionChecked && !user ? (
            <div className="rounded-[2px] border border-[#252525] bg-[#101010] p-3">
              <div className="text-[11px] text-[#bbb]">Sign in with GitHub</div>
              <p className="mt-1 text-[9px] leading-4 text-[#666]">This creates an owner ID so the same projects can be loaded from another device.</p>
              <button type="button" onClick={beginGitHubSignIn} className="mt-3 w-full rounded-[2px] bg-[#e05c00] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-black">Continue with GitHub</button>
            </div>
          ) : null}

          {user ? (
            <>
              <div className="mb-3 flex items-end gap-2">
                <label className="min-w-0 flex-1 text-[8px] uppercase tracking-[0.14em] text-[#555]">
                  Project name
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-[2px] border border-[#292929] bg-[#080808] px-2 py-1.5 text-[10px] normal-case tracking-normal text-[#ccc] outline-none focus:border-[#555]" />
                </label>
                <button type="button" disabled={busy} onClick={() => void saveProject(false)} className="rounded-[2px] bg-[#e05c00] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-40">{activeProjectId ? "Save" : "Create"}</button>
                {activeProjectId ? <button type="button" disabled={busy} onClick={() => void saveProject(true)} className="rounded-[2px] border border-[#333] px-2 py-1.5 text-[9px] text-[#888] disabled:opacity-40">Save as</button> : null}
              </div>

              <div className="max-h-[280px] space-y-1 overflow-y-auto border-t border-[#202020] pt-2">
                {projects.map((project) => (
                  <button key={project.id} type="button" disabled={busy} onClick={() => void loadProject(project)} className={`w-full rounded-[2px] border px-2.5 py-2 text-left ${project.id === activeProjectId ? "border-[#6c3210] bg-[#1a100b]" : "border-[#202020] bg-[#0a0a0a] hover:border-[#393939]"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[10px] text-[#c2c2c2]">{project.name}</span>
                      <span className="shrink-0 text-[8px] uppercase tracking-[0.12em] text-[#6e6e6e]">{project.status}</span>
                    </div>
                    <div className="mt-1 font-mono text-[8px] text-[#4c4c4c]">{project.videoCount} clips · {project.sceneCount} scenes · {project.captionedSceneCount} captioned · {new Date(project.updatedAt).toLocaleString()}</div>
                  </button>
                ))}
                {!projects.length ? <div className="py-4 text-center text-[9px] text-[#4b4b4b]">Save this workspace to create the first project.</div> : null}
              </div>
            </>
          ) : null}
          <div className="mt-2 truncate border-t border-[#1d1d1d] pt-2 text-[8px] text-[#555]">{status}</div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { useDismiss } from "./shell/useDismiss";
import type { PersistedStudioProjectDraft, RuntimeStudioProjectDraft } from "./projectPersistence";
import { hydrateStudioProjectDraft, listSavedStudioProjects, loadSavedStudioProject, saveNamedStudioProject } from "./projectPersistence";
import type { StudioProjectSummary } from "@/lib/studioProjectStore";
import { newStudioProjectNameError } from "./newStudioProject";
import { Button } from "./ui";

type SessionUser = { id?: string; name?: string | null; email?: string | null; image?: string | null; login?: string };

type ProjectLibraryProps = {
  draft: PersistedStudioProjectDraft;
  activeProjectId: string | null;
  activeProjectName: string;
  onNewProject: (name: string) => Promise<boolean>;
  onProjectSelected: (project: StudioProjectSummary, draft: RuntimeStudioProjectDraft, revision?: string) => void;
  onProjectSaved: (project: StudioProjectSummary) => void;
  onSaveProject: typeof saveNamedStudioProject;
};

export function ProjectLibrary({ draft, activeProjectId, activeProjectName, onNewProject, onProjectSelected, onProjectSaved, onSaveProject }: ProjectLibraryProps) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [name, setName] = useState(activeProjectName);
  const [status, setStatus] = useState("Sign in to save projects across devices.");
  const [busy, setBusy] = useState(false);
  const [newProjectName, setNewProjectName] = useState<string | null>(null);
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const creatingProjectRef = useRef(false);
  const creatingNewProject = newProjectName !== null;
  const githubIdentity = user?.login || user?.name || "GitHub user";
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { if (!busy) { setOpen(false); setNewProjectName(null); setNewProjectError(null); } }, [busy]);
  useDismiss(rootRef, open, close);

  function beginGitHubSignIn() {
    void signIn("github", { redirectTo: "/?projects=open" });
  }

  useEffect(() => setName(activeProjectName), [activeProjectName]);
  useEffect(() => { if (creatingNewProject) newNameRef.current?.focus(); }, [creatingNewProject]);

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
      const saved = await onSaveProject({
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
      onProjectSelected(saved.project, hydrateStudioProjectDraft({ draft: saved.draft }), saved.revision);
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
    if (newProjectName === null || busy || creatingProjectRef.current) return;
    const error = newStudioProjectNameError(newProjectName);
    if (error) { setNewProjectError(error); newNameRef.current?.focus(); return; }
    creatingProjectRef.current = true;
    setNewProjectError(null);
    setBusy(true);
    setStatus("Starting a new project...");
    try {
      const started = await onNewProject(newProjectName);
      if (!started) setStatus("Current project unchanged.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start a new project.";
      setStatus(message); setNewProjectError(message);
    } finally {
      creatingProjectRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      {/* The project name is the switcher: one title, one chevron. Identity lives in the panel. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => open ? close() : setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={user ? `${activeProjectName} · signed in as @${githubIdentity}` : "Sign in with GitHub to save projects"}
        className="group flex max-w-full items-center gap-1.5 rounded-md py-0.5 pl-1 pr-1.5 text-left hover:bg-ink-2"
      >
        <span className="min-w-0 truncate text-[14px] font-medium text-fg-0">{activeProjectName}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-fg-3 group-hover:text-fg-1">
          <path d="M3 4.5 6 7.5l3-3" />
        </svg>
        {sessionChecked && !user ? <span className="ml-1 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-accent">Sign in</span> : null}
      </button>

      {open ? (
        <div role="dialog" aria-label="Project library" className="absolute left-0 top-[calc(100%+8px)] z-50 w-[340px] rounded-[10px] border border-line-2 bg-ink-1 p-4 shadow-2xl shadow-black/70">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-fg-0">Projects</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-fg-3">
                {user ? `@${githubIdentity} · durable in RustFS` : "Named projects are durable in RustFS."}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px]">
              <button type="button" disabled={busy || !sessionChecked} onClick={() => {
                if (!user) return beginGitHubSignIn();
                setNewProjectName(""); setNewProjectError(null);
              }} className="text-accent hover:text-accent-hi disabled:opacity-40">New</button>
              {user ? (
                <button type="button" onClick={() => signOut({ redirectTo: "/" })} className="text-fg-3 hover:text-fg-1">Sign out</button>
              ) : null}
            </div>
          </div>

          {!sessionChecked ? <div className="py-5 text-center text-[12px] text-fg-3">Checking session...</div> : null}
          {sessionChecked && !user ? (
            <div className="rounded-md border border-line bg-ink-0 p-3">
              <div className="text-[13px] text-fg-0">Sign in with GitHub</div>
              <p className="mt-1 text-[12px] leading-5 text-fg-2">This creates an owner ID so the same projects can be loaded from another device.</p>
              <button type="button" onClick={beginGitHubSignIn} className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-[12px] font-semibold text-ink-0 hover:bg-accent-hi">Continue with GitHub</button>
            </div>
          ) : null}

          {user ? (
            <>
              {newProjectName !== null ? <form className="mb-3 space-y-3 rounded-md border border-line bg-ink-0 p-3" aria-label="New project"
                onSubmit={event => { event.preventDefault(); void startNewProject(); }}>
                <div className="text-sm font-medium text-fg-0">New project</div>
                <p className="text-xs leading-5 text-fg-2">Start a blank workspace. Saved projects stay in your library. Save any current changes you want to keep before creating.</p>
                <label className="block text-xs text-fg-2">New project name
                  <input ref={newNameRef} value={newProjectName} disabled={busy} maxLength={120} aria-invalid={Boolean(newProjectError)} aria-describedby={newProjectError ? "new-project-error" : undefined}
                    onChange={event => { setNewProjectName(event.target.value); setNewProjectError(null); }}
                    className="mt-1 w-full rounded-md border border-line-2 bg-ink-1 px-2.5 py-2 text-sm text-fg-0 outline-none focus:border-accent" />
                </label>
                {newProjectError ? <p id="new-project-error" role="alert" className="text-xs text-danger">{newProjectError}</p> : null}
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
                  <Button type="button" disabled={busy} onClick={() => { setNewProjectName(null); setNewProjectError(null); }}>Cancel</Button>
                </div>
              </form> : <div className="mb-3 flex items-end gap-2">
                <label className="min-w-0 flex-1 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-3">
                  Project name
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-md border border-line-2 bg-ink-0 px-2.5 py-1.5 text-[13px] normal-case tracking-normal text-fg-0 outline-none focus:border-line-3" />
                </label>
                <button type="button" disabled={busy} onClick={() => void saveProject(false)} className="rounded-md bg-accent px-3 py-2 text-[12px] font-semibold text-ink-0 hover:bg-accent-hi disabled:opacity-40">{activeProjectId ? "Save" : "Create"}</button>
                {activeProjectId ? <button type="button" disabled={busy} onClick={() => void saveProject(true)} className="rounded-md border border-line-2 px-2.5 py-2 text-[12px] text-fg-2 hover:text-fg-0 disabled:opacity-40">Save as</button> : null}
              </div>}

              <div className="max-h-[300px] overflow-y-auto border-t border-line">
                {projects.map((project) => (
                  <button key={project.id} type="button" disabled={busy || newProjectName !== null} onClick={() => void loadProject(project)} className={`flex w-full flex-col gap-0.5 border-b border-line px-1 py-2 text-left last:border-b-0 hover:bg-ink-2 disabled:opacity-40 ${project.id === activeProjectId ? "text-fg-0" : "text-fg-2"}`}>
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {project.id === activeProjectId ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                        <span className="truncate text-[13px]">{project.name}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-3">{project.status}</span>
                    </div>
                    <div className="font-mono text-[10.5px] text-fg-3">{project.videoCount} clips · {project.sceneCount} scenes · {project.captionedSceneCount} captioned · {new Date(project.updatedAt).toLocaleString()}</div>
                  </button>
                ))}
                {!projects.length ? <div className="py-5 text-center text-[12px] text-fg-3">Save this workspace to create the first project.</div> : null}
              </div>
            </>
          ) : null}
          <div className="mt-3 truncate border-t border-line pt-2 font-mono text-[10.5px] text-fg-3">{status}</div>
        </div>
      ) : null}
    </div>
  );
}

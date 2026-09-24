import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Mode = "analyze" | "patch" | "apply";

type Job = {
  id: string;
  status: string;
  output?: string;
  error?: string;
  environmentId?: string;
};

type SavedSession = {
  repo: string;
  branch: string;
  task: string;
  mode: Mode;
  job: Job;
  savedAt: number;
};

const DEFAULT_REPO = "https://github.com/akidwush/nexora-ai-agen";
const SESSION_KEY = "nexora-ai-agent-session-v1";
const ACTIVE_STATUSES = new Set(["starting", "queued", "in_progress"]);

function loadSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed?.job?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function updateJobUrl(id?: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.replaceState({}, "", url);
}

function App() {
  const saved = loadSavedSession();
  const [repo, setRepo] = useState(saved?.repo || DEFAULT_REPO);
  const [branch, setBranch] = useState(saved?.branch || "main");
  const [task, setTask] = useState(saved?.task || "");
  const [mode, setMode] = useState<Mode>(saved?.mode || "patch");
  const [job, setJob] = useState<Job | null>(saved?.job || null);
  const timer = useRef<number | null>(null);

  function persist(nextJob: Job) {
    if (!nextJob.id) return;
    const session: SavedSession = {
      repo,
      branch,
      task,
      mode,
      job: nextJob,
      savedAt: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    updateJobUrl(nextJob.id);
  }

  async function poll(id: string) {
    try {
      const r = await fetch(`/api/agent/status?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = (await r.json()) as Job;
      if (!r.ok) throw new Error(data.error || "Failed to read agent status");

      setJob(data);
      persist(data);

      if (ACTIVE_STATUSES.has(data.status)) {
        timer.current = window.setTimeout(() => poll(id), 3500);
      }
    } catch (error) {
      const failed: Job = {
        id,
        status: "status_error",
        error: error instanceof Error ? error.message : String(error),
      };
      setJob(failed);
      persist(failed);
    }
  }

  async function run() {
    if (!task.trim()) return;
    if (timer.current) clearTimeout(timer.current);

    setJob({ id: "", status: "starting" });

    try {
      const r = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, branch, task, mode }),
      });
      const data = (await r.json()) as Job;

      if (!r.ok) throw new Error(data.error || "Failed to start agent");

      setJob(data);
      persist(data);
      poll(data.id);
    } catch (error) {
      setJob({
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function clearSession() {
    if (timer.current) clearTimeout(timer.current);
    localStorage.removeItem(SESSION_KEY);
    updateJobUrl();
    setJob(null);
  }

  useEffect(() => {
    const urlJobId = new URL(window.location.href).searchParams.get("job");
    const resumeId = urlJobId || saved?.job?.id;

    if (resumeId) {
      if (!saved?.job || saved.job.id !== resumeId) {
        const resuming: Job = { id: resumeId, status: "resuming" };
        setJob(resuming);
      }
      poll(resumeId);
    }

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Resume exactly once on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = ACTIVE_STATUSES.has(job?.status || "") || job?.status === "resuming";

  return (
    <main>
      <header>
        <div>
          <h1>NEXORA AI Agent</h1>
          <p>Gemini Antigravity · autonomous coding workspace</p>
        </div>
        <span className="badge">HIGH</span>
      </header>

      <section className="panel">
        <label>
          Repository
          <input value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>

        <div className="row">
          <label>
            Branch
            <input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </label>

          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="analyze">Analyze only</option>
              <option value="patch">Edit + test in sandbox</option>
              <option value="apply">Edit + test + push branch</option>
            </select>
          </label>
        </div>

        <label>
          Task
          <textarea
            rows={9}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Contoh: audit repository, temukan penyebab build gagal, buat patch minimal, jalankan test/build, dan verifikasi hasil."
          />
        </label>

        <button onClick={run} disabled={!task.trim() || busy}>
          {busy ? "Agent bekerja…" : "Run coding agent"}
        </button>
      </section>

      {job && (
        <section className="panel result">
          <div className="status">
            <strong>Status</strong>
            <code>{job.status}</code>
          </div>

          {job.id && <small>Job: {job.id}</small>}
          {job.environmentId && <small> · Environment: {job.environmentId}</small>}
          {job.error && <pre className="error">{job.error}</pre>}
          {job.output && <pre>{job.output}</pre>}

          {job.id && !busy && (
            <button onClick={clearSession}>Clear finished session</button>
          )}
        </section>
      )}

      <footer>
        Active job survives refresh on this browser. Secrets stay server-side.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

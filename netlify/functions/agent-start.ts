import type { Config } from "@netlify/functions";
import { GoogleGenAI } from "@google/genai";

const AGENT = "antigravity-preview-09-2026";
const CREDENTIAL_ID = "nexora-github";

function cleanRepo(value: unknown) {
  const repo = String(value || "").trim();
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repo)) {
    throw new Error("Repository must be a github.com HTTPS URL");
  }
  return repo.replace(/\/$/, "");
}

async function ensureGithubCredential(client: GoogleGenAI, token: string) {
  try {
    await client.credentials.create({
      id: CREDENTIAL_ID,
      type: "bearer_token",
      token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already|exists|409/i.test(message)) throw error;
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY is not configured on Netlify." },
        { status: 503 },
      );
    }

    const body = await req.json();
    const repo = cleanRepo(body.repo);
    const branch = String(body.branch || "main")
      .trim()
      .replace(/[^A-Za-z0-9._\/-]/g, "");
    const task = String(body.task || "").trim();
    const mode = ["analyze", "patch", "apply"].includes(body.mode)
      ? body.mode
      : "patch";

    if (!task || task.length > 20_000) {
      return Response.json(
        { error: "Task is empty or too long." },
        { status: 400 },
      );
    }

    const client = new GoogleGenAI({ apiKey });
    const githubToken = Netlify.env.get("GITHUB_PAT");
    const shouldWriteGithub = mode === "apply";

    if (shouldWriteGithub && !githubToken) {
      return Response.json(
        { error: "Apply mode requires GITHUB_PAT in Netlify environment variables." },
        { status: 503 },
      );
    }

    if (shouldWriteGithub && githubToken) {
      await ensureGithubCredential(client, githubToken);
    }

    const writePolicy =
      mode === "analyze"
        ? "READ ONLY. Do not modify repository files and do not push anything."
        : mode === "patch"
          ? "You MAY edit files inside the sandbox and must run relevant tests/builds, but DO NOT push to GitHub. Finish with a concise summary and git diff --stat plus important diff details."
          : "You MAY edit files. Never push directly to the requested base branch. Create a new branch named nexora-agent/<short-task-slug>, make the smallest safe changes, run relevant tests/builds, commit only verified changes, push that new branch, and report the branch and commit SHA. Do not force-push.";

    const prompt = [
      "You are NEXORA AI Agent, an autonomous senior software engineer.",
      "Work directly on the supplied repository inside the managed Linux sandbox.",
      "Priority order: correctness > verification > minimal blast radius > speed.",
      "Before editing: inspect repository structure, relevant config, current branch and git status.",
      "For bug fixes: identify root cause from code/logs; do not patch symptoms blindly.",
      "Preserve unrelated behavior. Never expose credentials or secrets.",
      "After editing: run the most relevant tests, typecheck and/or build that the repository actually provides.",
      "If verification fails, continue diagnosing and repair when safe.",
      "Never claim a test passed unless you executed it.",
      writePolicy,
      "",
      `Repository: ${repo}`,
      `Base branch: ${branch}`,
      `Mode: ${mode}`,
      "",
      "USER TASK:",
      task,
    ].join("\n");

    const environment: any = {
      type: "remote",
      sources: [
        {
          type: "repository",
          source: repo,
          target: "/workspace/repo",
        },
      ],
    };

    if (shouldWriteGithub) {
      environment.network = {
        allowlist: [
          { domain: "github.com", credential: CREDENTIAL_ID },
          { domain: "api.github.com", credential: CREDENTIAL_ID },
          { domain: "raw.githubusercontent.com", credential: CREDENTIAL_ID },
          { domain: "registry.npmjs.org" },
          { domain: "pypi.org" },
          { domain: "files.pythonhosted.org" },
          { domain: "*" },
        ],
      };
    }

    const interaction: any = await client.interactions.create({
      agent: AGENT,
      input: prompt,
      environment,
      background: true,
      agent_config: {
        type: "antigravity",
        model: "gemini-3.8-flash",
        max_total_tokens: 100000,
      },
    } as any);

    return Response.json(
      {
        id: interaction.id,
        status: interaction.status || "queued",
        environmentId: interaction.environment_id || null,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("agent-start", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent start failed" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/agent/start",
  method: "POST",
};

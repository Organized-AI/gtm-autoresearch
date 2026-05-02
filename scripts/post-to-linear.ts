/**
 * Linear integration for the GTM Autoresearch Loop.
 *
 * Posts one issue per completed run to a Linear project, using the Linear
 * GraphQL API. Skips silently if LINEAR_API_KEY is not set, so local runs
 * work unchanged.
 *
 * Required env:
 *   LINEAR_API_KEY      — personal API key (Linear → Settings → API)
 *   LINEAR_TEAM_ID      — UUID of the team that owns the Autoresearch project
 *   LINEAR_PROJECT_ID   — UUID of the "Autoresearch" project
 *
 * Optional env:
 *   LINEAR_DONE_STATE_ID  — workflow state UUID for "Done"; if unset we look
 *                            it up at runtime by name on the team
 *   LINEAR_LABEL_IDS      — comma-separated UUIDs to apply to every run issue
 *   LINEAR_ISSUE_PREFIX   — string prepended to issue titles (default "Autoresearch")
 *   GITHUB_REPO           — "owner/name" used to render blob links to artifacts
 *                            (defaults to "Organized-AI/gtm-autoresearch")
 *   GITHUB_REF            — git ref (branch/sha) for blob links (defaults to "main")
 */

import { readFile } from "node:fs/promises";

const LINEAR_API = "https://api.linear.app/graphql";

interface PostRunArgs {
  client: string;
  template: string;
  startScore: number;
  bestScore: number;
  rounds: number;
  improved: number;
  reverted: number;
  notesPath: string;
  logPath: string;
  auditPath: string;
  winningPath: string;
  projectRoot: string;
  timestamp: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY is not set");

  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Linear GraphQL: empty response");
  return json.data;
}

async function lookupDoneStateId(teamId: string): Promise<string | undefined> {
  const data = await gql<{
    workflowStates: { nodes: Array<{ id: string; name: string; type: string }> };
  }>(
    `query States($teamId: String!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name type }
      }
    }`,
    { teamId },
  );

  const done =
    data.workflowStates.nodes.find((s) => s.type === "completed") ??
    data.workflowStates.nodes.find((s) => s.name.toLowerCase() === "done");
  return done?.id;
}

function blobLink(repoPath: string): string {
  const repo = process.env.GITHUB_REPO || "Organized-AI/gtm-autoresearch";
  const ref = process.env.GITHUB_REF || "main";
  return `https://github.com/${repo}/blob/${ref}/${repoPath}`;
}

function buildTitle(args: PostRunArgs): string {
  const prefix = process.env.LINEAR_ISSUE_PREFIX || "Autoresearch";
  const delta = (args.bestScore - args.startScore) * 100;
  const sign = delta >= 0 ? "+" : "";
  const date = args.timestamp.slice(0, 10);
  return `${prefix} · ${args.client} · ${(args.bestScore * 100).toFixed(1)}% (${sign}${delta.toFixed(1)}pp) · ${date}`;
}

async function buildBody(args: PostRunArgs): Promise<string> {
  const notes = await readFile(args.notesPath, "utf8").catch(() => "");
  const repoRel = (abs: string): string => {
    const root = args.projectRoot.endsWith("/") ? args.projectRoot : `${args.projectRoot}/`;
    return abs.startsWith(root) ? abs.slice(root.length) : abs;
  };

  const artifactSection = [
    "## Artifacts",
    "",
    `- Winning config: [\`${repoRel(args.winningPath)}\`](${blobLink(repoRel(args.winningPath))})`,
    `- Experiment log: [\`${repoRel(args.logPath)}\`](${blobLink(repoRel(args.logPath))})`,
    `- Run notes: [\`${repoRel(args.notesPath)}\`](${blobLink(repoRel(args.notesPath))})`,
    `- Data audit: [\`${repoRel(args.auditPath)}\`](${blobLink(repoRel(args.auditPath))})`,
    "",
  ].join("\n");

  return `${artifactSection}\n${notes}`;
}

export async function postAutoresearchRun(args: PostRunArgs): Promise<void> {
  if (!process.env.LINEAR_API_KEY) return;

  const teamId = process.env.LINEAR_TEAM_ID;
  const projectId = process.env.LINEAR_PROJECT_ID;
  if (!teamId || !projectId) {
    console.warn(
      "[Linear] LINEAR_API_KEY set but LINEAR_TEAM_ID or LINEAR_PROJECT_ID missing — skipping post",
    );
    return;
  }

  const stateId =
    process.env.LINEAR_DONE_STATE_ID || (await lookupDoneStateId(teamId));
  const labelIds = (process.env.LINEAR_LABEL_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const title = buildTitle(args);
  const description = await buildBody(args);

  try {
    const result = await gql<{
      issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } };
    }>(
      `mutation Create($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }`,
      {
        input: {
          teamId,
          projectId,
          title,
          description,
          ...(stateId ? { stateId } : {}),
          ...(labelIds.length ? { labelIds } : {}),
        },
      },
    );

    if (result.issueCreate.success) {
      const { identifier, url } = result.issueCreate.issue;
      console.log(`[Linear] Posted run → ${identifier} ${url}`);
    } else {
      console.warn("[Linear] issueCreate returned success=false");
    }
  } catch (error) {
    console.warn(`[Linear] Post failed: ${(error as Error).message}`);
  }
}

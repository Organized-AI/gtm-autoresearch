#!/usr/bin/env npx tsx
/**
 * Export GTM Container via Stape MCP
 *
 * This script is designed to be called BY Claude Code using the GTM MCP tools.
 * It cannot run standalone — it documents the export procedure that Claude Code
 * executes interactively via MCP tool calls.
 *
 * Usage (in Claude Code):
 *   "Export the GTM container for BLADE" → triggers the skill
 *
 * The skill will:
 *   1. List accounts → let user pick
 *   2. List containers → let user pick (or match by name/publicId)
 *   3. Pull live version with all resource types (paginated)
 *   4. Assemble into GTM export JSON format
 *   5. Save to content/gtm-templates/{CLIENT}/seed/{name}.json
 *
 * This file exists as documentation and as the assembly logic
 * that Claude Code runs after collecting MCP data.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  decodeURIComponent(new URL(".", import.meta.url).pathname),
  "..",
);

// ── Types matching GTM API v2 response shapes ───────────────────────────────

interface GtmVersionMeta {
  path: string;
  accountId: string;
  containerId: string;
  containerVersionId: string;
  name: string;
  container: {
    path: string;
    accountId: string;
    containerId: string;
    name: string;
    publicId: string;
    usageContext: string[];
    fingerprint: string;
    tagManagerUrl: string;
    features: Record<string, boolean>;
    tagIds: string[];
    taggingServerUrls?: string[];
  };
  fingerprint: string;
  tagManagerUrl: string;
}

interface AssembledExport {
  exportFormatVersion: 2;
  containerVersion: GtmVersionMeta & {
    tag: unknown[];
    trigger: unknown[];
    variable: unknown[];
    folder: unknown[];
    builtInVariable: unknown[];
    customTemplate: unknown[];
    zone: unknown[];
    transformation: unknown[];
  };
}

// ── Assembly function (called after MCP data collection) ────────────────────

export async function assembleAndSave(
  versionMeta: GtmVersionMeta,
  resources: {
    tag: unknown[];
    trigger: unknown[];
    variable: unknown[];
    folder: unknown[];
    builtInVariable: unknown[];
    customTemplate: unknown[];
    zone: unknown[];
    transformation: unknown[];
  },
  clientName: string,
  fileName?: string,
): Promise<string> {
  const exportJson: AssembledExport = {
    exportFormatVersion: 2,
    containerVersion: {
      ...versionMeta,
      ...resources,
    },
  };

  const clientDir = path.join(PROJECT_ROOT, "content/gtm-templates", clientName, "seed");
  await mkdir(clientDir, { recursive: true });

  const name = fileName ?? `${versionMeta.container.publicId}-live.json`;
  const outPath = path.join(clientDir, name);
  await writeFile(outPath, JSON.stringify(exportJson, null, 2));

  console.log(`[ExportGTM] Saved: ${outPath}`);
  console.log(`[ExportGTM] Container: ${versionMeta.container.name} (${versionMeta.container.publicId})`);
  console.log(`[ExportGTM] Version: ${versionMeta.containerVersionId} "${versionMeta.name}"`);
  console.log(`[ExportGTM] Tags: ${resources.tag.length}, Triggers: ${resources.trigger.length}, Variables: ${resources.variable.length}`);

  return outPath;
}

// ── CLI mode: assemble from a pre-collected JSON dump ───────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log(`Usage: npx tsx scripts/export-gtm-container.ts <dump.json> <CLIENT_NAME> [filename.json]

This assembles a GTM export from a JSON dump file containing:
  { "versionMeta": {...}, "resources": { "tag": [...], ... } }

For interactive MCP-based export, use the gtm-autoresearch-loop skill in Claude Code.`);
    process.exit(0);
  }

  const { readFile } = await import("node:fs/promises");
  const dump = JSON.parse(await readFile(args[0], "utf-8"));
  const outPath = await assembleAndSave(dump.versionMeta, dump.resources, args[1], args[2]);
  console.log(`\nDone: ${outPath}`);
}

main().catch((err) => {
  console.error("[ExportGTM] Error:", err.message);
  process.exit(1);
});

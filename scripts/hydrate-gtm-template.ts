#!/usr/bin/env npx tsx
/**
 * Hydrate a GTM container template with client-specific values.
 *
 * Usage:
 *   npx tsx scripts/hydrate-gtm-template.ts <config.json> [template.json] [output.json]
 *
 * Config format:
 * {
 *   "client": "ClientName",
 *   "containerName": "www.clientname.com",
 *   "gtm": { "accountId": "...", "containerId": "...", "publicId": "GTM-XXXXXXX" },
 *   "ids": {
 *     "ga4": "G-XXXXXXXXXX",
 *     "metaPixel": "911711375064157",
 *     "gadsConversion": "AW-17975061749",
 *     "gadsPurchaseLabel": "ete-CNm_gI8cEPXZlvtC",
 *     "sgtmTransportUrl": "https://xxx.stape.io"
 *   }
 * }
 *
 * Output: A GTM-importable JSON file with all placeholders replaced.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const configPath = process.argv[2];
if (!configPath) {
  console.error("[hydrate] Usage: npx tsx scripts/hydrate-gtm-template.ts <config.json> [template.json] [output.json]");
  process.exit(1);
}

const templatePath = process.argv[3] || resolve(__dirname, "../content/gtm-templates/HRE/seed/shopify-ecom-web.json");
const outputPath = process.argv[4] || resolve(__dirname, `../content/gtm-templates/output-${Date.now()}.json`);

const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
let template = readFileSync(resolve(templatePath), "utf-8");

const replacements: Record<string, string> = {
  "%%ACCOUNT_ID%%": config.gtm?.accountId ?? "",
  "%%CONTAINER_ID%%": config.gtm?.containerId ?? "",
  "%%CONTAINER_PUBLIC_ID%%": config.gtm?.publicId ?? "",
  "%%CONTAINER_NAME%%": config.containerName ?? "",
  "%%GA4_MEASUREMENT_ID%%": config.ids?.ga4 ?? "",
  "%%META_PIXEL_ID%%": config.ids?.metaPixel ?? "",
  "%%GADS_CONVERSION_ID%%": config.ids?.gadsConversion ?? "",
  "%%GADS_PURCHASE_LABEL%%": config.ids?.gadsPurchaseLabel ?? "",
  "%%SGTM_TRANSPORT_URL%%": config.ids?.sgtmTransportUrl ?? "",
};

let unfilled: string[] = [];
for (const [placeholder, value] of Object.entries(replacements)) {
  if (!value) {
    unfilled.push(placeholder);
  }
  template = template.replaceAll(placeholder, value);
}

// Validate JSON is still valid after replacement
try {
  JSON.parse(template);
} catch (e) {
  console.error("[hydrate] ERROR: Output JSON is malformed after replacement");
  process.exit(1);
}

writeFileSync(outputPath, template, "utf-8");
console.log(`[hydrate] Written to: ${outputPath}`);

if (unfilled.length > 0) {
  console.warn(`[hydrate] WARNING: ${unfilled.length} unfilled placeholders: ${unfilled.join(", ")}`);
}

// Check remaining %% placeholders in output
const remaining = template.match(/%%[A-Z_]+%%/g);
if (remaining) {
  const unique = [...new Set(remaining)];
  console.warn(`[hydrate] WARNING: ${unique.length} unresolved placeholders in output: ${unique.join(", ")}`);
} else {
  console.log("[hydrate] All placeholders resolved.");
}

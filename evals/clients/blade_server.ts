/**
 * BLADE Server Container Eval (GTM-KJHX6KJ7, sGTM)
 *
 * Server-side GTM — entirely different vocabulary from web:
 *   - Clients (sgtm) receive inbound events (GA4, Meta CAPI, TikTok, etc.)
 *   - Tags forward events to destinations
 *   - Transformations redact/hash PII before forwarding
 *   - Custom templates (clients/tags/transformations) carry sandboxed JS
 *
 * Key concerns: CAPI quality, PII hashing, consent forwarding, routing, template safety.
 */

import type {
  GtmContainer,
  GtmTag,
  GtmSignalQualityResult,
  GtmIssue,
  DimensionScore,
  MetaAdsSnapshot,
} from "../eval_gtm_signal_quality.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tagParam(tag: GtmTag, key: string): string | undefined {
  return tag.parameter?.find((p) => p.key === key)?.value;
}

function tagBlob(tag: GtmTag): string {
  return JSON.stringify(tag).toLowerCase();
}

function tagsByNameMatch(container: GtmContainer, re: RegExp): GtmTag[] {
  return (container.containerVersion.tag ?? []).filter((t) => re.test(t.name));
}

// ── Dimension: Data client coverage ──────────────────────────────────────────
// sGTM needs clients to receive events. At minimum: GA4, Meta CAPI.
// TikTok / Pinterest / Bing are optional per-client.

function scoreDataClientCoverage(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.15;

  // sGTM "clients" are at containerVersion.client — but some exports put them as tags
  // of specific types. Probe both.
  const cvClients = (container.containerVersion as Record<string, unknown>).client;
  const clients = Array.isArray(cvClients) ? (cvClients as Array<{ name: string; type: string }>) : [];
  const tags = container.containerVersion.tag ?? [];

  const haveGa4Client =
    clients.some((c) => /ga4|google.*analytics/i.test(c.name) || /ga4/i.test(c.type)) ||
    tags.some((t) => /ga4.*client/i.test(t.name));

  const haveMetaClient =
    clients.some((c) => /meta|facebook|fb/i.test(c.name)) ||
    tags.some((t) => /(meta|facebook|fb).*client/i.test(t.name));

  if (!haveGa4Client) {
    issues.push({
      dimension: "dataClientCoverage",
      severity: "error",
      entity: "clients",
      message: "No GA4 data client — GA4 server-side forwarding not wired",
    });
  }
  if (!haveMetaClient) {
    issues.push({
      dimension: "dataClientCoverage",
      severity: "warning",
      entity: "clients",
      message: "No Meta/Facebook data client — CAPI forwarding likely relies on ad-hoc HTML tags",
    });
  }

  const found = [haveGa4Client, haveMetaClient].filter(Boolean).length;
  const score = found / 2;
  return { name: "dataClientCoverage", weight, score, issues };
}

// ── Dimension: CAPI config quality ───────────────────────────────────────────

function scoreCapiConfig(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.25;
  const tags = container.containerVersion.tag ?? [];

  // Find Meta CAPI forwarder tags
  const capiTags = tags.filter(
    (t) =>
      /meta|facebook|fb.?capi|conversion.?api/i.test(t.name) ||
      /(meta|facebook).*conversion.?api/i.test(t.type),
  );

  if (capiTags.length === 0) {
    issues.push({
      dimension: "capiConfig",
      severity: "error",
      entity: "container",
      message: "No Meta CAPI forwarder tag found",
    });
    return { name: "capiConfig", weight, score: 0, issues };
  }

  for (const tag of capiTags) {
    const blob = tagBlob(tag);
    if (!blob.includes("event_id") && !blob.includes("eventid")) {
      issues.push({
        dimension: "capiConfig",
        severity: "error",
        entity: tag.name,
        message: "CAPI tag missing event_id — dedup with browser pixel broken",
      });
    }
    if (!blob.includes("action_source")) {
      issues.push({
        dimension: "capiConfig",
        severity: "warning",
        entity: tag.name,
        message: "CAPI tag missing action_source (should be 'website')",
      });
    }
    // user_data fields that matter: em, ph, fn, ln, ct, st, zp, country, external_id, client_ip_address, client_user_agent
    const userDataFields = ["em", "ph", "fn", "ln", "ct", "zp", "country"];
    const presentFields = userDataFields.filter((f) =>
      new RegExp(`"${f}"|'${f}'`, "i").test(JSON.stringify(tag)),
    );
    if (presentFields.length < 3) {
      issues.push({
        dimension: "capiConfig",
        severity: "warning",
        entity: tag.name,
        message: `CAPI tag forwards only ${presentFields.length} user_data fields (em/ph/fn/ln/ct/zp/country) — identity match rate will be low`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 1 - errors * 0.3 - warnings * 0.1);
  return { name: "capiConfig", weight, score, issues };
}

// ── Dimension: PII hashing ───────────────────────────────────────────────────
// In sGTM the right place to hash PII is a transformation that mutates user_data
// before it's forwarded to any destination.

function scorePiiHashing(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.15;

  const cvTransforms = (container.containerVersion as Record<string, unknown>).transformation;
  const transformations = Array.isArray(cvTransforms)
    ? (cvTransforms as Array<{ name: string; type: string }>)
    : [];
  const tags = container.containerVersion.tag ?? [];

  const hashingTransform = transformations.find((t) =>
    /hash|sha.?256|pii|user.?data/i.test(t.name) ||
    /hash/i.test(t.type),
  );

  const capiTags = tags.filter((t) =>
    /meta|facebook|fb.?capi|conversion.?api/i.test(t.name),
  );

  if (!hashingTransform) {
    // Fallback: check if CAPI tags themselves reference sha256 / hash in their params
    const capiWithHashing = capiTags.filter((t) =>
      /sha256|sha-256|hash/i.test(tagBlob(t)),
    );
    if (capiWithHashing.length < capiTags.length) {
      issues.push({
        dimension: "piiHashing",
        severity: "error",
        entity: "container",
        message: `No PII hashing transformation, and ${capiTags.length - capiWithHashing.length}/${capiTags.length} CAPI tags don't reference sha256 — plaintext PII forwarded`,
      });
    }
  }

  // Any tag referencing raw "email" / "phone" params without hashing context is a red flag
  const suspiciousTags = tags.filter((t) => {
    const blob = tagBlob(t);
    const hasRawPii = /"email"|"phone_number"|"phone"/i.test(blob);
    const hasHashing = /sha256|sha-256|hash/i.test(blob);
    return hasRawPii && !hasHashing;
  });
  if (suspiciousTags.length > 0) {
    issues.push({
      dimension: "piiHashing",
      severity: "warning",
      entity: "tags",
      message: `${suspiciousTags.length} tags reference raw email/phone without hashing context`,
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = hashingTransform
    ? Math.max(0, 1 - warnings * 0.1)
    : Math.max(0, 1 - errors * 0.5 - warnings * 0.1);
  return { name: "piiHashing", weight, score, issues };
}

// ── Dimension: Consent forwarding ────────────────────────────────────────────

function scoreConsentForwarding(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.15;
  const tags = container.containerVersion.tag ?? [];

  // Each forwarder tag should reference consent_state or ad_storage / analytics_storage
  const forwarderTags = tags.filter(
    (t) =>
      /ga4|meta|facebook|tiktok|google.*ads|bing/i.test(t.name) &&
      t.type !== "cvt_", // exclude custom client types that aren't forwarders
  );

  const withConsent = forwarderTags.filter((t) =>
    /consent_state|ad_storage|analytics_storage|consent_mode/i.test(tagBlob(t)),
  );

  if (forwarderTags.length > 0 && withConsent.length === 0) {
    issues.push({
      dimension: "consentForwarding",
      severity: "error",
      entity: "container",
      message: "No forwarder tags reference consent_state / ad_storage — Consent Mode v2 data not flowing to destinations",
    });
  } else if (withConsent.length < forwarderTags.length) {
    issues.push({
      dimension: "consentForwarding",
      severity: "warning",
      entity: "tags",
      message: `Only ${withConsent.length}/${forwarderTags.length} forwarders pass consent state`,
    });
  }

  const ratio =
    forwarderTags.length === 0 ? 0 : withConsent.length / forwarderTags.length;
  return { name: "consentForwarding", weight, score: ratio, issues };
}

// ── Dimension: Event normalization ───────────────────────────────────────────

function scoreEventNormalization(
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.10;

  if (!meta) {
    return {
      name: "eventNormalization",
      weight,
      score: 0.5,
      issues: [],
    };
  }

  // Check that significant Meta events have a corresponding tag path in server
  const significant = meta.conversion_events.filter(
    (e) => e.count_7d_click + e.count_1d_click + e.count_1d_view >= 10,
  );
  const tags = container.containerVersion.tag ?? [];
  const tagNames = tags.map((t) => t.name.toLowerCase());

  for (const ev of significant) {
    const found = tagNames.some((n) => n.includes(ev.event.toLowerCase()));
    if (!found) {
      issues.push({
        dimension: "eventNormalization",
        severity: "warning",
        entity: ev.event,
        message: `Server has no tag handling "${ev.event}" — event forwarded by default GA4/Meta client only`,
      });
    }
  }

  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 1 - warnings * 0.15);
  return { name: "eventNormalization", weight, score, issues };
}

// ── Dimension: Custom template safety ────────────────────────────────────────

function scoreTemplateSafety(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;

  const cvTemplates = (container.containerVersion as Record<string, unknown>).customTemplate;
  const templates = Array.isArray(cvTemplates)
    ? (cvTemplates as Array<{ name: string; templateData?: string }>)
    : [];

  if (templates.length === 0) {
    return { name: "templateSafety", weight, score: 1, issues };
  }

  for (const tpl of templates) {
    const data = tpl.templateData ?? "";
    if (!/___INFO___/.test(data) || !/permissions/i.test(data)) {
      issues.push({
        dimension: "templateSafety",
        severity: "warning",
        entity: tpl.name,
        message: "Custom template has no ___INFO___ / permissions block — cannot verify sandboxing",
      });
    }
    // Flag use of eval / Function
    if (/\beval\(|new Function\(/i.test(data)) {
      issues.push({
        dimension: "templateSafety",
        severity: "error",
        entity: tpl.name,
        message: "Template uses eval/new Function — unsafe",
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 1 - errors * 0.5 - warnings * 0.1);
  return { name: "templateSafety", weight, score, issues };
}

// ── Dimension: Request routing ───────────────────────────────────────────────

function scoreRequestRouting(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;

  const cvContainer = container.containerVersion.container as
    | { taggingServerUrls?: string[]; usageContext?: string[] }
    | undefined;
  const serverUrls = cvContainer?.taggingServerUrls ?? [];

  if (serverUrls.length === 0) {
    issues.push({
      dimension: "requestRouting",
      severity: "warning",
      entity: "container",
      message: "No taggingServerUrls declared — events route to default gtm.io endpoints (no first-party cookies)",
    });
  } else {
    for (const url of serverUrls) {
      if (!/^https:\/\/[^/]+\.[a-z]{2,}/i.test(url)) {
        issues.push({
          dimension: "requestRouting",
          severity: "error",
          entity: "container",
          message: `Invalid taggingServerUrl: ${url}`,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 1 - errors * 0.5 - warnings * 0.3);
  return { name: "requestRouting", weight, score, issues };
}

// ── Dimension: Variable hygiene ──────────────────────────────────────────────

function scoreVariableHygiene(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;
  const variables = container.containerVersion.variable ?? [];
  const tags = container.containerVersion.tag ?? [];

  const blob = JSON.stringify(tags);
  const refs = [...blob.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]);
  const varNames = new Set(variables.map((v) => v.name));
  const builtIn = new Set(
    (container.containerVersion.builtInVariable ?? []).map((b) => b.name),
  );
  const missing = [...new Set(refs)].filter(
    (r) => !varNames.has(r) && !builtIn.has(r),
  );
  if (missing.length > 0) {
    issues.push({
      dimension: "variableHygiene",
      severity: "warning",
      entity: "variables",
      message: `${missing.length} missing variable refs: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`,
    });
  }

  const ids = variables.map((v) => v.variableId);
  if (new Set(ids).size !== ids.length) {
    issues.push({
      dimension: "variableHygiene",
      severity: "error",
      entity: "variables",
      message: "Duplicate variable IDs",
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const score = Math.max(0, 1 - Math.min(missing.length / 10, 1) - errors * 0.5);
  return { name: "variableHygiene", weight, score, issues };
}

// ── Dimension: Naming ────────────────────────────────────────────────────────

function scoreNaming(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;
  const tags = container.containerVersion.tag ?? [];

  // Server-side convention: prefix with destination (GA4, Meta, TikTok, Google Ads)
  // or client/transformation type.
  const prefixed = tags.filter((t) =>
    /^(GA4|Meta|Facebook|FB|TikTok|GoogleAds|AW|Bing|Pinterest|Klaviyo|HTML|Stape|Pageview)[_\-\s]/i.test(
      t.name,
    ),
  );
  const ratio = tags.length ? prefixed.length / tags.length : 1;
  if (ratio < 0.7) {
    issues.push({
      dimension: "naming",
      severity: "warning",
      entity: "tags",
      message: `Only ${Math.round(ratio * 100)}% of tags use a destination prefix`,
    });
  }
  return { name: "naming", weight, score: ratio, issues };
}

// ── Main evaluate ────────────────────────────────────────────────────────────

export function evaluateBladeServer(
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
): GtmSignalQualityResult {
  const dimensions: DimensionScore[] = [
    scoreDataClientCoverage(container),
    scoreCapiConfig(container),
    scorePiiHashing(container),
    scoreConsentForwarding(container),
    scoreEventNormalization(container, meta),
    scoreTemplateSafety(container),
    scoreRequestRouting(container),
    scoreVariableHygiene(container),
    scoreNaming(container),
  ];

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const combinedScore =
    dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight;

  return {
    combinedScore,
    dimensions,
    issues: dimensions.flatMap((d) => d.issues),
    tagCount: (container.containerVersion.tag ?? []).length,
    triggerCount: (container.containerVersion.trigger ?? []).length,
    variableCount: (container.containerVersion.variable ?? []).length,
    folderCount: (container.containerVersion.folder ?? []).length,
  };
}

export default evaluateBladeServer;

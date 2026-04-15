/**
 * BLADE Web Container Eval (GTM-W9S77T7)
 *
 * Business: helicopter/flight charter service — lead-gen + high-ticket booking.
 * Not ecommerce. See content/clients/blade/profile.md.
 *
 * Dimensions weight lead capture and booking dedup heavily; no Shopify ecom assumptions.
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

function tagHasParamReferencing(tag: GtmTag, needle: string): boolean {
  return (tag.parameter ?? []).some((p) =>
    JSON.stringify(p).toLowerCase().includes(needle.toLowerCase()),
  );
}

function tagsByType(container: GtmContainer, type: string): GtmTag[] {
  return (container.containerVersion.tag ?? []).filter((t) => t.type === type);
}

function tagsByNameMatch(container: GtmContainer, re: RegExp): GtmTag[] {
  return (container.containerVersion.tag ?? []).filter((t) => re.test(t.name));
}

// ── Dimension: Lead capture quality ──────────────────────────────────────────

function scoreLeadCapture(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.20;

  // Must have at least one Meta Lead event tag
  const fbLeadTags = tagsByNameMatch(container, /\b(fb|meta|facebook|fbq).*lead\b/i);
  if (fbLeadTags.length === 0) {
    issues.push({
      dimension: "leadCapture",
      severity: "error",
      entity: "container",
      message: "No Meta Lead event tag found (expected tag whose name matches /meta|fb.*lead/i)",
    });
  }

  // Google Ads Lead conversion tag (AW-* with 'lead' in name)
  const gadsLeadTags = tagsByNameMatch(container, /google|aw[_-].*lead/i).filter(
    (t) => t.type === "awct" || t.type === "gclidw" || /lead/i.test(t.name),
  );
  if (gadsLeadTags.length === 0) {
    issues.push({
      dimension: "leadCapture",
      severity: "warning",
      entity: "container",
      message: "No Google Ads Lead conversion tag found",
    });
  }

  // fbclid / _fbp / _fbc persistence — look for variables reading those cookies
  const variables = container.containerVersion.variable ?? [];
  const haveFbp = variables.some((v) => /_fbp|fbp/i.test(v.name));
  const haveFbc = variables.some((v) => /_fbc|fbc|fbclid/i.test(v.name));
  if (!haveFbp) {
    issues.push({
      dimension: "leadCapture",
      severity: "error",
      entity: "variables",
      message: "No _fbp cookie/variable — Meta attribution will degrade for leads",
    });
  }
  if (!haveFbc) {
    issues.push({
      dimension: "leadCapture",
      severity: "error",
      entity: "variables",
      message: "No _fbc / fbclid variable — paid-click Lead attribution breaks",
    });
  }

  // user_data hashing — look for any tag referencing em, ph, fn, ln in user_data path
  const leadTags = [...fbLeadTags, ...gadsLeadTags];
  const leadTagsWithUserData = leadTags.filter((t) =>
    tagHasParamReferencing(t, "user_data"),
  );
  if (leadTags.length > 0 && leadTagsWithUserData.length === 0) {
    issues.push({
      dimension: "leadCapture",
      severity: "warning",
      entity: "leadTags",
      message: "No Lead tag passes user_data (em/ph/fn/ln) — identity matching will be weak",
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  // 4 possible errors (fb lead, fbp, fbc + user_data fallback); score penalizes errors heavier
  const score = Math.max(0, 1 - errors * 0.25 - warnings * 0.1);

  return { name: "leadCapture", weight, score, issues };
}

// ── Dimension: Booking conversion tracking ───────────────────────────────────

function scoreBookingConversion(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.20;

  // Must have Meta Purchase tag
  const fbPurchaseTags = tagsByNameMatch(container, /\b(fb|meta|facebook).*purchase\b/i);
  if (fbPurchaseTags.length === 0) {
    issues.push({
      dimension: "bookingConversion",
      severity: "error",
      entity: "container",
      message: "No Meta Purchase tag found",
    });
  }

  // Google Ads Purchase conversion (awct type)
  const awctTags = tagsByType(container, "awct");
  const gadsPurchaseTags = awctTags.filter((t) =>
    /purchase|paiement|booking|confirmed/i.test(t.name),
  );
  if (gadsPurchaseTags.length === 0) {
    issues.push({
      dimension: "bookingConversion",
      severity: "error",
      entity: "container",
      message: "No Google Ads Purchase conversion tag (awct type)",
    });
  }

  // Value + currency check on each purchase tag
  const purchaseTags = [...fbPurchaseTags, ...gadsPurchaseTags];
  for (const tag of purchaseTags) {
    const hasValue =
      tagParam(tag, "value") ||
      tagParam(tag, "conversionValue") ||
      tagHasParamReferencing(tag, "value");
    const hasCurrency =
      tagParam(tag, "currency") ||
      tagParam(tag, "currencyCode");

    if (!hasValue) {
      issues.push({
        dimension: "bookingConversion",
        severity: "error",
        entity: tag.name,
        message: "Purchase tag missing value — revenue attribution broken",
      });
    }
    if (!hasCurrency) {
      issues.push({
        dimension: "bookingConversion",
        severity: "warning",
        entity: tag.name,
        message: "Purchase tag missing currency/currencyCode",
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 1 - errors * 0.2 - warnings * 0.05);
  return { name: "bookingConversion", weight, score, issues };
}

// ── Dimension: Custom conversion parity ──────────────────────────────────────

function scoreCustomConversionParity(
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.15;

  if (!meta) {
    return {
      name: "customConversionParity",
      weight,
      score: 0.5,
      issues: [
        {
          dimension: "customConversionParity",
          severity: "info",
          entity: "meta",
          message: "No Meta snapshot — cannot verify custom conversion parity",
        },
      ],
    };
  }

  // BLADE-specific: any Meta event with >10 conversions / 30d is "significant"
  // The eval doesn't see custom conversion names in the snapshot currently,
  // so we check standard events + require named tags for {Lead, Purchase, InitiateCheckout, AddToCart, Search}
  const significantEvents = meta.conversion_events.filter(
    (e) => e.count_7d_click + e.count_1d_click + e.count_1d_view >= 10,
  );

  for (const ev of significantEvents) {
    // Is there a tag (any platform) that references this event name?
    const matchingTags = (container.containerVersion.tag ?? []).filter((t) =>
      new RegExp(`\\b${ev.event}\\b`, "i").test(t.name),
    );
    if (matchingTags.length === 0) {
      issues.push({
        dimension: "customConversionParity",
        severity: "warning",
        entity: ev.event,
        message: `Meta reports ${ev.count_7d_click}+ ${ev.event} events — no matching GTM tag by name`,
      });
    }
  }

  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 1 - warnings * 0.15);
  return { name: "customConversionParity", weight, score, issues };
}

// ── Dimension: Meta CAPI dedup ───────────────────────────────────────────────

function scoreCapiDedup(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.10;

  // Look for an event_id / eventID variable
  const variables = container.containerVersion.variable ?? [];
  const eventIdVar = variables.find((v) =>
    /event[_-]?id/i.test(v.name) || /event[_-]?id/i.test(v.type),
  );
  if (!eventIdVar) {
    issues.push({
      dimension: "capiDedup",
      severity: "error",
      entity: "variables",
      message: "No event_id variable — browser pixel and server CAPI cannot dedupe",
    });
  }

  // All Meta tags should reference the event_id variable
  const metaTags = tagsByNameMatch(container, /\b(fb|meta|facebook|fbq)\b/i);
  if (eventIdVar && metaTags.length > 0) {
    const varRef = `{{${eventIdVar.name}}}`;
    const tagsWithEventId = metaTags.filter((t) =>
      JSON.stringify(t.parameter ?? []).includes(varRef),
    );
    if (tagsWithEventId.length < metaTags.length) {
      issues.push({
        dimension: "capiDedup",
        severity: "error",
        entity: "metaTags",
        message: `Only ${tagsWithEventId.length}/${metaTags.length} Meta tags reference ${varRef} — dedup broken for the rest`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const score = Math.max(0, 1 - errors * 0.5);
  return { name: "capiDedup", weight, score, issues };
}

// ── Dimension: Consent Mode v2 ───────────────────────────────────────────────

function scoreConsent(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.10;
  const tags = container.containerVersion.tag ?? [];

  const consentInitTag = tags.find(
    (t) => t.type === "cm" || /consent.*init|cmp|onetrust|cookiebot/i.test(t.name),
  );
  if (!consentInitTag) {
    issues.push({
      dimension: "consent",
      severity: "error",
      entity: "container",
      message: "No Consent Mode v2 init tag (or CMP integration) detected",
    });
  }

  // Each ad/analytics tag should have consentSettings.consentStatus set
  const adOrAnalytics = tags.filter(
    (t) =>
      /awct|gclidw|sp$/i.test(t.type) ||
      /fbq|ga4|gaawe|googtag/i.test(t.type) ||
      /\b(fb|meta|ga4|google)\b/i.test(t.name),
  );
  const missing = adOrAnalytics.filter(
    (t) => !t.consentSettings || t.consentSettings.consentStatus !== "NEEDED",
  );
  if (missing.length > 0) {
    issues.push({
      dimension: "consent",
      severity: "error",
      entity: "tags",
      message: `${missing.length}/${adOrAnalytics.length} ad/analytics tags missing consentStatus=NEEDED`,
    });
  }

  const ratio =
    adOrAnalytics.length === 0
      ? 0
      : (adOrAnalytics.length - missing.length) / adOrAnalytics.length;
  const score = consentInitTag ? 0.4 + 0.6 * ratio : 0.6 * ratio;
  return { name: "consent", weight, score, issues };
}

// ── Dimension: Trigger quality ───────────────────────────────────────────────

function scoreTriggerQuality(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;
  const triggers = container.containerVersion.trigger ?? [];
  const tags = container.containerVersion.tag ?? [];

  const referenced = new Set<string>();
  for (const t of tags) {
    for (const id of t.firingTriggerId ?? []) referenced.add(id);
  }
  const orphaned = triggers.filter((tr) => !referenced.has(tr.triggerId));
  if (orphaned.length > 0) {
    issues.push({
      dimension: "triggerQuality",
      severity: "warning",
      entity: "triggers",
      message: `${orphaned.length} orphan triggers (not used by any tag)`,
    });
  }

  const ids = triggers.map((t) => t.triggerId);
  if (new Set(ids).size !== ids.length) {
    issues.push({
      dimension: "triggerQuality",
      severity: "error",
      entity: "triggers",
      message: "Duplicate trigger IDs",
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const ratio = triggers.length
    ? 1 - orphaned.length / triggers.length
    : 1;
  const score = Math.max(0, ratio - errors * 0.5);
  return { name: "triggerQuality", weight, score, issues };
}

// ── Dimension: Variable hygiene ──────────────────────────────────────────────

function scoreVariableHygiene(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;
  const variables = container.containerVersion.variable ?? [];
  const tags = container.containerVersion.tag ?? [];
  const triggers = container.containerVersion.trigger ?? [];

  // Check for missing references {{Name}} that don't exist
  const blob = JSON.stringify([tags, triggers]);
  const refs = [...blob.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]);
  const varNames = new Set(variables.map((v) => v.name));
  // Allow built-in variables
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

  const score = Math.max(
    0,
    1 - Math.min(missing.length / 20, 1) - issues.filter((i) => i.severity === "error").length * 0.5,
  );
  return { name: "variableHygiene", weight, score, issues };
}

// ── Dimension: Naming discipline ─────────────────────────────────────────────

function scoreNaming(container: GtmContainer): DimensionScore {
  const issues: GtmIssue[] = [];
  const weight = 0.05;
  const tags = container.containerVersion.tag ?? [];

  // BLADE's convention: Prefix by platform/service (AW_, Google_, WITHIN_, FR_, fb_)
  // Score: % of tags that have a recognizable prefix
  const prefixed = tags.filter((t) =>
    /^(AW|Google|WITHIN|FR|fb|Meta|TikTok|GA4|sGTM|HTML|CE|DLV|CJS|Cookie)[_\-\s]/i.test(
      t.name,
    ),
  );
  const ratio = tags.length ? prefixed.length / tags.length : 1;

  if (ratio < 0.7) {
    issues.push({
      dimension: "naming",
      severity: "warning",
      entity: "tags",
      message: `Only ${Math.round(ratio * 100)}% of tags use a platform/service prefix`,
    });
  }

  return { name: "naming", weight, score: ratio, issues };
}

// ── Main evaluate ────────────────────────────────────────────────────────────

export function evaluateBladeWeb(
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
): GtmSignalQualityResult {
  const dimensions: DimensionScore[] = [
    scoreLeadCapture(container),
    scoreBookingConversion(container),
    scoreCustomConversionParity(container, meta),
    scoreCapiDedup(container),
    scoreConsent(container),
    scoreTriggerQuality(container),
    scoreVariableHygiene(container),
    scoreNaming(container),
  ];

  // Google Ads parity — combined into bookingConversion already; keep one dimension
  // at 10% spare weight to keep total at 1.0
  // Total so far: 0.20+0.20+0.15+0.10+0.10+0.05+0.05+0.05 = 0.90
  // Add googleAdsCoverage dimension at 0.10
  const awctTags = (container.containerVersion.tag ?? []).filter((t) => t.type === "awct");
  const hasPurchase = awctTags.some((t) => /purchase|paiement|confirmed/i.test(t.name));
  const hasLead = awctTags.some((t) => /lead/i.test(t.name));
  const hasAtc = awctTags.some((t) => /atc|add.?to.?cart/i.test(t.name));
  const found = [hasPurchase, hasLead, hasAtc].filter(Boolean).length;
  const issues: GtmIssue[] = [];
  if (!hasPurchase) {
    issues.push({
      dimension: "googleAdsCoverage",
      severity: "error",
      entity: "container",
      message: "No Google Ads Purchase awct tag",
    });
  }
  if (!hasLead) {
    issues.push({
      dimension: "googleAdsCoverage",
      severity: "error",
      entity: "container",
      message: "No Google Ads Lead awct tag",
    });
  }
  dimensions.push({
    name: "googleAdsCoverage",
    weight: 0.10,
    score: found / 3,
    issues,
  });

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

// Default export for dynamic import in run-gtm-loop.ts
export default evaluateBladeWeb;

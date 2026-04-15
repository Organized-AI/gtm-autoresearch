/**
 * HRE Beauty Eval — thin wrapper around the original Shopify ecom eval.
 *
 * See content/clients/hre-beauty/profile.md for business context.
 * The original eval_gtm_signal_quality.ts is already tuned for Shopify ecom web
 * containers (8 ecom events, Consent Mode v2, GA4 + Meta + Google Ads).
 */

import {
  evaluateGtmSignalQuality,
  type GtmContainer,
  type GtmSignalQualityResult,
  type MetaAdsSnapshot,
} from "../eval_gtm_signal_quality.js";

export function evaluateHreBeauty(
  container: GtmContainer,
  meta?: MetaAdsSnapshot,
): GtmSignalQualityResult {
  return evaluateGtmSignalQuality(container, meta);
}

export default evaluateHreBeauty;

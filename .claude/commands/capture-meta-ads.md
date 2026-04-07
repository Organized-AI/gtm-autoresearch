# Capture Meta Ads → Experiment Logger

Pull live Meta Ads data for HRE Beauty and import into the experiment logger for fine-tuning.

## Steps

1. **Verify access** — Call `get_ad_accounts` via Pipeboard MCP to confirm HRE Beauty (`act_645790768357540`) is accessible.

2. **Pull ad insights** — Call `bulk_get_insights` with:
   - Account: `act_645790768357540`
   - Level: `ad`
   - Date range: last 30 days
   - Fields: `ad_id, ad_name, campaign_id, campaign_name, objective, adset_name, spend, impressions, clicks, ctr, cpc, actions (purchase), action_values (purchase), website_purchase_roas, actions (add_to_cart), actions (initiate_checkout)`

3. **Pull creative details** — Call `get_ad_creatives` for the account to get headline, body, CTA, image/video URLs for each ad.

4. **Join & transform** — For each ad, combine insights + creative data into `MetaAdRaw` format. Then apply the scoring formula from `src/meta-ads/transform.ts`:
   - Score = ROAS/5.0 (60%) + CTR/3.0 (20%) + convRate/0.05 (20%), clamped 0–1
   - Build problem: "Drive [objective] for HRE Beauty via campaign [name], ad set [adset]"
   - Build solution: "Ad [name]; headline: [title]; copy: [body]; CTA: [cta]; format: [video/image]; spend: $X, ROAS: X, CTR: X%"

5. **Write staging file** — Save the transformed `ExperimentRecord[]` array as JSON to `data/signals/meta-ads-experiments.json`.

6. **Import to logger** — Run:
   ```bash
   npx tsx scripts/experiment-logger.ts import --file data/signals/meta-ads-experiments.json --client hre
   ```

7. **Report results** — Run `npx tsx scripts/experiment-logger.ts count --client hre` and show:
   - Total records imported
   - Top 5 ads by score (name, campaign, score, ROAS, spend)
   - Date range covered
   - Any ads filtered out (zero spend)

## Notes
- Account ID: `act_645790768357540`
- Client ID for logger: `hre`
- Score calibration: HRE averages ~1.0 ROAS ($51K/$51K), so mean score ≈ 0.2. Top performers (3–5x ROAS) score 0.5–1.0.
- Re-running is safe — experiment logger uses INSERT OR IGNORE (idempotent by record ID).

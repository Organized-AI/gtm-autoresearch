// Jev-GTM client: the same question, prompt and normalization the Container Atlas uses,
// callable from Node, a Worker, or an agent script.
//   import { judge } from './jev-gtm/client.mjs'
//   await judge(findings, { provider: 'cloudflare', url: 'https://<your-atlas>/api/judge' })
//   await judge(findings)   // no options: your atlas (JEV_URL), your Cloudflare account, or the hosted atlas
import { readFileSync } from 'node:fs';
const Q = JSON.parse(readFileSync(new URL('./questions/finding-decision.json', import.meta.url), 'utf8'));
const T = JSON.parse(readFileSync(new URL('./thresholds.json', import.meta.url), 'utf8'));
const KEYS = Object.keys(Q.options);

export function prompt(findings) {
  return [
    'You review findings from a static Google Tag Manager container audit for a measurement team.',
    'For each finding, give a probability for each decision; they must sum to 1. Be calibrated: when the export alone cannot settle it, put weight on ask_owner.',
    'Decisions: ' + Object.entries(Q.options).map(([k, v]) => k + ' = ' + v).join(' '),
    'Findings (JSON): ' + JSON.stringify(findings.map(f => ({ key: f.key, element: f.name, kind: f.kind, check: f.check, severity: f.severity, container: f.container, finding: f.message }))),
    'Reply with JSON only: {"results":[{"key":"…","fix":0.0,"intended":0.0,"ask_owner":0.0}]}',
  ].join('\n');
}
export function normalize(key, p) {
  const v = KEYS.map(k => Math.max(0, Number(p[k]) || 0)), s = v.reduce((a, b) => a + b, 0) || 1, probs = {};
  KEYS.forEach((k, i) => { probs[k] = v[i] / s; });
  const choice = KEYS.reduce((a, b) => (probs[a] >= probs[b] ? a : b)), k = KEYS.length;
  const confidence = (k * probs[choice] - 1) / (k - 1);
  return { key, probabilities: probs, choice, decision: Q.maps_to_atlas_decision[choice], confidence, band: confidence >= T.auto ? 'confident' : confidence < T.ask ? 'unsure' : 'leaning' };
}
// Jev runs on Workers AI. Zero config: your own atlas Worker, then your Cloudflare account directly, then the hosted atlas.
export function resolve(env = process.env) {
  if (env.JEV_URL) return { provider: 'cloudflare', url: env.JEV_URL };
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) return { provider: 'workers-ai', account: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, model: env.JEV_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast' };
  return { provider: 'cloudflare', url: 'https://atlas.organizedai.vip/api/judge' };
}
export async function judge(findings, opts = {}) {
  if (!opts.provider) opts = { ...resolve(), ...opts };
  findings = findings.slice(0, 15);
  if (opts.provider === 'workers-ai') {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${opts.account}/ai/run/${opts.model}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + opts.token },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt(findings) }], max_tokens: 1600, temperature: 0 }) });
    const j = await r.json(); if (!r.ok || !j.success) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'Workers AI ' + r.status);
    let out = j.result && j.result.response; if (typeof out === 'string') out = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    return out.results.map(x => normalize(x.key, x));
  }
  const r = await fetch(opts.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ findings }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.message || 'Jev ' + r.status);
  return j.results.map(x => normalize(x.key, x.probabilities));
}

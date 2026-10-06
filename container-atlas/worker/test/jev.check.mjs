import * as J from '../src/jev.js';
import assert from 'node:assert/strict';
const env = { JEV_GATEWAY_TOKEN: 't' };
const seen = [];
const gw = (verdict, p, status = 200) => async (url, init) => {
  if (url.includes('/v1/rubrics/')) return new Response('{"error":{"code":"not_found"}}', { status: 404 });
  const b = JSON.parse(init.body); seen.push(b);
  assert.equal(b.claim.input_digest, await J.sha256Hex(b.input));
  assert.equal(b.claim.rubric_digest, await J.sha256Hex(J.canonicalJson(b.rubric)));
  assert.equal(init.headers.authorization, 'Bearer t');
  if (status !== 200) return new Response('{"error":{"code":"unauthorized"}}', { status });
  return new Response(JSON.stringify({ results: [{ verdict, reason: verdict === 'INCONCLUSIVE' ? 'below_verify_threshold' : null, evidence: { runs: [{ raw_probabilities: { yes: p, no: 1 - p } }] } }] }), { headers: { 'x-jev-gateway-request-id': 'req-1' } });
};
const f = { key: 'k1', context: 'web', severity: 'review', check: 'Unused', kind: 'trigger', name: 'Click - Call Button', type: 'LINK_CLICK', notes: 'Kept on purpose', message: 'No tag references this trigger' };
for (const [v, p, d] of [['VERIFIED', 0.93, 'fix'], ['REFUTED', 0.06, 'intended'], ['INCONCLUSIVE', 0.6, 'ask_owner']]) {
  J.resetRubricCache(); const out = await J.judgeFindings(env, [f], 'a.com', gw(v, p));
  assert.equal(out.results[0].decision, d); assert.equal(out.rubric.stage, 'shadow'); assert.equal(out.rubric.source, 'provisional'); assert.equal(out.results[0].requestId, 'req-1');
}
J.resetRubricCache(); let out = await J.judgeFindings(env, [f], 'a.com', gw('VERIFIED', 0.9, 401));
assert.equal(out.results[0].decision, 'ask_owner'); assert.equal(out.results[0].reason, 'unauthorized');
J.resetRubricCache(); out = await J.judgeFindings(env, [f], 'a.com', async (u) => { if (u.includes('/v1/rubrics/')) throw new Error('down'); throw new Error('down'); });
assert.equal(out.results[0].decision, 'ask_owner'); assert.equal(out.results[0].reason, 'gateway_unreachable');
J.resetRubricCache(); out = await J.judgeFindings(env, [f], 'a.com', async (u) => u.includes('/v1/rubrics/') ? new Response('{}') : new Response('{"results":[{"verdict":"MAYBE"}]}'));
assert.equal(out.results[0].decision, 'ask_owner'); assert.equal(out.results[0].reason, 'backend_response_invalid');
// A registry rubric with unknown controls is refused.
J.resetRubricCache();
await assert.rejects(J.judgeFindings(env, [f], 'a.com', async (u) => u.includes('/v1/rubrics/') ? Response.json({ status: 'active', rubric: { rubric_id: J.RUBRIC_ID, controls: [{ control_id: 'CTL-OTHER', input_digest: 'x' }] } }) : new Response('{}')), /rubric_controls_unknown/);
// Notes are data inside the state, never top-level instructions.
assert.ok(JSON.parse(seen[0].input).element.notes === 'Kept on purpose');
console.log('jev client: all checks pass');

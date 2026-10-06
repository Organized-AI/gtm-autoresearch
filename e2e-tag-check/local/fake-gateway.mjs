// Stand-in for jev-gateway /v1/decide: answers each choice by preferring the option whose description
// mentions the goal's key words. Also serves the test shop and swallows tag hits.
import http from 'node:http'; import fs from 'node:fs';
const log = [];
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    if (req.url === '/v1/decide') {
      const b = JSON.parse(body); log.push({ auth: req.headers.authorization, consumer: req.headers['x-jev-consumer'], model: b.model, types: Object.values(b.questions).map((q) => q.type) });
      fs.writeFileSync(new URL('./gw-log.json', import.meta.url), JSON.stringify(log, null, 1));
      const goal = JSON.stringify(b.state).toLowerCase();
      const answers = {};
      for (const [id, q] of Object.entries(b.questions)) {
        if (q.type === 'choice') {
          const keys = Object.keys(q.criteria);
          const score = (k) => { const d = JSON.stringify(q.criteria[k] ?? k).toLowerCase(); return (/add to cart/.test(d) ? 3 : 0) + (/coffee/.test(d) && !/cart: 1/.test(goal) ? 2 : 0) + (/^done$/.test(k) && /cart: 1 item/.test(goal) ? 5 : 0) + (/complete|yes|true|pass/.test(k + d) && /cart: 1 item/.test(goal) ? 4 : 0); };
          const best = keys.reduce((a, k) => (score(k) > score(a) ? k : a), keys[0]);
          const probs = Object.fromEntries(keys.map((k) => [k, k === best ? 0.9 : 0.1 / Math.max(1, keys.length - 1)]));
          if (keys.length === 1) probs[best] = 1;
          answers[id] = { type: 'choice', choice: best, probabilities: probs, confidence: 0.9 };
        } else if (q.type === 'noul') answers[id] = { type: 'noul', noul: /cart: 1 item/.test(goal) ? 0.95 : 0.1 };
        else answers[id] = { type: 'score', score: 0, probabilities: Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 0 ? 1 : 0])) };
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-jev-gateway-request-id': 'fake-' + log.length });
      return res.end(JSON.stringify({ request_id: 'fake', model: b.model, served_model: 'fake-jev', answers, usage: { input_tokens: 1, output_tokens: 0 } }));
    }
    const f = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    if (fs.existsSync(new URL('./site' + f, import.meta.url))) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(new URL('./site' + f, import.meta.url))); }
    res.writeHead(204); res.end();
  });
}).listen(8899, () => console.log('fake gateway + shop on :8899'));

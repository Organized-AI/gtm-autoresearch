(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    subtitle: $('run-subtitle'), status: $('run-status'), source: $('run-source'), seal: $('run-seal'), scopeIcon: $('scope-icon'), scopeMessage: $('scope-message'),
    records: $('metric-records'), recordsNote: $('metric-records-note'), attempts: $('metric-attempts'), attemptsNote: $('metric-attempts-note'), agreement: $('metric-agreement'), agreementNote: $('metric-agreement-note'), insufficient: $('metric-insufficient'), insufficientNote: $('metric-insufficient-note'),
    judgmentCount: $('judgment-count'), shadowCaption: $('shadow-caption'), currentEvent: $('current-event-summary'), replayDetail: $('replay-detail'), replayState: $('replay-state'), play: $('replay-play'), previous: $('replay-previous'), next: $('replay-next'), reset: $('replay-reset'), scrubber: $('replay-scrubber'), position: $('replay-position'), rail: $('event-rail'),
    list: $('judgment-list'), hint: $('judgment-hint'), detailTitle: $('detail-title'), detailBody: $('detail-body'), poll: $('poll-status'), pollIndicator: $('poll-indicator'),
    explanationNumber: $('explanation-number'), explanationKicker: $('explanation-kicker'), explanationTitle: $('explanation-title'), explanationText: $('explanation-text')
  };
  const state = { data: null, replayIndex: 0, playing: false, timer: null, selectedRecord: null, selectedFunction: 'evidenceSufficient' };
  const descriptions = {
    baseline: ['01', 'CONCEPTUAL ARCHITECTURE', 'Baseline', 'A future optimization loop starts from a known GTM container state. This node is shown to explain the architecture; no container baseline was executed by this shadow pilot.'],
    score: ['01', 'CONCEPTUAL ARCHITECTURE', 'Score', 'Deterministic scoring measures a candidate against defined dimensions. The shadow pilot did not score or optimize a GTM container.'],
    mutation: ['01', 'CONCEPTUAL ARCHITECTURE', 'Typed mutation', 'A bounded operation would propose a change through typed code. No mutation was requested, created, or applied by this pilot.'],
    validate: ['01', 'CONCEPTUAL ARCHITECTURE', 'Validate', 'Structural and deterministic checks would reject unsafe candidates before a policy decision. The pilot did not validate a container candidate.'],
    decision: ['01', 'CONCEPTUAL ARCHITECTURE', 'Keep / revert', 'This is a future policy boundary. Shadow results cannot enter it, alter its decision, or publish a GTM workspace.'],
    next: ['01', 'CONCEPTUAL ARCHITECTURE', 'Next round', 'A future loop could continue only after deterministic policy handling. This shadow pilot has no optimization rounds.'],
    evidence: ['02', 'EXECUTED SHADOW PIPELINE', 'Synthetic GTM / site / ads evidence', 'Frozen synthetic observations represented GTM, site, Meta, and Google evidence. The executor received observations without reading expected labels.'],
    preflight: ['02', 'EXECUTED SHADOW PIPELINE', 'Preflight', 'Preflight bound the frozen definitions, model configuration, run ceiling, and record identity before the recorded requests were dispatched.'],
    questions: ['02', 'EXECUTED SHADOW PIPELINE', 'Cloudflare Jev · two atomic questions', 'The pilot made two recorded judgments per observation: whether evidence was sufficient, and whether tracking behavior was preserved. Answers were journaled only.'],
    journal: ['02', 'EXECUTED SHADOW PIPELINE', 'Durable journal', 'Each attempt and completed record is preserved as a finite sequence. Replay below reads that sequence; it does not create a new event or provider request.'],
    comparison: ['02', 'EXECUTED SHADOW PIPELINE', 'Offline comparison', 'Expected synthetic labels were read after execution to measure agreement. The label status is unreviewed, so this is not human accuracy or calibration.']
  };

  const text = (node, value) => { node.textContent = value == null || value === '' ? '—' : String(value); };
  const number = (value) => typeof value === 'number' ? value.toLocaleString() : '—';
  const shortId = (value) => value ? String(value).slice(0, 12) : '—';
  const total = (usage) => usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens) ? usage.input_tokens + usage.output_tokens : null;
  const value = (obj, path) => path.reduce((a, key) => a && a[key] !== undefined ? a[key] : undefined, obj);
  const agreementText = (match) => match && Number.isFinite(match.matches) && Number.isFinite(match.denominator) && match.denominator ? `${Math.round((match.matches / match.denominator) * 100)}%` : '—';
  const pairedAgreementText = (score) => score && score.available && Number.isFinite(score.pairedMatches) && value(score, ['agreement', 'evidenceSufficient', 'denominator']) ? `${Math.round((score.pairedMatches / score.agreement.evidenceSufficient.denominator) * 100)}%` : '—';
  const shouldReduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function safeState(payload) {
    return payload && payload.schemaVersion === 'gtm-run-view-v1' && payload.run && Array.isArray(payload.events) && Array.isArray(payload.records);
  }

  function renderSummary(data) {
    const run = data.run || {};
    const score = data.score || {};
    const status = run.status || 'unavailable';
    const statusLabel = String(status).replace('_', ' ').toUpperCase();
    const isComplete = status === 'complete';
    const isActive = Boolean(run.active);
    const isUnavailable = status === 'unavailable';
    els.scopeMessage.parentElement.classList.toggle('is-unavailable', isUnavailable);
    els.scopeMessage.parentElement.classList.toggle('is-partial', status === 'partial');
    text(els.status, isComplete ? 'COMPLETE · READ ONLY' : isActive ? 'OBSERVED LOCK' : statusLabel);
    text(els.source, data.source === 'recorded-journal' ? 'Recorded journal' : (data.source || 'Unavailable'));
    els.seal.setAttribute('aria-label', isComplete ? 'Completed read-only recorded pilot' : isActive ? 'Observed active journal lock' : `${statusLabel} recorded journal`);
    els.scopeIcon.className = `scope-icon${isUnavailable ? ' is-unavailable' : status === 'partial' ? ' is-partial' : isActive ? ' is-active' : ''}`;
    text(els.scopeIcon, isComplete ? '✓' : isActive ? '◉' : status === 'partial' ? '!' : '×');
    text(els.scopeMessage, isComplete ? 'Completed recorded shadow pilot. This screen replays its stored sequence and cannot publish, mutate a container, or affect a keep/revert decision.' : isActive ? 'Observed active journal. This screen only polls the stored journal; it cannot create requests, publish, mutate a container, or affect a keep/revert decision.' : status === 'partial' ? 'Stopped or partial recorded journal. This screen only shows durable entries and cannot create requests, publish, mutate a container, or affect a keep/revert decision.' : 'Recorded journal state unavailable. This screen will not infer activity, create requests, publish, mutate a container, or affect a keep/revert decision.');
    text(els.subtitle, isComplete ? `Completed recorded pilot · ${run.id || 'run ID unavailable'} · ${run.model || 'model unavailable'}` : isActive ? `Observed journal lock · ${run.id || 'run ID unavailable'} · no optimizer activity is implied` : `${statusLabel} recorded journal · ${run.id || 'run ID unavailable'}`);
    text(els.records, number(run.totalRows)); text(els.recordsNote, isUnavailable ? 'journal unavailable' : `${number(run.completedRows)} completed`);
    text(els.attempts, number(run.attemptsFinished)); text(els.attemptsNote, isUnavailable ? 'journal unavailable' : `cap ${number(run.attemptCap)} · ${number(run.errors)} errors`);
    text(els.agreement, pairedAgreementText(score)); text(els.agreementNote, score.labelStatus || 'comparison unavailable');
    text(els.insufficient, number(score.insufficientAnswers)); text(els.insufficientNote, isUnavailable ? 'comparison unavailable' : 'recorded predictions');
    text(els.judgmentCount, number(data.records.length));
    text(els.shadowCaption, isComplete ? `Completed: ${number(run.completedRows)} records and ${number(run.attemptsFinished)} recorded attempts.` : isActive ? `Observed journal: ${number(run.completedRows)} durable records and ${number(run.attemptsFinished)} completed attempts.` : 'Recorded journal state is not complete.');
  }

  function activeEvent() { return state.data && state.data.events[state.replayIndex]; }
  function eventLabel(event) {
    if (!event) return 'No recorded event';
    const kind = String(event.kind || 'recorded event').replaceAll('-', ' ');
    const record = event.recordId ? ` · record ${shortId(event.recordId)}` : '';
    const fn = event.function ? ` · ${event.function}` : '';
    const answer = event.answer ? ` · answer ${event.answer}` : '';
    return `${kind}${record}${fn}${answer}`;
  }
  function updateReplayPipeline(event, has, totalEvents) {
    const nodeForKind = { 'run-started': 'preflight', 'attempt-started': 'questions', 'attempt-finished': 'journal', 'record-finished': 'journal' };
    document.querySelectorAll('.executed').forEach((node) => node.classList.remove('is-replay-current'));
    const node = event && nodeForKind[event.kind];
    if (node) { const activeNode = document.querySelector(`.executed[data-node="${node}"]`); if (activeNode) activeNode.classList.add('is-replay-current'); }
    text(els.currentEvent, has ? `RECORDED EVENT ${state.replayIndex + 1} / ${totalEvents} · ${eventLabel(event).toUpperCase()}` : 'NO RECORDED EVENT AVAILABLE');
  }
  function updateReplay() {
    const events = state.data ? state.data.events : [];
    const has = events.length > 0;
    state.replayIndex = Math.max(0, Math.min(state.replayIndex, Math.max(0, events.length - 1)));
    els.scrubber.max = String(Math.max(0, events.length - 1)); els.scrubber.value = String(state.replayIndex); els.scrubber.disabled = !has;
    els.play.disabled = !has; els.previous.disabled = !has || state.replayIndex === 0; els.next.disabled = !has || state.replayIndex >= events.length - 1; els.reset.disabled = !has;
    text(els.position, `${has ? state.replayIndex + 1 : 0} / ${events.length}`); text(els.replayDetail, has ? eventLabel(activeEvent()) : 'No recorded events are available.');
    text(els.replayState, state.playing ? 'PLAYING' : 'PAUSED'); els.play.innerHTML = state.playing ? '<span aria-hidden="true">Ⅱ</span> Pause replay' : '<span aria-hidden="true">▶</span> Play replay';
    updateReplayPipeline(activeEvent(), has, events.length);
    els.rail.replaceChildren();
    events.forEach((event, index) => { const dot = document.createElement('button'); dot.type = 'button'; dot.className = `event-dot ${event.kind || ''}${index === state.replayIndex ? ' is-current' : ''}`; dot.title = `Event ${index + 1}: ${eventLabel(event)}`; dot.setAttribute('aria-label', dot.title); dot.addEventListener('click', () => { pause(); state.replayIndex = index; updateReplay(); selectFromEvent(event); }); els.rail.append(dot); });
  }
  function selectFromEvent(event) { if (!event || !event.recordId) return; state.selectedRecord = event.recordId; state.selectedFunction = event.function || state.selectedFunction; renderJudgments(); renderDetail(); }
  function pause() { state.playing = false; if (state.timer) { window.clearInterval(state.timer); state.timer = null; } }
  function play() { if (!state.data || !state.data.events.length || shouldReduceMotion()) return; if (state.replayIndex >= state.data.events.length - 1) state.replayIndex = 0; state.playing = true; updateReplay(); state.timer = window.setInterval(() => { if (!state.data || state.replayIndex >= state.data.events.length - 1) { pause(); updateReplay(); return; } state.replayIndex += 1; const event = activeEvent(); updateReplay(); selectFromEvent(event); }, 850); }

  function renderJudgments() {
    const records = state.data ? state.data.records : [];
    els.list.replaceChildren();
    if (!records.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No completed records are available from the journal.'; els.list.append(p); return; }
    if (!state.selectedRecord) state.selectedRecord = records[0].recordId;
    records.forEach((record) => { const btn = document.createElement('button'); btn.type = 'button'; btn.className = `record-button${record.recordId === state.selectedRecord ? ' is-selected' : ''}`; const primary = document.createElement('div'); const id = document.createElement('strong'); id.textContent = shortId(record.recordId); const status = document.createElement('span'); status.textContent = record.status || 'recorded'; primary.append(id, status); const answer = document.createElement('span'); answer.className = 'answer-pair'; const a = record.answers || {}; answer.textContent = `Evidence ${a.evidenceSufficient || '—'} · Tracking ${a.trackingBehaviorPreserved || '—'}`; btn.append(primary, answer); btn.addEventListener('click', () => { state.selectedRecord = record.recordId; renderJudgments(); renderDetail(); }); els.list.append(btn); });
  }
  function field(label, content) { const div = document.createElement('div'); const span = document.createElement('span'); const strong = document.createElement('strong'); span.textContent = label; strong.textContent = content == null || content === '' ? '—' : String(content); div.append(span, strong); return div; }
  function probabilitiesText(probabilities) {
    if (!probabilities || typeof probabilities !== 'object' || !Object.keys(probabilities).length) return '—';
    return ['pass', 'fail', 'insufficient'].filter((label) => Number.isFinite(probabilities[label])).map((label) => `${label} ${Math.round(probabilities[label] * 100)}%`).join(' · ') || '—';
  }
  function renderDetail() {
    const record = state.data && state.data.records.find((item) => item.recordId === state.selectedRecord);
    els.detailBody.replaceChildren();
    if (!record) { text(els.detailTitle, 'No recorded judgment selected'); const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Select a completed record to inspect it.'; els.detailBody.append(p); return; }
    text(els.detailTitle, `Record ${shortId(record.recordId)}`); text(els.hint, `${record.status || 'recorded'} · select an atomic answer`);
    const common = document.createElement('div'); common.className = 'detail-grid'; common.append(field('Record ID', record.recordId), field('Reason code', record.reasonCode || 'not supplied')); els.detailBody.append(common);
    const evaluations = record.providerEvaluations || {};
    ['evidenceSufficient', 'trackingBehaviorPreserved'].forEach((fn) => { const meta = evaluations[fn] || {}; const card = document.createElement('section'); card.className = 'atomic-card'; const heading = document.createElement('h3'); heading.className = 'atomic-title'; heading.textContent = fn === 'evidenceSufficient' ? 'Evidence sufficient' : 'Tracking behavior preserved'; const answer = (record.answers || {})[fn]; const expected = (record.expectedAnswers || {})[fn]; const comparison = expected ? answer === expected ? 'Matches unreviewed synthetic label' : 'Differs from unreviewed synthetic label' : 'Unreviewed-label comparison unavailable'; const p = document.createElement('p'); p.textContent = `Recorded answer: ${answer || '—'} · ${comparison}`; const grid = document.createElement('div'); grid.className = 'detail-grid'; const usage = meta.usage || {}; grid.append(field('Expected answer', expected || '—'), field('Label comparison', comparison), field('Confidence', Number.isFinite(meta.confidence) ? `${Math.round(meta.confidence * 100)}%` : '—'), field('Probabilities', probabilitiesText(meta.probabilities)), field('Input / output tokens', `${number(usage.input_tokens)} / ${number(usage.output_tokens)}`), field('Total tokens', number(total(usage))), field('Request ID', meta.requestId || '—'), field('Reported model', meta.reportedModel || '—'), field('Latency', Number.isFinite(meta.latencyMs) ? `${Math.round(meta.latencyMs)} ms` : '—')); card.append(heading, p, grid); els.detailBody.append(card); });
  }

  function setUnavailable(message) {
    pause(); state.data = null; els.scopeMessage.parentElement.classList.add('is-unavailable'); els.scopeMessage.parentElement.classList.remove('is-partial'); text(els.status, 'UNAVAILABLE'); text(els.source, 'Local journal unavailable'); els.seal.setAttribute('aria-label', 'Recorded journal unavailable'); els.scopeIcon.className = 'scope-icon is-unavailable'; text(els.scopeIcon, '×'); text(els.scopeMessage, 'Recorded journal state unavailable. This screen will not infer activity, create requests, publish, mutate a container, or affect a keep/revert decision.'); text(els.subtitle, message); ['records','attempts','agreement','insufficient'].forEach((key) => text(els[key], '—')); text(els.recordsNote, 'journal unavailable'); text(els.attemptsNote, 'journal unavailable'); text(els.agreementNote, 'comparison unavailable'); text(els.insufficientNote, 'comparison unavailable'); text(els.judgmentCount, '—'); text(els.shadowCaption, 'The recorded journal is unavailable. No live run is implied.'); text(els.poll, 'Unable to read /api/state. Retrying every 3 seconds.'); els.pollIndicator.className = 'poll-indicator is-error'; updateReplay(); renderJudgments(); renderDetail();
  }
  async function refresh() {
    try { const response = await fetch('/api/state', { headers: { Accept: 'application/json' }, cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const data = await response.json(); if (!safeState(data)) throw new Error('unsupported state payload'); const previousLength = state.data ? state.data.events.length : 0; state.data = data; if (!state.selectedRecord && data.records[0]) state.selectedRecord = data.records[0].recordId; if (state.replayIndex >= previousLength && data.events.length) state.replayIndex = 0; renderSummary(data); updateReplay(); renderJudgments(); renderDetail(); text(els.poll, `Recorded journal checked ${new Date().toLocaleTimeString()}. Polling every 3 seconds.`); els.pollIndicator.className = 'poll-indicator'; } catch (error) { setUnavailable('The recorded pilot journal is unavailable. This screen will retry locally; it will not start an optimizer.'); }
  }
  function switchTab(which) { const diagram = which === 'diagram'; $('diagram-tab').classList.toggle('is-active', diagram); $('judgments-tab').classList.toggle('is-active', !diagram); $('diagram-tab').setAttribute('aria-selected', String(diagram)); $('judgments-tab').setAttribute('aria-selected', String(!diagram)); $('diagram-panel').hidden = !diagram; $('judgments-panel').hidden = diagram; }
  document.querySelectorAll('.flow-node').forEach((node) => node.addEventListener('click', () => { document.querySelectorAll('.flow-node').forEach((item) => item.classList.remove('is-selected')); node.classList.add('is-selected'); const detail = descriptions[node.dataset.node]; text(els.explanationNumber, detail[0]); text(els.explanationKicker, detail[1]); text(els.explanationTitle, detail[2]); text(els.explanationText, detail[3]); }));
  $('diagram-tab').addEventListener('click', () => switchTab('diagram')); $('judgments-tab').addEventListener('click', () => switchTab('judgments'));
  els.play.addEventListener('click', () => state.playing ? (pause(), updateReplay()) : play()); els.previous.addEventListener('click', () => { pause(); state.replayIndex -= 1; updateReplay(); selectFromEvent(activeEvent()); }); els.next.addEventListener('click', () => { pause(); state.replayIndex += 1; updateReplay(); selectFromEvent(activeEvent()); }); els.reset.addEventListener('click', () => { pause(); state.replayIndex = 0; updateReplay(); selectFromEvent(activeEvent()); }); els.scrubber.addEventListener('input', () => { pause(); state.replayIndex = Number(els.scrubber.value); updateReplay(); selectFromEvent(activeEvent()); });
  refresh(); window.setInterval(refresh, 3000);
})();

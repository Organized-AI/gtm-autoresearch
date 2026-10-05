// Drift digests. The same shape is built from a GTM export (the baseline, in the browser)
// and from the published gtm.js (the live container, in the Worker), so the two compare
// directly. gtm.js carries tag IDs, types, paused state and firing events, not names.
var GTM_DRIFT = (function () {
  'use strict';
  var BUILTIN = { '2147479553': 'gtm.js', '2147479573': 'gtm.init', '2147479572': 'gtm.init_consent' };
  var TRIGGER_EVENT = { PAGEVIEW: 'gtm.js', DOM_READY: 'gtm.dom', WINDOW_LOADED: 'gtm.load', CLICK: 'gtm.click', LINK_CLICK: 'gtm.linkClick', FORM_SUBMISSION: 'gtm.formSubmit', HISTORY_CHANGE: 'gtm.historyChange', TIMER: 'gtm.timer', SCROLL_DEPTH: 'gtm.scrollDepth', ELEMENT_VISIBILITY: 'gtm.elementVisibility', YOU_TUBE_VIDEO: 'gtm.video', JS_ERROR: 'gtm.pageError', INIT: 'gtm.init', CONSENT_INIT: 'gtm.init_consent' };
  var ID_RE = /\b(G-[A-Z0-9]{6,12}|AW-\d{6,12}|DC-\d{5,10}|GT-[A-Z0-9]{6,12})\b/g;
  function strings(v, out) { out = out || []; if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { strings(v[k], out); }); return out; }
  function hostsAndIds(values) {
    var hosts = {}, ids = {};
    values.forEach(function (s) {
      (s.match(ID_RE) || []).forEach(function (m) { ids[m] = 1; });
    });
    return { hosts: hosts, ids: ids };
  }
  function serverHost(u) { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).host.toLowerCase(); } catch (e) { return null; } }
  function sorted(o) { return Object.keys(o).sort(); }

  /* ---------- baseline from an export ---------- */
  function fromExport(cv) {
    var trig = {}; (cv.trigger || []).forEach(function (t) { trig[t.triggerId] = t; });
    var eventsOf = function (id) {
      if (BUILTIN[id]) return [BUILTIN[id]];
      var t = trig[id]; if (!t) return ['(unknown)'];
      if (t.type === 'CUSTOM_EVENT') {
        var ev = (t.customEventFilter || []).map(function (c) { var a = {}; (c.parameter || []).forEach(function (p) { a[p.key] = p.value; }); return c.type === 'EQUALS' ? a.arg1 : '(pattern)'; });
        return ev.length ? ev : ['(any)'];
      }
      return [TRIGGER_EVENT[t.type] || '(other)'];
    };
    var tags = {}, endpoints = {}, ids = {};
    (cv.tag || []).forEach(function (t) {
      var ev = {}; (t.firingTriggerId || []).forEach(function (id) { eventsOf(String(id)).forEach(function (e) { ev[e] = 1; }); });
      tags[t.tagId] = { type: t.type, paused: !!t.paused, events: sorted(ev) };
      if (t.paused) return;
      var vals = strings(t.parameter || []);
      vals.forEach(function (s) { (s.match(ID_RE) || []).forEach(function (m) { ids[m] = 1; }); });
      (t.parameter || []).forEach(function (p) { strings(p).forEach(function (s) { if (/server_container_url|gtm_server_domain/.test(JSON.stringify(p)) && /^https?:\/\//.test(s)) { var h = serverHost(s); if (h) endpoints[h] = 1; } }); });
    });
    (cv.variable || []).forEach(function (v) { if (v.type === 'c') strings(v.parameter || []).forEach(function (s) { (s.match(ID_RE) || []).forEach(function (m) { ids[m] = 1; }); }); });
    return { version: String(cv.containerVersionId || ''), tags: tags, endpoints: sorted(endpoints), ids: sorted(ids) };
  }

  /* ---------- live digest from gtm.js ---------- */
  function extract(js) {
    var i = js.indexOf('var data = '); if (i < 0) throw new Error('This does not look like a published GTM container.');
    i += 11; var d = 0, j = i, inS = false, esc = false;
    for (; j < js.length; j++) {
      var c = js[j];
      if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inS = false; continue; }
      if (c === '"') inS = true; else if (c === '{') d++; else if (c === '}') { d--; if (!d) { j++; break; } }
    }
    return JSON.parse(js.slice(i, j)).resource;
  }
  function fromGtmJs(js) {
    var r = extract(js), macros = r.macros || [], preds = r.predicates || [], rules = r.rules || [];
    var isEvent = function (arg) { return Array.isArray(arg) && arg[0] === 'macro' && macros[arg[1]] && macros[arg[1]].function === '__e'; };
    var ev = {};
    rules.forEach(function (rule) {
      var ifs = [], adds = [];
      rule.forEach(function (part) { if (part[0] === 'if') ifs = part.slice(1); if (part[0] === 'add') adds = part.slice(1); });
      var events = ifs.map(function (pi) { var p = preds[pi]; return p && isEvent(p.arg0) ? (p.function === '_eq' ? p.arg1 : '(pattern)') : null; }).filter(Boolean);
      if (!events.length) events = ['(any)'];
      adds.forEach(function (ti) { ev[ti] = ev[ti] || {}; events.forEach(function (e) { ev[ti][e] = 1; }); });
    });
    var tags = {}, endpoints = {}, ids = {};
    (r.tags || []).forEach(function (t, idx) {
      if (t.tag_id == null) return;
      var paused = t.function === '__paused', type = paused ? null : String(t.function || '').replace(/^__/, '');
      tags[t.tag_id] = { type: type, paused: paused, events: sorted(ev[idx] || {}) };
      if (paused) return;
      Object.keys(t).forEach(function (k) {
        if (!/^vtp_/.test(k)) return;
        var vals = strings(t[k]);
        vals.forEach(function (s) { (s.match(ID_RE) || []).forEach(function (m) { ids[m] = 1; }); });
        if (/server_container_url|gtm_server_domain|serverContainerUrl/.test(k + JSON.stringify(t[k]))) vals.forEach(function (s) { if (/^https?:\/\//.test(s)) { var h = serverHost(s); if (h) endpoints[h] = 1; } });
      });
    });
    macros.forEach(function (m) { if (m.function === '__c') strings(m.vtp_value || '').forEach(function (s) { (s.match(ID_RE) || []).forEach(function (x) { ids[x] = 1; }); }); });
    return { version: String(r.version || ''), tags: tags, endpoints: sorted(endpoints), ids: sorted(ids) };
  }

  /* ---------- compare ---------- */
  var LABEL = { html: 'Custom HTML', img: 'Custom Image', gaawe: 'GA4 event', googtag: 'Google tag', awct: 'Google Ads conversion', sp: 'Google Ads remarketing', gclidw: 'Conversion Linker', fls: 'Floodlight sales', flc: 'Floodlight counter', baut: 'Microsoft Ads', bzi: 'LinkedIn Insight', hjtc: 'Hotjar', awcc: 'Google Ads call', qca: 'Quantcast', ua: 'Universal Analytics', cl: 'Click listener', lcl: 'Link click listener', fsl: 'Form listener', hl: 'History listener', sdl: 'Scroll listener', tl: 'Timer listener', ytl: 'YouTube listener', evl: 'Visibility listener' };
  var LISTENER = { cl: 1, lcl: 1, fsl: 1, hl: 1, sdl: 1, tl: 1, ytl: 1, evl: 1, jel: 1 };
  function typeLabel(t) { return t ? (LABEL[t] || (/^cvt_/.test(t) ? 'Template tag' : t)) : 'Paused tag'; }
  function describe(id, t, names) { return (names && names[id] ? '"' + names[id] + '"' : typeLabel(t.type) + ' #' + id); }
  function compare(base, live, names) {
    var changes = [];
    var add = function (severity, kind, message, id) { changes.push({ severity: severity, kind: kind, message: message, tagId: id || null }); };
    if (base.version && live.version && base.version !== live.version) add('info', 'version', 'Published version is now ' + live.version + ' (baseline ' + base.version + ').');
    Object.keys(live.tags).forEach(function (id) {
      var l = live.tags[id], b = base.tags[id];
      if (LISTENER[l.type]) return;
      if (!b) { if (!l.paused) add('review', 'added', 'Added: ' + typeLabel(l.type) + ' #' + id + ', fires on ' + (l.events.join(', ') || 'no event') + '.', id); return; }
      if (b.paused !== l.paused) add('review', l.paused ? 'paused' : 'unpaused', (l.paused ? 'Paused: ' : 'Unpaused: ') + describe(id, b, names) + '.', id);
      else if (!l.paused && b.type && l.type && b.type !== l.type) add('review', 'type', 'Type changed: ' + describe(id, b, names) + ' is now ' + typeLabel(l.type) + '.', id);
      else if (!l.paused) {
        var known = function (a) { return a.filter(function (e) { return e.charAt(0) !== '('; }); };
        var be = known(b.events), le = known(l.events);
        if (be.length && le.length && be.join() !== le.join()) add('review', 'firing', 'Firing changed: ' + describe(id, b, names) + ' fired on ' + be.join(', ') + ', now ' + le.join(', ') + '.', id);
      }
    });
    Object.keys(base.tags).forEach(function (id) { if (!live.tags[id] && !base.tags[id].paused) add('review', 'removed', 'Removed: ' + describe(id, base.tags[id], names) + ' is no longer in the published container.', id); });
    var diff = function (a, b) { return a.filter(function (x) { return b.indexOf(x) < 0; }); };
    diff(live.endpoints, base.endpoints).forEach(function (h) { add('critical', 'endpoint', 'New server endpoint: tags now send to ' + h + '.'); });
    diff(base.endpoints, live.endpoints).forEach(function (h) { add('critical', 'endpoint', 'Server endpoint ' + h + ' is no longer used by any published tag.'); });
    diff(live.ids, base.ids).forEach(function (x) { add('review', 'id', 'New measurement ID in the published container: ' + x + '.'); });
    diff(base.ids, live.ids).forEach(function (x) { add('review', 'id', 'Measurement ID ' + x + ' no longer appears in the published container.'); });
    return changes;
  }
  return { fromExport: fromExport, fromGtmJs: fromGtmJs, compare: compare };
})();
if (typeof module !== 'undefined') module.exports = GTM_DRIFT;

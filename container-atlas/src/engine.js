// GTM audit engine. Turns a web GTM export, and optionally a server (sGTM) export,
// into the atlas data model: per-container nodes, links and findings, a web → server
// signal flow, and the stripped rows the autoresearch loop needs. Runs in the browser;
// nothing is uploaded. Read-only: it never changes the exports it is given.
var GTM_ENGINE = (function (AUTO) {
  'use strict';
  var BUILTIN_TRIGGERS = { '2147479553': 'All Pages', '2147479572': 'Consent Initialization - All Pages', '2147479573': 'Initialization - All Pages' };
  var IDK = { tag: 'tagId', trigger: 'triggerId', variable: 'variableId', client: 'clientId' };
  var SEV = { critical: 0, review: 1, info: 2 };
  var VENDOR_HOSTS = /(^|\.)(google|googleapis|googletagmanager|google-analytics|doubleclick|googlesyndication|googleadservices|gstatic|youtube|facebook|fbcdn|facebook\.net|meta|instagram|linkedin|licdn|twitter|t\.co|x\.com|bing|microsoft|clarity|tiktok|pinterest|snapchat|sc-static|reddit|redditstatic|hotjar|stape|adsrvr|criteo|quantserve|taboola|outbrain|cloudflare|jsdelivr|unpkg|jquery|amazon-adsystem|klaviyo|segment|hubspot|hs-scripts|onetrust|cookielaw|termly|cookiebot|w3|schema|example|tvsquared|bidr|blackcrow|everflow)\.[a-z.]+$/i;

  /* ---------- small helpers ---------- */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function hash(s) { // two FNV-1a passes → 20 hex chars; only used to compare settings within one page
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
    return (h1.toString(16) + h2.toString(16) + '00000000000000000000').slice(0, 20);
  }
  var SKIP_KEYS = { accountId: 1, containerId: 1, tagId: 1, triggerId: 1, variableId: 1, clientId: 1, name: 1, fingerprint: 1, parentFolderId: 1, tagManagerUrl: 1, path: 1, notes: 1, workspaceId: 1, monitoringMetadata: 1, formatValue: 1 };
  function settings(row) { var o = {}; Object.keys(row).forEach(function (k) { if (!SKIP_KEYS[k]) o[k] = row[k]; }); return o; }
  function refsOf(row) {
    var out = [];
    (function scan(v) { if (typeof v === 'string') v.replace(/\{\{([^{}]+)\}\}/g, function (_, n) { out.push(n); }); else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (k !== 'name' || typeof v[k] !== 'string' || v === row) scan(v[k]); }); })(settings(row));
    return out;
  }
  function param(row, key) { var p = (row.parameter || []).filter(function (x) { return x.key === key; })[0]; return p ? p.value : undefined; }
  function listParam(row, key) {
    var p = (row.parameter || []).filter(function (x) { return x.key === key; })[0], out = {};
    ((p && p.list) || []).forEach(function (m) { var kv = {}; (m.map || []).forEach(function (e) { kv[e.key] = e.value; }); var k = kv.parameter || kv.name || kv.key, v = kv.parameterValue || kv.value; if (k) out[k] = v; });
    return out;
  }
  function allStrings(row) { var out = []; (function scan(v) { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { scan(v[k]); }); })(row); return out; }
  function hostOf(u) { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).host.toLowerCase(); } catch (e) { return null; } }
  function rootDomain(h) {
    if (!h) return null; h = h.replace(/^www\./, '').replace(/:\d+$/, '');
    var p = h.split('.'); if (p.length <= 2) return h;
    var two = p.slice(-2).join('.'); if (/^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(two)) return p.slice(-3).join('.');
    return two;
  }
  function conditions(tr) { return [].concat(tr.customEventFilter || [], tr.filter || [], tr.autoEventFilter || []); }
  function condArgs(c) { var a = {}; (c.parameter || []).forEach(function (p) { a[p.key] = p.value; }); return a; }

  /* ---------- reading an export ---------- */
  function parseExport(text) {
    var doc;
    try { doc = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('That file is not valid JSON. Export it from GTM: Admin → Export Container.'); }
    var cv = doc && (doc.containerVersion || (doc.tag || doc.trigger || doc.variable ? doc : null));
    if (!cv || !(cv.tag || cv.trigger || cv.variable || cv.client)) throw new Error('This JSON is not a GTM container export. In GTM, open Admin → Export Container and choose a version or workspace.');
    var c = cv.container || {}, ctx = (c.usageContext || []).join(',').toUpperCase();
    var context = /SERVER/.test(ctx) || (cv.client && cv.client.length) ? 'server' : /WEB/.test(ctx) || !ctx ? 'web' : ctx.toLowerCase();
    return {
      doc: doc, cv: cv,
      info: { name: c.name || cv.name || 'Untitled container', publicId: c.publicId || ('GTM-' + (cv.containerId || 'UNKNOWN')), context: context,
        accountId: cv.accountId || c.accountId || '', containerId: cv.containerId || c.containerId || '', version: cv.containerVersionId || '', versionName: cv.name || '', exportTime: doc.exportTime || '' },
      counts: { tags: (cv.tag || []).length, triggers: (cv.trigger || []).length, variables: (cv.variable || []).length, clients: (cv.client || []).length, folders: (cv.folder || []).length },
    };
  }

  /* ---------- website detection ---------- */
  function detectWebsite(webCv, serverCv) {
    var score = {}, why = {};
    var add = function (host, w, src) { var d = rootDomain(host); if (!d || VENDOR_HOSTS.test(d) || /^(localhost|\d+\.\d+)/.test(d) || d.indexOf('.') < 0) return; score[d] = (score[d] || 0) + w; (why[d] = why[d] || {})[src] = 1; };
    var c = (webCv && webCv.container) || {};
    if (c.name && /\.[a-z]{2,}$/i.test(c.name)) add(c.name, 6, 'container name');
    (webCv ? webCv.tag || [] : []).forEach(function (t) {
      var srv = listParam(t, 'configSettingsTable').server_container_url || param(t, 'gtm_server_domain') || param(t, 'server_container_url');
      if (srv) add(hostOf(srv), 5, 'server endpoint');
      allStrings(t.parameter || []).forEach(function (s) { (s.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach(function (u) { add(hostOf(u), 1, 'tag settings'); }); });
    });
    (webCv ? webCv.trigger || [] : []).forEach(function (tr) {
      conditions(tr).forEach(function (cnd) { var a = condArgs(cnd); if (/Page (Hostname|URL)|Referrer/i.test(a.arg0 || '') && a.arg1) (String(a.arg1).match(/[a-z0-9-]+(\.[a-z0-9-]+)+/gi) || []).forEach(function (h) { add(h, 3, 'trigger conditions'); }); });
    });
    if (serverCv) (serverCv.client || []).forEach(function (cl) { allStrings(cl.parameter || []).forEach(function (s) { (s.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach(function (u) { add(hostOf(u), 2, 'server client'); }); }); });
    return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).slice(0, 5).map(function (d) { return { domain: d, score: score[d], sources: Object.keys(why[d]) }; });
  }

  /* ---------- vendors ---------- */
  var TYPE_VENDOR = { gaawe: 'Google Analytics 4', gaawc: 'Google Analytics 4', ua: 'Universal Analytics', awct: 'Google Ads', sp: 'Google Ads', awcc: 'Google Ads', gclidw: 'Google Ads', awud: 'Google Ads',
    flc: 'Floodlight', fls: 'Floodlight', baut: 'Microsoft Ads', bzi: 'LinkedIn', hjtc: 'Hotjar', twitter_website_tag: 'X (Twitter)', qca: 'Quantcast', img: 'Image pixel', sgtmgaaw: 'Google Analytics 4', sgtmadsct: 'Google Ads', sgtmfls: 'Floodlight' };
  var NAME_VENDOR = [[/meta|facebook|\bfb\b/i, 'Meta'], [/linkedin|\bli\b/i, 'LinkedIn'], [/tiktok/i, 'TikTok'], [/twitter|\bx\b pixel/i, 'X (Twitter)'], [/pinterest/i, 'Pinterest'], [/snap/i, 'Snapchat'], [/reddit/i, 'Reddit'], [/bing|microsoft/i, 'Microsoft Ads'], [/hotjar/i, 'Hotjar'], [/klaviyo/i, 'Klaviyo'], [/ga4|google analytics/i, 'Google Analytics 4'], [/google ads|adwords/i, 'Google Ads'], [/floodlight|cm360|doubleclick/i, 'Floodlight'], [/trade ?desk|ttd/i, 'The Trade Desk']];
  var HTML_VENDOR = [[/facebook\.net|fbq\(/i, 'Meta'], [/licdn|linkedin/i, 'LinkedIn'], [/tiktok|ttq\./i, 'TikTok'], [/twitter|twq\(/i, 'X (Twitter)'], [/bat\.bing|uetq/i, 'Microsoft Ads'], [/hotjar/i, 'Hotjar'], [/pinterest|pintrk/i, 'Pinterest'], [/snaptr|sc-static/i, 'Snapchat'], [/redditstatic|rdt\(/i, 'Reddit'], [/adsrvr/i, 'The Trade Desk'], [/klaviyo/i, 'Klaviyo']];
  function vendorOf(t, server) {
    if (t.type === 'googtag') { var id = String(param(t, 'tagId') || ''); return /^AW-/.test(id) ? 'Google Ads' : /^DC-/.test(id) ? 'Floodlight' : 'Google Analytics 4'; }
    if (TYPE_VENDOR[t.type]) return TYPE_VENDOR[t.type];
    if (t.type === 'html') { var h = String(param(t, 'html') || ''); for (var i = 0; i < HTML_VENDOR.length; i++) if (HTML_VENDOR[i][0].test(h)) return HTML_VENDOR[i][1]; return 'Custom HTML'; }
    if (isDataTag(t)) return 'Server container';
    for (var j = 0; j < NAME_VENDOR.length; j++) if (NAME_VENDOR[j][0].test(t.name)) return NAME_VENDOR[j][1] + (server && /CAPI|conversion|events api/i.test(t.name) && !/CAPI/.test(NAME_VENDOR[j][1]) ? '' : '');
    return /^cvt_/.test(t.type) ? 'Template' : t.type;
  }
  function destOf(t) { var v = vendorOf(t, true); return v === 'Meta' ? 'Meta CAPI' : v === 'LinkedIn' ? 'LinkedIn CAPI' : v === 'TikTok' ? 'TikTok Events API' : v; }
  function isDataTag(t) { return /^cvt_/.test(t.type) && (param(t, 'gtm_server_domain') !== undefined || /data tag/i.test(t.name)); }

  /* ---------- stripped rows for the scoring engine ---------- */
  function strip(cv) {
    var out = { publicId: (cv.container || {}).publicId, tag: [], trigger: [], variable: [], folder: (cv.folder || []).map(function (f) { return { folderId: String(f.folderId), name: f.name }; }), builtInVariable: (cv.builtInVariable || []).map(function (b) { return { name: b.name }; }), vendor: {} };
    var server = !!(cv.client && cv.client.length) || /SERVER/i.test(((cv.container || {}).usageContext || []).join());
    (cv.tag || []).forEach(function (t) {
      var r = { tagId: String(t.tagId), name: t.name, type: t.type, refs: refsOf(t).map(function (n) { return '{{' + n + '}}'; }).join(' '), sig: hash(stable(settings(t))) };
      if (t.parentFolderId) r.parentFolderId = String(t.parentFolderId);
      if (t.paused) r.paused = true;
      if (t.firingTriggerId) r.firingTriggerId = t.firingTriggerId.map(String);
      if (t.blockingTriggerId) r.blockingTriggerId = t.blockingTriggerId.map(String);
      if (t.setupTag) r.setupTag = t.setupTag; if (t.teardownTag) r.teardownTag = t.teardownTag;
      out.tag.push(r); out.vendor[r.tagId] = vendorOf(t, server);
    });
    ['trigger', 'variable'].forEach(function (k) {
      (cv[k] || []).forEach(function (row) {
        var r = { name: row.name, type: row.type, refs: refsOf(row).map(function (n) { return '{{' + n + '}}'; }).join(' '), sig: hash(stable(settings(row))) };
        r[IDK[k]] = String(row[IDK[k]]); if (row.parentFolderId) r.parentFolderId = String(row.parentFolderId);
        out[k].push(r);
      });
    });
    return out;
  }

  /* ---------- parameter integrity checks ---------- */
  var REQUIRED = { gaawe: ['eventName'], googtag: ['tagId'], awct: ['conversionId', 'conversionLabel'], sp: ['conversionId'], fls: ['advertiserId', 'groupTag', 'activityTag'], flc: ['advertiserId', 'groupTag', 'activityTag'], baut: ['tagId'], gaawc: ['measurementId'] };
  var LABEL = { eventName: 'event name', tagId: 'tag ID', conversionId: 'conversion ID', conversionLabel: 'conversion label', advertiserId: 'advertiser ID', groupTag: 'group tag', activityTag: 'activity tag', measurementId: 'measurement ID' };
  function paramChecks(cv, website) {
    var f = [], add = function (kind, row, severity, message) { f.push({ dimension: 'parameters', severity: severity, kind: kind, id: String(row[IDK[kind]]), name: row.name, message: message }); };
    var site = rootDomain(website || '');
    var consts = {}; (cv.variable || []).forEach(function (v) { if (v.type === 'c') { var val = param(v, 'value'); if (val) (consts[String(val).trim()] = consts[String(val).trim()] || []).push(v.name); } });
    var literals = {};
    (cv.tag || []).forEach(function (t) {
      (REQUIRED[t.type] || []).forEach(function (k) { var v = param(t, k); if (v === undefined || String(v).trim() === '') add('tag', t, 'critical', 'Required setting "' + (LABEL[k] || k) + '" is blank, so this tag cannot send a valid hit.'); });
      if (t.type === 'gaawe') { var en = String(param(t, 'eventName') || ''); if (en && en.indexOf('{{') < 0 && !/^[a-z][a-z0-9_]*$/.test(en)) add('tag', t, 'review', 'GA4 event name "' + en + '" is not snake_case. GA4 is case-sensitive, so it will report as a separate event from the standard name.'); }
      if (t.type !== 'html') (t.parameter || []).forEach(function (p) {
        allStrings(p).forEach(function (s) {
          var m = s.match(/^(G-[A-Z0-9]{6,12}|AW-\d{6,12}|DC-\d{5,10}|UA-\d{4,10}-\d{1,3})$/) || (/pixel/i.test(p.key || '') && s.match(/^\d{15,16}$/));
          if (m) (literals[m[0]] = literals[m[0]] || []).push(t);
        });
      });
      var srv = listParam(t, 'configSettingsTable').server_container_url || listParam(t, 'eventSettingsTable').server_container_url || param(t, 'gtm_server_domain') || param(t, 'server_container_url');
      if (srv && srv.indexOf('{{') < 0 && site) { var h = hostOf(srv); if (h && rootDomain(h) !== site) add('tag', t, 'review', 'Sends server-side data to ' + h + ', which is not a first-party subdomain of ' + site + '. Cookies set by the server container will not be first-party.'); }
    });
    Object.keys(literals).forEach(function (lit) {
      var tags = literals[lit].filter(function (t, i, a) { return a.indexOf(t) === i; });
      tags.forEach(function (t) {
        if (consts[lit]) add('tag', t, 'review', 'Hardcodes ' + lit + ' although the Constant {{' + consts[lit][0] + '}} holds the same value. Reference the variable so one edit updates every tag.');
        else if (tags.length >= 2) add('tag', t, 'info', 'Hardcodes ' + lit + ', also typed into ' + (tags.length - 1) + ' other tag' + (tags.length > 2 ? 's' : '') + '. A Constant variable keeps them in step.');
      });
    });
    (cv.variable || []).forEach(function (v) {
      if (v.type === 'v' && !String(param(v, 'name') || '').trim()) add('variable', v, 'critical', 'Data layer variable has no key, so it always returns undefined.');
      if (v.type === 'ed' && !String(param(v, 'keyPath') || '').trim()) add('variable', v, 'critical', 'Event data variable has no key path, so it always returns undefined.');
      if (v.type === 'c') {
        var val = String(param(v, 'value') || '');
        if (!val.trim()) add('variable', v, 'review', 'Constant has no value.');
        else if (/token|secret|api[ _-]?key|password/i.test(v.name) || /^EAA[A-Za-z0-9]{20,}$/.test(val)) add('variable', v, 'review', 'Stores an access token in plain text. Anyone who can read or export this container can see it; keep it in a secret store or server environment variable.');
      }
      if (v.type === 'v' && param(v, 'dataLayerVersion') === '1') add('variable', v, 'info', 'Uses data layer version 1, which cannot read nested keys.');
    });
    if (site) (cv.trigger || []).forEach(function (tr) {
      conditions(tr).forEach(function (cnd) {
        var a = condArgs(cnd); if (!/Page Hostname|Page URL/i.test(a.arg0 || '') || !a.arg1) return;
        (String(a.arg1).match(/[a-z0-9-]+(\.[a-z0-9-]+)+/gi) || []).forEach(function (h) { var d = rootDomain(h.toLowerCase()); if (/\.[a-z]{2,}$/i.test(h) && d !== site && !VENDOR_HOSTS.test(d)) add('trigger', tr, 'review', 'Condition targets ' + h + ', which is not ' + site + '. If this is a staging host, the trigger never fires in production.'); });
      });
    });
    return f;
  }

  /* ---------- one container → atlas model ---------- */
  var DIMS = ['references', 'duplicates', 'naming', 'hygiene', 'legacy', 'folders', 'parameters'];
  function buildContainer(parsed, website) {
    var cv = parsed.cv, stripped = strip(cv), report = AUTO.audit(stripped), pf = paramChecks(cv, website);
    var server = parsed.info.context === 'server';
    var folders = {}; (cv.folder || []).forEach(function (fo) { folders[String(fo.folderId)] = fo.name; });
    var nodes = [], byKey = {}, edges = [], seenEdge = {};
    var node = function (kind, ref, name, type, row) {
      var id = kind + ':' + ref; if (byKey[id]) return byKey[id];
      var n = { id: id, findings: [], risk: null, kind: kind, ref: String(ref), name: name, type: type, folder: row && row.parentFolderId ? folders[String(row.parentFolderId)] || null : null };
      if (kind === 'tag') n.paused = !!(row && row.paused);
      nodes.push(n); byKey[id] = n; return n;
    };
    var edge = function (from, to, kind) { var k = from + '>' + to + '>' + kind; if (from === to || seenEdge[k] || !byKey[from] || !byKey[to]) return; seenEdge[k] = 1; edges.push({ from: from, to: to, kind: kind }); };
    var varByName = {}; (cv.variable || []).forEach(function (v) { varByName[v.name] = v; });
    var builtinNames = {}; (cv.builtInVariable || []).forEach(function (b) { builtinNames[b.name] = 1; });
    var refNode = function (name) {
      if (name === '_event') name = 'Event';
      if (varByName[name]) return 'variable:' + varByName[name].variableId;
      node('builtin', name, name, 'built-in variable'); return 'builtin:' + name;
    };
    (cv.client || []).forEach(function (c) { node('client', c.clientId, c.name, c.type, c); });
    (cv.tag || []).forEach(function (t) { node('tag', t.tagId, t.name, t.type, t); });
    (cv.trigger || []).forEach(function (t) { node('trigger', t.triggerId, t.name, t.type, t); });
    (cv.variable || []).forEach(function (v) { node('variable', v.variableId, v.name, v.type, v); });
    var tagByName = {}; (cv.tag || []).forEach(function (t) { tagByName[t.name] = t; tagByName[t.tagId] = t; });
    (cv.tag || []).forEach(function (t) {
      var id = 'tag:' + t.tagId;
      (t.firingTriggerId || []).forEach(function (tr) { if (BUILTIN_TRIGGERS[tr]) node('trigger', tr, BUILTIN_TRIGGERS[tr], 'built-in trigger'); edge(id, 'trigger:' + tr, 'fires'); });
      (t.blockingTriggerId || []).forEach(function (tr) { if (BUILTIN_TRIGGERS[tr]) node('trigger', tr, BUILTIN_TRIGGERS[tr], 'built-in trigger'); edge(id, 'trigger:' + tr, 'blocks'); });
      refsOf(t).forEach(function (n) { edge(id, refNode(n), 'reads'); });
      (t.setupTag || []).forEach(function (s) { var st = tagByName[s.tagName]; if (st) edge('tag:' + st.tagId, id, 'sequence'); });
      (t.teardownTag || []).forEach(function (s) { var st = tagByName[s.tagName]; if (st) edge(id, 'tag:' + st.tagId, 'sequence'); });
    });
    ['trigger', 'variable', 'client'].forEach(function (k) { (cv[k] || []).forEach(function (row) { refsOf(row).forEach(function (n) { edge(k + ':' + row[IDK[k]], refNode(n), 'reads'); }); }); });
    var findings = report.findings.concat(pf);
    findings.forEach(function (f) {
      var n = byKey[f.kind + ':' + f.id]; if (!n) return;
      var pair = null, m = /^Configuration matches (\S+);/.exec(f.message); if (m) pair = f.kind + ':' + m[1];
      n.findings.push({ severity: f.severity, dimension: f.dimension, message: f.message, pair: pair });
      if (pair) edge(n.id, pair, 'duplicate');
    });
    nodes.forEach(function (n) { n.findings.sort(function (a, b) { return SEV[a.severity] - SEV[b.severity]; }); n.risk = n.findings.length ? n.findings[0].severity : null; });
    var size = Math.max(1, stripped.tag.length + stripped.trigger.length + stripped.variable.length);
    var dims = DIMS.map(function (d) { var s = d === 'parameters' ? Math.max(0, 100 - 100 * pf.length / size) : report.dimensions[d]; return { key: d, score: Math.round(s) }; });
    var score = Math.round(dims.reduce(function (a, d) { return a + d.score; }, 0) / dims.length);
    var order = { client: 0, tag: 1, trigger: 2, variable: 3, builtin: 4 };
    nodes.sort(function (a, b) { return order[a.kind] - order[b.kind] || (SEV[a.risk] ?? 3) - (SEV[b.risk] ?? 3) || a.name.localeCompare(b.name); });
    return {
      meta: { name: parsed.info.name, publicId: parsed.info.publicId, context: parsed.info.context, version: parsed.info.version, versionName: parsed.info.versionName, exportTime: parsed.info.exportTime },
      score: score, dims: dims, nodes: nodes, edges: edges, stripped: stripped,
      counts: parsed.counts, website: website || null,
      skipped: [
        ['Live tag firing and data-layer values', 'Run a browser scan of key pages with Claude in Chrome, the built-in browser, or the gtm-debug-agent skill, and compare what fired with this audit.'],
        ['Consent timing', 'Repeat the scan three times: no choice, accept, reject. Any marketing request after Reject is a finding.'],
        ['Ad platform, GA4 and CRM reconciliation', 'Pull conversions from GA4 and each ad platform through an MCP connector (for example Synter: ga4_get_conversions, pull_meta_ads_performance, get_pixel_health) and compare counts for the same days.'],
        [server ? 'Delivery to destination APIs' : 'Server-side delivery', server ? 'Check the server container request logs (Stape MCP or your sGTM host) and Meta Events Manager diagnostics for the tags marked delivered.' : 'Add the sGTM export to this audit to trace every web event to its destination.'],
        ['Business-event coverage', 'Compare the events in this audit with your measurement plan (for example from the Google Drive MCP) and list the events the plan needs but no tag sends.'],
        ['Changes after this export', 'Watch the container for drift: the atlas checks the published version daily and lists what changed.'],
      ],

      scope: 'Static checks of the exported configuration. The score is a heuristic, not a measure of tracking accuracy.',
    };
  }

  /* ---------- web → server signal flow ---------- */
  function senders(webCv) {
    var globalUrl = null;
    (webCv.tag || []).forEach(function (t) { if (!t.paused && (t.type === 'googtag' || t.type === 'gaawc')) { var u = listParam(t, 'configSettingsTable').server_container_url || listParam(t, 'fieldsToSet').server_container_url || param(t, 'serverContainerUrl'); if (u) globalUrl = globalUrl || u; } });
    var out = [];
    (webCv.tag || []).forEach(function (t) {
      if (t.paused) return;
      var url = null, event = null, transport = null;
      if (t.type === 'googtag' || t.type === 'gaawc') { url = listParam(t, 'configSettingsTable').server_container_url || param(t, 'serverContainerUrl'); event = 'page_view'; transport = 'ga4'; if (listParam(t, 'configSettingsTable').send_page_view === 'false') url = null; }
      else if (t.type === 'gaawe') { url = listParam(t, 'eventSettingsTable').server_container_url || globalUrl; event = param(t, 'eventName') || ''; transport = 'ga4'; }
      else if (isDataTag(t)) { url = param(t, 'gtm_server_domain') || param(t, 'url'); event = param(t, 'event_type') === 'custom' ? param(t, 'event_name_custom') : param(t, 'event_name_standard'); transport = 'data'; }
      if (!url || String(url).indexOf('{{') >= 0 && !/^https?:/.test(url)) { if (url) out.push({ tag: t, host: String(url), event: event, transport: transport }); return; }
      out.push({ tag: t, host: hostOf(url) || String(url), event: event, transport: transport });
    });
    return out;
  }
  function evalCond(op, value, arg, negate) {
    var r; value = String(value); arg = String(arg == null ? '' : arg);
    switch (op) {
      case 'EQUALS': r = value === arg; break; case 'CONTAINS': r = value.indexOf(arg) >= 0; break;
      case 'STARTS_WITH': r = value.indexOf(arg) === 0; break; case 'ENDS_WITH': r = value.slice(-arg.length) === arg; break;
      case 'MATCH_REGEX': try { r = new RegExp(arg).test(value); } catch (e) { return 'maybe'; } break;
      default: return 'maybe';
    }
    return (negate ? !r : r) ? 'yes' : 'no';
  }
  function triggerMatch(tr, event, clientName, eventVars) {
    var conds = conditions(tr); if (!conds.length) return tr.type === 'ALWAYS' || tr.type === 'CUSTOM_EVENT' ? 'yes' : 'maybe';
    var res = 'yes';
    conds.forEach(function (c) {
      var a = condArgs(c), ref = /^\{\{(.+)\}\}$/.exec(String(a.arg0 || '')), name = ref ? ref[1] : null, r;
      var neg = a.negate === 'true';
      if (name && eventVars[name]) r = event == null ? 'maybe' : evalCond(c.type, event, a.arg1, neg);
      else if (name === 'Client Name') r = clientName == null ? 'maybe' : evalCond(c.type, clientName, a.arg1, neg);
      else r = 'maybe';
      if (r === 'no') res = 'no'; else if (r === 'maybe' && res === 'yes') res = 'maybe';
    });
    return res;
  }
  function buildFlow(webP, srvP) {
    var web = webP.cv, srv = srvP.cv, S = senders(web);
    var nodes = [], byId = {}, edges = [], seen = {}, findings = [], routes = [];
    var add = function (id, kind, col, ref, name, type, side, extra) { if (byId[id]) return byId[id]; var n = { id: id, findings: [], risk: null, kind: kind, col: col, ref: String(ref), name: name, type: type, side: side }; if (extra) Object.keys(extra).forEach(function (k) { n[k] = extra[k]; }); nodes.push(n); byId[id] = n; return n; };
    var link = function (from, to, kind, status) { var k = from + '>' + to + '>' + kind, rank = { ok: 4, maybe: 3, unknown: 2, dead: 1, idle: 0 }; if (seen[k]) { if (rank[status] > rank[seen[k].status]) seen[k].status = status; return; } var e = { from: from, to: to, kind: kind, status: status }; seen[k] = e; edges.push(e); };
    var flag = function (id, severity, message, related, nodeOnly) { var n = byId[id]; if (!n) return; n.findings.push({ severity: severity, message: message }); if (!n.risk || SEV[severity] < SEV[n.risk]) n.risk = severity; if (!nodeOnly) findings.push({ severity: severity, target: id, message: message, related: related || [] }); };
    var webTr = {}; (web.trigger || []).forEach(function (t) { webTr[t.triggerId] = t; });
    // server side, all of it
    var clients = (srv.client || []).slice().sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
    clients.forEach(function (c) { add('cl:' + c.clientId, 'client', 3, c.clientId, c.name, c.type, 'server'); });
    var eventVars = { 'Event Name': 1, '_event': 1 };
    (srv.variable || []).forEach(function (v) { if (v.type === 'ed' && /^(event_name|eventName)$/.test(String(param(v, 'keyPath') || ''))) eventVars[v.name] = 1; });
    var condText = function (tr) { return conditions(tr).map(function (c) { var a = condArgs(c); return String(a.arg0 || '').replace(/[{}]/g, '') + ' ' + ({ EQUALS: 'equals', CONTAINS: 'contains', MATCH_REGEX: 'matches', STARTS_WITH: 'starts with', ENDS_WITH: 'ends with' }[c.type] || c.type.toLowerCase()) + ' ' + a.arg1; }).join(' and ') || 'every event'; };
    var sTriggers = srv.trigger || [], sTags = srv.tag || [];
    var claims = function (transport) {
      var list = clients.filter(function (c) { return transport === 'ga4' ? c.type === 'gaaw_client' : transport === 'data' ? (/^cvt_/.test(c.type) && (/data/i.test(c.name) || allStrings(c.parameter || []).some(function (s) { return /\/data/.test(s); }))) : false; });
      if (!list.length) return { client: null, certain: true };
      var top = list.filter(function (c) { return (c.priority || 0) === (list[0].priority || 0); });
      return { client: list[0], certain: top.length === 1, rivals: top };
    };
    var reachTag = {}, reachTrig = {}, perTagSenders = {};
    S.forEach(function (s, i) {
      var t = s.tag, wid = 'wtg:' + t.tagId, ep = 'ep:' + s.host;
      add(wid, 'wtag', 1, t.tagId, t.name, s.transport === 'data' ? 'Data Tag' : 'GA4 via server_container_url', 'web');
      add(ep, 'endpoint', 2, s.host, s.host, 'server container endpoint', 'edge');
      var trigs = (t.firingTriggerId || []).map(String);
      trigs.forEach(function (tr) { var row = webTr[tr]; add('wtr:' + tr, 'wtrigger', 0, tr, row ? row.name : BUILTIN_TRIGGERS[tr] || 'Trigger ' + tr, row ? row.type : 'built-in trigger', 'web'); link('wtr:' + tr, wid, 'fires', 'ok'); });
      var r = { id: 'r' + i, webTag: wid, webTriggers: trigs.map(function (x) { return 'wtr:' + x; }), firing: trigs.map(function (x) { return webTr[x] ? webTr[x].name : BUILTIN_TRIGGERS[x] || x; }), endpoint: ep, event: s.event || null, transport: s.transport, client: null, matched: [], tags: [], destinations: [], status: 'dead-end' };
      routes.push(r);
      var cl = claims(s.transport);
      if (!cl.client) { r.reason = 'No client in the server container claims ' + (s.transport === 'ga4' ? 'GA4' : 'Data Tag') + ' requests.'; link(wid, ep, 'sends', 'dead'); flag(wid, 'critical', 'Sends to the server container, but no server client claims ' + (s.transport === 'ga4' ? 'GA4' : 'Data Tag') + ' requests, so they are dropped.'); return; }
      r.client = 'cl:' + cl.client.clientId;
      if (!cl.certain) r.reason = cl.rivals.map(function (c) { return c.name; }).join(' and ') + ' have the same priority, so which one claims the request is not certain.';
      if (!s.event || /\{\{/.test(s.event)) {
        r.status = 'unknown'; r.reason = s.event ? 'The event name is set by a variable, so it cannot be traced from the export.' : 'The tag has no event name, so the server cannot route it.';
        link(wid, ep, 'sends', 'unknown'); link(ep, r.client, 'routes', 'unknown'); return;
      }
      var ev = 'ev:' + s.event; add(ev, 'event', 4, s.event, s.event, 'event name', 'server'); r.eventNode = ev;
      var anyYes = false, anyMaybe = false;
      sTriggers.forEach(function (tr) {
        var m = triggerMatch(tr, s.event, cl.client.name, eventVars); if (m === 'no') return;
        if (m === 'yes' && !cl.certain && /Client Name/.test(stable(conditions(tr)))) m = 'maybe';
        add('str:' + tr.triggerId, 'strigger', 5, tr.triggerId, tr.name, condText(tr), 'server');
        r.matched.push({ id: 'str:' + tr.triggerId, certainty: m });
        link(ev, 'str:' + tr.triggerId, 'matches', m === 'yes' ? 'ok' : 'maybe');
        (reachTrig[tr.triggerId] = reachTrig[tr.triggerId] || []).push(s.event);
        sTags.forEach(function (st) {
          if (st.paused || (st.firingTriggerId || []).map(String).indexOf(String(tr.triggerId)) < 0) return;
          if (r.tags.some(function (x) { return x.id === 'stg:' + st.tagId; })) return;
          r.tags.push({ id: 'stg:' + st.tagId, certainty: m, destination: destOf(st) });
          if (m === 'yes') anyYes = true; else anyMaybe = true;
          (reachTag[st.tagId] = reachTag[st.tagId] || {})[m] = 1;
          if (m === 'yes') (perTagSenders[st.tagId] = perTagSenders[st.tagId] || []).push({ tag: t, event: s.event });
        });
      });
      r.destinations = r.tags.map(function (x) { return x.destination; }).filter(function (d, i, a) { return a.indexOf(d) === i; });
      r.status = anyYes ? 'delivered' : anyMaybe ? 'conditional' : 'dead-end';
      var st = r.status === 'delivered' ? 'ok' : r.status === 'conditional' ? 'maybe' : 'dead';
      link(wid, ep, 'sends', st); link(ep, r.client, 'routes', st === 'dead' ? 'ok' : st); link(r.client, ev, 'claims', st);
      if (r.status === 'dead-end') {
        add('sink', 'sink', 5, '—', 'No server tag fires', 'dead end', 'server'); link(ev, 'sink', 'matches', 'dead');
        flag(wid, 'review', 'Sends "' + s.event + '" to the server, but no active server tag fires on it, so it is not forwarded anywhere.', [ev]);
        flag(ev, 'review', 'No active server tag fires on "' + s.event + '".', null, true);
      }
    });
    // every server trigger and tag gets a place, reached or not
    sTriggers.forEach(function (tr) { add('str:' + tr.triggerId, 'strigger', 5, tr.triggerId, tr.name, condText(tr), 'server'); });
    sTags.forEach(function (st) {
      var id = 'stg:' + st.tagId, d = destOf(st);
      add(id, 'stag', 6, st.tagId, st.name, d, 'server', { paused: !!st.paused });
      add('ds:' + d, 'dest', 7, d, d, 'destination', 'out');
      var reach = reachTag[st.tagId] || {}, status = reach.yes ? 'ok' : reach.maybe ? 'maybe' : 'idle';
      (st.firingTriggerId || []).forEach(function (tr) { var ok = (reachTrig[tr] || []).length; link('str:' + tr, id, 'fires', st.paused ? 'idle' : ok ? status : 'idle'); });
      link(id, 'ds:' + d, 'delivers', st.paused ? 'idle' : status);
      if (st.paused) return;
      if (!reach.yes && !reach.maybe) {
        var names = (st.firingTriggerId || []).map(function (x) { var tr = sTriggers.filter(function (y) { return String(y.triggerId) === String(x); })[0]; return tr ? tr.name + ' (' + condText(tr) + ')' : x; });
        flag(id, 'review', 'No event from this web container reaches this tag. It waits for ' + names.join(' or ') + ', which no web tag sends. Events from apps or other containers are not visible here.');
      }
      var hits = perTagSenders[st.tagId] || [], pv = hits.filter(function (h) { return h.event === 'page_view'; });
      if (pv.length > 1) flag(id, 'review', 'Can fire ' + pv.length + ' times on every page view: ' + pv.map(function (h) { return h.tag.name; }).join(', ') + ' all reach it. Check they share an event ID so the platform deduplicates.', pv.map(function (h) { return 'wtg:' + h.tag.tagId; }));
    });
    sTriggers.forEach(function (tr) {
      var used = sTags.some(function (st) { return !st.paused && (st.firingTriggerId || []).map(String).indexOf(String(tr.triggerId)) >= 0; });
      if (!used && (reachTrig[tr.triggerId] || []).length) flag('str:' + tr.triggerId, 'info', 'Matches ' + reachTrig[tr.triggerId].filter(function (e, i, a) { return a.indexOf(e) === i; }).map(function (e) { return '"' + e + '"'; }).join(', ') + ' from the web container, but no active server tag uses this trigger.');
    });
    clients.forEach(function (c) { if (c.type !== 'gtm_client' && !routes.some(function (r) { return r.client === 'cl:' + c.clientId; })) flag('cl:' + c.clientId, 'info', 'No web tag in this container sends traffic this client claims.'); });
    // rows within each column: problems first
    var cols = {}; nodes.forEach(function (n) { (cols[n.col] = cols[n.col] || []).push(n); });
    Object.keys(cols).forEach(function (k) { cols[k].sort(function (a, b) { return (a.id === 'sink') - (b.id === 'sink') || (SEV[a.risk] ?? 3) - (SEV[b.risk] ?? 3) || a.name.localeCompare(b.name); }).forEach(function (n, i) { n.row = i; }); });
    var hosts = S.map(function (s) { return s.host; }).filter(function (h, i, a) { return a.indexOf(h) === i; });
    var allowed = allStrings((srv.client || []).filter(function (c) { return c.type === 'gtm_client'; })).join(' ');
    var summary = { routes: routes.length, delivered: 0, conditional: 0, dead: 0, unknown: 0, orphans: 0 };
    routes.forEach(function (r) { summary[r.status === 'dead-end' ? 'dead' : r.status]++; });
    summary.orphans = findings.filter(function (f) { return /^stg:/.test(f.target) && /No event from this web container/.test(f.message); }).length;
    return {
      meta: { name: webP.info.publicId + ' → ' + srvP.info.publicId, publicId: 'Signal flow', context: 'web to server', paired: allowed.indexOf(webP.info.publicId) >= 0, hosts: hosts },
      columns: ['Web triggers', 'Web tags', 'Endpoint', 'Server clients', 'Events', 'Server triggers', 'Server tags', 'Destinations'],
      nodes: nodes, edges: edges, routes: routes, findings: findings, summary: summary,
    };
  }

  /* ---------- the whole atlas ---------- */
  function build(opts) {
    var web = opts.web, server = opts.server, site = opts.website ? rootDomain(hostOf(opts.website) || opts.website) : null;
    var containers = [], auto = [];
    [web, server].forEach(function (p) { if (!p) return; var c = buildContainer(p, site); containers.push(c); auto.push(c.stripped); delete c.stripped; });
    var D = { containers: containers, auto: auto, website: site, generatedAt: new Date().toISOString() };
    if (web && server) D.flow = buildFlow(web, server);
    D.report = reportModel(D);
    return D;
  }

  /* ---------- the report every output shares ---------- */
  var SEV_LABEL = { critical: 'Fix first', review: 'Confirm', info: 'Note' };
  var DIM_LABEL = { references: 'References', duplicates: 'Duplicates', naming: 'Naming', hygiene: 'Unused', legacy: 'Legacy', folders: 'Folders', parameters: 'Parameters' };
  function reportModel(D) {
    var byId = {};
    var items = [], groups = {};
    D.containers.forEach(function (c, ci) {
      c.nodes.forEach(function (n) { byId[c.meta.publicId + '|' + n.id] = n; });
      c.nodes.forEach(function (n) {
        n.findings.forEach(function (f) {
          var pairNode = f.pair && byId[c.meta.publicId + '|' + f.pair];
          var item = { tab: ci, nodeId: n.id, container: c.meta.publicId, context: c.meta.context, severity: f.severity, check: DIM_LABEL[f.dimension] || f.dimension, kind: n.kind, ref: n.ref, name: n.name, type: n.type,
            message: pairNode ? 'Same settings as ' + pairNode.kind + ' "' + pairNode.name + '" (' + pairNode.ref + '). Merge them or confirm both are needed.' : f.message };
          if (f.severity === 'info') { var k = c.meta.publicId + '|' + f.dimension + '|' + f.message.replace(/\d+/g, '#').replace(/"[^"]*"/g, '"…"'); (groups[k] = groups[k] || { container: c.meta.publicId, check: item.check, message: f.message, examples: [], count: 0 }); groups[k].count++; if (groups[k].examples.length < 4) groups[k].examples.push(n.name); }
          else items.push(item);
        });
      });
    });
    if (D.flow) D.flow.findings.forEach(function (f) {
      var n = D.flow.nodes.filter(function (x) { return x.id === f.target; })[0]; if (!n) return;
      if (f.severity === 'info') { var k = 'flow|' + f.message; (groups[k] = groups[k] || { container: 'Signal flow', check: 'Signal flow', message: f.message, examples: [], count: 0 }); groups[k].count++; if (groups[k].examples.length < 4) groups[k].examples.push(n.name); }
      else items.push({ tab: D.containers.length, nodeId: n.id, container: 'Signal flow', context: 'flow', severity: f.severity, check: 'Signal flow', kind: n.kind, ref: n.ref, name: n.name, type: n.type, message: f.message });
    });
    // duplicate pairs appear on both members; keep one row per pair
    var seenPair = {};
    items = items.filter(function (it) { if (!/^Same settings as/.test(it.message)) return true; var other = /"([^"]+)"/.exec(it.message), key = it.container + '|' + [it.name, other ? other[1] : ''].sort().join('|'); if (seenPair[key]) return false; seenPair[key] = 1; return true; });
    items.forEach(function (it, i) { it.key = it.container + '|' + it.nodeId + '|' + it.check + '|' + it.message.slice(0, 40); });
    items.sort(function (a, b) { return SEV[a.severity] - SEV[b.severity] || a.container.localeCompare(b.container) || a.check.localeCompare(b.check) || a.name.localeCompare(b.name); });
    var notes = Object.keys(groups).map(function (k) { var g = groups[k]; if (g.count > 1 && /No folder assigned/.test(g.message)) g.message = 'No folder assigned'; return g; }).sort(function (a, b) { return b.count - a.count; });
    var counts = { critical: 0, review: 0, info: 0 }; items.forEach(function (i) { counts[i.severity]++; }); notes.forEach(function (g) { counts.info += g.count; });
    var vendors = {}; D.auto.forEach(function (a) { Object.keys(a.vendor).forEach(function (k) { var v = a.vendor[k]; vendors[v] = (vendors[v] || 0) + 1; }); });
    var score = Math.round(D.containers.reduce(function (s, c) { return s + c.score; }, 0) / D.containers.length);
    return {
      website: D.website, generatedAt: D.generatedAt, score: score,
      containers: D.containers.map(function (c) { return { name: c.meta.name, publicId: c.meta.publicId, context: c.meta.context, version: c.meta.version, versionName: c.meta.versionName, exportTime: c.meta.exportTime, score: c.score, dims: c.dims.map(function (d) { return { key: d.key, label: DIM_LABEL[d.key], score: d.score }; }), counts: c.counts }; }),
      counts: counts, items: items, notes: notes, vendors: vendors,
      flow: D.flow ? { summary: D.flow.summary, paired: D.flow.meta.paired, hosts: D.flow.meta.hosts, routes: D.flow.routes.map(function (r) { var n = function (id) { return (D.flow.nodes.filter(function (x) { return x.id === id; })[0] || {}).name; }; return { tag: n(r.webTag), event: r.event, client: r.client ? n(r.client) : null, tags: r.tags.map(function (t) { return n(t.id); }), destinations: r.destinations, status: r.status, reason: r.reason || '' }; }) } : null,
      skipped: D.containers[0].skipped, scope: D.containers[0].scope, severityLabel: SEV_LABEL,
    };
  }

  return { parseExport: parseExport, detectWebsite: detectWebsite, build: build, rootDomain: rootDomain, hostOf: hostOf, SEV_LABEL: SEV_LABEL, DIM_LABEL: DIM_LABEL };
})(typeof GTM_AUTO !== 'undefined' ? GTM_AUTO : (typeof globalThis !== 'undefined' && globalThis.GTM_AUTO));
if (typeof module !== 'undefined') module.exports = GTM_ENGINE;

// Proposed container: applies the audit's mechanical fixes to a copy of each
// uploaded export, re-audits the copy, and says exactly what changed and why.
// Read-only toward the upload; nothing here publishes or leaves the browser.
// A finding marked "Intended" is left alone, "Ask owner" goes to the owner list,
// "Will fix" or undecided is applied when a rule can fix it without guessing.
var GTM_PROPOSE = (function () {
  'use strict';
  var IDK = { tag: 'tagId', trigger: 'triggerId', variable: 'variableId', client: 'clientId', folder: 'folderId' };
  var KINDS = ['tag', 'trigger', 'variable', 'client', 'folder'];
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function cvOf(doc) { return doc.containerVersion || doc; }
  function param(row, key) { return (row.parameter || []).filter(function (p) { return p.key === key; })[0]; }
  function setParam(row, key, value) {
    var p = param(row, key);
    if (p) { var old = p.value; p.value = value; return old; }
    (row.parameter = row.parameter || []).push({ type: 'TEMPLATE', key: key, value: value }); return undefined;
  }
  function snake(s) { return String(s).trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase(); }
  function rowOf(cv, kind, id) { return (cv[kind] || []).filter(function (r) { return String(r[IDK[kind]]) === String(id); })[0]; }
  // new IDs come after every ID in the upload too, so a removed element's ID is never reused (a merge import would overwrite it)
  function nextId(cv, kind, base) { var m = 0; [cv, base || {}].forEach(function (c) { (c[kind] || []).forEach(function (r) { m = Math.max(m, +r[IDK[kind]] || 0); }); }); return String(m + 1); }
  // walk every string in a row (skipping its own name) and let fn rewrite it
  function mapStrings(row, fn) {
    var n = 0;
    (function walk(o) {
      Object.keys(o).forEach(function (k) {
        if (o === row && (k === 'name' || k === 'notes' || k === 'fingerprint')) return;
        var v = o[k];
        if (typeof v === 'string') { var nv = fn(v, k); if (nv !== v) { o[k] = nv; n++; } }
        else if (v && typeof v === 'object') walk(v);
      });
    })(row);
    return n;
  }
  function allRows(cv) { var out = []; ['tag', 'trigger', 'variable', 'client'].forEach(function (k) { (cv[k] || []).forEach(function (r) { out.push(r); }); }); return out; }
  function referenced(cv, name) { var needle = '{{' + name + '}}', hit = false; allRows(cv).forEach(function (r) { if (r.name !== name && JSON.stringify(r).indexOf(needle) >= 0) hit = true; }); return hit; }
  function triggerUsed(cv, id) { return (cv.tag || []).some(function (t) { return (t.firingTriggerId || []).concat(t.blockingTriggerId || []).map(String).indexOf(String(id)) >= 0; }); }
  function touch(row) { delete row.fingerprint; }
  // GTM notes are the owner's own words: a "keep" note blocks removal, a "remove" note is cited as support.
  var KEEP_NOTE = /\b(kept|keep|leave)\b[^.]*\b(on purpose|intentional(ly)?|as is)\b|\b(do not|don't|never)\s+(delete|remove|pause)\b|\bintentional\b|\brequired by\b/i;
  var DROP_NOTE = /\b(remove|delete|deprecated|by mistake|duplicate|temporary|old)\b/i;
  function quoteNote(row) { var n = String(row.notes || '').trim(); return n.length > 140 ? n.slice(0, 137) + '…' : n; }
  function protectedBy(row) { return row && row.notes && KEEP_NOTE.test(row.notes) ? 'Its GTM note says: "' + quoteNote(row) + '" The proposal leaves it alone.' : null; }
  function cite(row, what) { return row && row.notes && DROP_NOTE.test(row.notes) && !KEEP_NOTE.test(row.notes) ? what + ' Its GTM note agrees: "' + quoteNote(row) + '"' : what; }

  /* ---------- one rule per finding shape; each returns a change, an owner reason, or null ---------- */
  function fix(cv, it, site, base) {
    var row = it.kind in IDK ? rowOf(cv, it.kind, it.ref) : null, m;
    var ok = function (action, what) { return { action: action, what: what }; };
    var owner = function (reason) { return { owner: reason }; };
    if (it.check === 'Signal flow') return owner('Routing between containers depends on which platforms should receive the event; the audit cannot pick that.');
    if (it.check === 'Site scan') return owner('This is about the live site, not the container file.');
    if (!row) return { gone: 'Already handled: a change above removed or merged this element.' };

    if (it.check === 'Unused') {
      var keepNote = protectedBy(row); if (keepNote && it.kind !== 'tag') return owner(keepNote);
      if (it.kind === 'variable') {
        if (referenced(cv, row.name)) return owner('Something now references it.');
        cv.variable = cv.variable.filter(function (r) { return r !== row; }); return ok('remove', cite(row, 'Removed the unused variable.'));
      }
      if (it.kind === 'trigger') {
        if (triggerUsed(cv, it.ref)) return owner('A tag now uses it.');
        cv.trigger = cv.trigger.filter(function (r) { return r !== row; }); return ok('remove', cite(row, 'Removed the trigger no tag uses.'));
      }
      if (it.kind === 'tag') return owner('Only the owner knows which trigger this tag was meant to fire on, or whether it can go.');
    }

    if (it.check === 'Duplicates' && (m = /^Same settings as (\w+) "(.+)" \((\d+)\)/.exec(it.message))) {
      var other = rowOf(cv, it.kind, m[3]); if (!other) return { gone: 'Already handled: its twin was merged above.' };
      // keep the original: the one not called a copy, else the older (lower) ID
      var copyish = function (r) { return /\b(copy|old|dup(licate)?|test)\b/i.test(r.name); };
      var keep = copyish(row) && !copyish(other) ? other : copyish(other) && !copyish(row) ? row : (+row[IDK[it.kind]] < +other[IDK[it.kind]] ? row : other);
      var drop = keep === row ? other : row;
      if (protectedBy(drop)) return owner(protectedBy(drop));
      if (it.kind === 'variable') {
        var n = 0; allRows(cv).forEach(function (r) { if (r === drop) return; var c = mapStrings(r, function (s) { return s.split('{{' + drop.name + '}}').join('{{' + keep.name + '}}'); }); if (c) { touch(r); n += c; } });
        cv.variable = cv.variable.filter(function (r) { return r !== drop; });
        return ok('merge', cite(drop, 'Merged "' + drop.name + '" into "' + keep.name + '"' + (n ? ' and repointed ' + n + ' reference' + (n > 1 ? 's' : '') : '') + '.'));
      }
      if (it.kind === 'trigger') {
        var moved = 0, dropId = String(drop.triggerId), keepId = String(keep.triggerId);
        (cv.tag || []).forEach(function (t) { ['firingTriggerId', 'blockingTriggerId'].forEach(function (k) { if (!t[k]) return; var before = t[k].map(String); if (before.indexOf(dropId) < 0) return; var nx = []; before.forEach(function (x) { x = x === dropId ? keepId : x; if (nx.indexOf(x) < 0) nx.push(x); }); t[k] = nx; moved++; touch(t); }); });
        cv.trigger = cv.trigger.filter(function (r) { return r !== drop; });
        return ok('merge', 'Merged trigger "' + drop.name + '" into "' + keep.name + '"' + (moved ? '; ' + moved + ' tag' + (moved > 1 ? 's' : '') + ' now use the original' : '') + '.');
      }
      if (it.kind === 'tag') {
        if (drop.paused) return { gone: 'The copy is already paused in the upload.' };
        drop.paused = true; touch(drop);
        return ok('pause', 'Paused "' + drop.name + '" so the same hit is not sent twice; "' + keep.name + '" keeps firing.');
      }
    }

    if (it.check === 'Legacy' && it.kind === 'tag') {
      if (row.paused) return { gone: cite(row, 'Already paused in the upload. Delete it once nothing depends on it.') };
      if (protectedBy(row)) return owner(protectedBy(row));
      row.paused = true; touch(row); return ok('pause', 'Paused the retired Universal Analytics tag. It stays in the container until someone deletes it.');
    }

    if (it.check === 'Parameters') {
      if ((m = /^Hardcodes (\S+) although the Constant \{\{(.+?)\}\}/.exec(it.message))) {
        var lit = m[1], ref = '{{' + m[2] + '}}', c = mapStrings(row, function (s) { return s === lit ? ref : s; });
        if (!c) return { gone: 'The ID is no longer typed in.' };
        touch(row); return ok('edit', 'Replaced the typed-in ' + lit + ' with ' + ref + '.');
      }
      if ((m = /^GA4 event name "(.+)" is not snake_case/.exec(it.message))) {
        var en = snake(m[1]); setParam(row, 'eventName', en); touch(row);
        return ok('edit', 'Renamed the GA4 event "' + m[1] + '" to "' + en + '". Reports will show it under the new name from the next publish.');
      }
      if (/^Data layer variable has no key/.test(it.message)) {
        if (!(m = /^DLV\s*[-–:]\s*([A-Za-z0-9_.]+)$/.exec(row.name))) return owner('The key cannot be read from the variable name.');
        setParam(row, 'name', m[1]); touch(row); return ok('edit', 'Set the data layer key to "' + m[1] + '", taken from the variable name. Confirm it matches the site\'s dataLayer.');
      }
      if (/^Required setting "event name" is blank/.test(it.message) && row.type === 'gaawe') {
        if (!(m = /^GA4\s*[-–:]\s*([A-Za-z][A-Za-z0-9_ ]*)$/.exec(row.name))) return owner('The event name cannot be read from the tag name.');
        var ev = snake(m[1]); setParam(row, 'eventName', ev); touch(row); return ok('edit', 'Set the event name to "' + ev + '", taken from the tag name.');
      }
      if (/^Required setting/.test(it.message)) return owner('Needs an ID or label from the ad or analytics account; the audit will not invent one.');
      if (/access token in plain text/.test(it.message)) return owner('Move the token to a secret store or server environment variable, then rotate it. A file cannot fix a leaked secret.');
      if (/not a first-party subdomain/.test(it.message)) return owner('Needs a custom domain on ' + (site || 'your site') + ' pointed at the server container first.');
      if (/^Condition targets/.test(it.message)) return owner('It may be a deliberate staging trigger; the owner decides.');
    }

    if (it.check === 'References') {
      if ((m = /^Unresolved variable (.+)$/.exec(it.message))) {
        var name = m[1].trim(), k;
        if ((cv.variable || []).some(function (v) { return v.name === name; })) return { gone: 'The variable exists now.' };
        if (!(k = /^DLV\s*[-–:]\s*([A-Za-z0-9_.]+)$/.exec(name))) return owner('Only the owner knows what "' + name + '" should read.');
        var nv = { accountId: cv.accountId || (cv.container || {}).accountId, containerId: cv.containerId || (cv.container || {}).containerId, variableId: nextId(cv, 'variable', base), name: name, type: 'v',
          parameter: [{ type: 'INTEGER', key: 'dataLayerVersion', value: '2' }, { type: 'BOOLEAN', key: 'setDefaultValue', value: 'false' }, { type: 'TEMPLATE', key: 'name', value: k[1] }] };
        if (!nv.accountId) delete nv.accountId; if (!nv.containerId) delete nv.containerId;
        (cv.variable = cv.variable || []).push(nv);
        return ok('add', 'Created the missing data layer variable "' + name + '" (key "' + k[1] + '") that "' + it.name + '" already references. Confirm the key against the site\'s dataLayer.');
      }
      return owner('A dangling reference needs the owner to say what it should point at.');
    }
    if (it.check === 'Naming') return owner('A better name needs to know what the element is for.');
    return owner('No safe automatic fix for this finding.');
  }

  /* ---------- folder tidy: the GTM auto loop, accepted rounds only ---------- */
  function tidy(E, AUTO, doc, notes) {
    var p = E.parseExport(clone(doc)), D = E.build({ web: p.context === 'server' ? null : p, server: p.context === 'server' ? p : null });
    var data = D.auto[0], st = AUTO.start(data), guard = 0;
    while (!st.done && guard++ < 20) { var prop = AUTO.propose(st, { vendor: data.vendor }); if (!prop) break; AUTO.step(st, prop); }
    var rounds = st.rounds.filter(function (r) { return r.accepted && r.idea !== 'dupes'; }).map(function (r) { return r.operations; });
    if (!rounds.length) return { doc: doc, changes: [] };
    var out = AUTO.exportContainer(doc, rounds), byFolder = {}, made = {}, names = {};
    rounds.forEach(function (ops) { ops.forEach(function (o) { if (o.op === 'addFolder') { made[o.id] = 1; names[o.id] = o.name; } }); });
    (cvOf(out).folder || []).forEach(function (f) { names[f.folderId] = f.name; });
    rounds.forEach(function (ops) { ops.forEach(function (o) { if (o.op === 'assignFolder') { var g = byFolder[o.folderId] = byFolder[o.folderId] || { tag: 0, trigger: 0, variable: 0 }; g[o.kind]++; } }); });
    var changes = Object.keys(byFolder).map(function (fid) {
      var g = byFolder[fid], parts = ['tag', 'trigger', 'variable'].filter(function (k) { return g[k]; }).map(function (k) { return g[k] + ' ' + k + (g[k] > 1 ? 's' : ''); });
      return { action: 'folder', kind: 'folder', ref: fid, name: names[fid], check: 'Folders', source: 'tidy', what: (made[fid] ? 'New folder' : 'Folder') + ' "' + names[fid] + '": filed ' + parts.join(', ') + '.', why: notes || 'Elements with no folder; GTM auto kept only rounds that raised the score.' };
    });
    return { doc: out, changes: changes };
  }

  function build(opts) {
    var E = opts.engine, AUTO = opts.auto, R = opts.report, dec = opts.decisions || {}, site = opts.website || R.website;
    var out = { containers: [], owner: [], kept: [] };
    var flowItems = R.items.filter(function (i) { return i.context === 'flow' || i.check === 'Site scan'; });
    R.containers.forEach(function (meta) {
      var up = opts.exports[meta.publicId]; if (!up) return;
      var doc = clone(up), cv = cvOf(doc), changes = [], owner = [], kept = [];
      // merges first, then removals, then edits: an element about to be removed is not edited
      var items = R.items.filter(function (i) { return i.container === meta.publicId; });
      var rank = function (i) { return i.check === 'Duplicates' ? 0 : i.check === 'Unused' ? 1 : 2; };
      items.slice().sort(function (a, b) { return rank(a) - rank(b); }).forEach(function (it) {
        var d = (dec[it.key] || {}).d;
        if (d === 'keep') { kept.push(it); return; }
        if (d === 'ask') { owner.push({ item: it, reason: 'You marked this Ask owner.' }); return; }
        var r = fix(cv, it, site, cvOf(up));
        if (r.gone) changes.push({ action: 'resolved', kind: it.kind, ref: it.ref, name: it.name, check: it.check, why: it.message, what: r.gone, source: d === 'fix' ? 'decision' : 'default', key: it.key });
        else if (r.owner) owner.push({ item: it, reason: r.owner });
        else changes.push({ action: r.action, kind: it.kind, ref: it.ref, name: it.name, check: it.check, why: it.message, what: r.what, source: d === 'fix' ? 'decision' : 'default', key: it.key });
      });
      var folderNote = (R.notes || []).filter(function (g) { return g.container === meta.publicId && g.check === 'Folders'; })[0];
      var t = { doc: doc, changes: [] };
      try { t = tidy(E, AUTO, doc, folderNote ? folderNote.count + ' elements had no folder.' : null); } catch (e) { t = { doc: doc, changes: [] }; }
      doc = t.doc; changes = changes.concat(t.changes);
      if (doc.containerVersion) {
        var d = new Date(), p2 = function (x) { return (x < 10 ? '0' : '') + x; };
        doc.exportTime = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
        var cvn = cvOf(doc); cvn.name = 'Proposed by GTM Container Atlas' + (cvn.name ? ' (from ' + cvn.name + ')' : '');
        cvn.description = 'Proposed fixes from an atlas audit. ' + changes.filter(function (c) { return c.action !== 'resolved'; }).length + ' changes. Not published: import into a new workspace and review before publishing.';
      }
      out.containers.push({ publicId: meta.publicId, context: meta.context, name: meta.name, before: up, after: doc, changes: changes, owner: owner, kept: kept });
      owner.forEach(function (o) { out.owner.push(o); }); kept.forEach(function (k) { out.kept.push(k); });
    });
    flowItems.forEach(function (it) { var d = (dec[it.key] || {}).d; if (d === 'keep') out.kept.push(it); else out.owner.push({ item: it, reason: d === 'ask' ? 'You marked this Ask owner.' : fix({}, it, site).owner }); });

    // re-audit both sides the same way, so the scores are comparable
    var side = function (pick) {
      var ps = out.containers.map(function (c) { return E.parseExport(clone(pick(c))); });
      var web = ps.filter(function (p) { return p.info.context !== 'server'; })[0] || null, srv = ps.filter(function (p) { return p.info.context === 'server'; })[0] || null;
      return E.build({ web: web, server: srv, website: site }).report;
    };
    out.before = side(function (c) { return c.before; });
    out.after = side(function (c) { return c.after; });
    out.containers.forEach(function (c) {
      var b = out.before.containers.filter(function (x) { return x.publicId === c.publicId; })[0], a = out.after.containers.filter(function (x) { return x.publicId === c.publicId; })[0];
      var n = function (R, sev) { return R.items.filter(function (i) { return i.container === c.publicId && i.severity === sev; }).length; };
      c.scoreBefore = b ? b.score : null; c.scoreAfter = a ? a.score : null;
      c.critBefore = n(out.before, 'critical'); c.critAfter = n(out.after, 'critical');
      c.reviewBefore = n(out.before, 'review'); c.reviewAfter = n(out.after, 'review');
    });
    return out;
  }

  /* ---------- element-level, line-aligned diff for the twin panes ---------- */
  function lines(row) { return row ? JSON.stringify(row, null, 2).split('\n') : []; }
  function lcs(a, b) {
    var n = a.length, m = b.length, L = []; for (var i = 0; i <= n; i++) { L.push(new Int32Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { out.push(['same', a[i], b[j]]); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { out.push(['add', null, b[j]]); j++; }
      else { out.push(['del', a[i], null]); i++; }
    }
    // pair a deletion run with the addition run next to it so edits sit side by side
    var res = [], k = 0;
    while (k < out.length) {
      if (out[k][0] === 'same') { res.push(out[k]); k++; continue; }
      var dels = [], adds = [];
      while (k < out.length && out[k][0] !== 'same') { if (out[k][0] === 'del') dels.push(out[k][1]); else adds.push(out[k][2]); k++; }
      for (var x = 0; x < Math.max(dels.length, adds.length); x++) res.push([dels[x] != null && adds[x] != null ? 'mod' : dels[x] != null ? 'del' : 'add', dels[x] != null ? dels[x] : null, adds[x] != null ? adds[x] : null]);
    }
    return res;
  }
  function diff(before, after) {
    var a = cvOf(before), b = cvOf(after), blocks = [];
    KINDS.forEach(function (kind) {
      var id = IDK[kind], A = a[kind] || [], B = b[kind] || [], seen = {};
      var bById = {}; B.forEach(function (r) { bById[String(r[id])] = r; });
      A.concat(B.filter(function (r) { return !A.some(function (x) { return String(x[id]) === String(r[id]); }); })).forEach(function (r) {
        var k = String(r[id]); if (seen[k]) return; seen[k] = 1;
        var L = A.filter(function (x) { return String(x[id]) === k; })[0] || null, Rr = bById[k] || null;
        var la = lines(L), lb = lines(Rr), status = !L ? 'added' : !Rr ? 'removed' : la.join('\n') === lb.join('\n') ? 'same' : 'changed';
        var rows = status === 'same' ? la.map(function (s) { return ['same', s, s]; }) : status === 'added' ? lb.map(function (s) { return ['add', null, s]; }) : status === 'removed' ? la.map(function (s) { return ['del', s, null]; }) : lcs(la, lb);
        blocks.push({ kind: kind, ref: k, name: (Rr || L).name || k, status: status, rows: rows, paused: { before: !!(L && L.paused), after: !!(Rr && Rr.paused) } });
      });
    });
    return blocks;
  }

  function markdown(P) {
    var out = ['# Proposed container changes', ''];
    P.containers.forEach(function (c) {
      out.push('## ' + c.publicId + ' (' + c.context + ')', '', 'Score ' + c.scoreBefore + ' → ' + c.scoreAfter + ' · fix first ' + c.critBefore + ' → ' + c.critAfter + ' · to confirm ' + c.reviewBefore + ' → ' + c.reviewAfter, '');
      c.changes.filter(function (x) { return x.action !== 'resolved'; }).forEach(function (x) { out.push('- **' + x.name + '** (' + x.kind + ' ' + x.ref + ') — ' + x.what + (x.source === 'default' ? ' _(applied by default)_' : x.source === 'tidy' ? ' _(GTM auto)_' : ' _(your decision)_')); });
      out.push('');
    });
    if (P.owner.length) { out.push('## Left for the owner', ''); P.owner.forEach(function (o) { out.push('- **' + o.item.name + '** (' + o.item.container + ') — ' + o.item.message + ' ' + o.reason); }); out.push(''); }
    out.push('Nothing was published. Import the proposed file into a new GTM workspace and review it before publishing.');
    return out.join('\n');
  }

  return { build: build, diff: diff, markdown: markdown, snake: snake };
})();
if (typeof module !== 'undefined') module.exports = GTM_PROPOSE;

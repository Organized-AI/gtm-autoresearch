// Report writers. Both take the report model from GTM_ENGINE.build() and return a
// finished document: Markdown as a string, PDF as an ArrayBuffer (via jsPDF + autoTable).
var GTM_REPORT = (function () {
  'use strict';
  var SEV = { critical: 'Fix first', review: 'Confirm', info: 'Note' };
  var DEC = { fix: 'Will fix', keep: 'Intended', ask: 'Ask owner' };
  function decText(i) { return i.decision ? DEC[i.decision] + (i.note ? ': ' + i.note : '') : ''; }
  function reviewLine(R) { var d = R.items.filter(function (i) { return i.decision; }); if (!d.length) return ''; var c = { fix: 0, keep: 0, ask: 0 }; d.forEach(function (i) { c[i.decision]++; }); return 'Reviewed ' + d.length + ' of ' + R.items.length + ' findings: ' + c.fix + ' to fix, ' + c.keep + ' intended, ' + c.ask + ' to ask the owner.'; }
  var STATUS = { delivered: 'Delivered', conditional: 'Conditional', 'dead-end': 'Dead end', unknown: 'Unresolved' };
  function date(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function ctxLabel(c) { return c.context === 'server' ? 'Server (sGTM)' : 'Web'; }
  function fileBase(R) { return (R.website || R.containers[0].publicId).replace(/[^a-z0-9.-]+/gi, '-') + '-gtm-audit-' + R.generatedAt.slice(0, 10); }

  /* ---------- live-site scan (optional) ---------- */
  function scanFacts(S) {
    var path = function (u) { try { var x = new URL(u); return x.pathname + x.search; } catch (e) { return u; } };
    var facts = [];
    facts.push(['Pages read', S.ok + ' of ' + S.pages + (S.blocked ? ' (' + S.blocked + ' refused the scanner)' : '') + (S.sitemapUrls ? ', sampled from ' + S.sitemapUrls + ' sitemap URLs and internal links' : ', found through internal links')]);
    if (S.webId) facts.push([S.webId + ' installed', S.coverage + ' of ' + S.ok + ' pages' + (S.loaders.length ? ', served from ' + S.loaders.join(', ') : '')]);
    var others = S.containers.filter(function (c) { return c.id !== S.webId; });
    if (others.length) facts.push(['Other GTM containers', others.map(function (c) { return c.id + ' (' + c.pages + ' pages)'; }).join(', ')]);
    facts.push(['Consent', (S.cmp.length ? S.cmp.join(', ') : 'No consent banner in the source') + '; Consent Mode default in the source on ' + S.consentDefaultPages + ' pages']);
    if (S.events.length) facts.push(['dataLayer events in the source', S.events.join(', ')]);
    if (S.platform.length) facts.push(['Platform', S.platform.join(', ')]);
    return { facts: facts, path: path };
  }
  var SCAN_INTRO = 'The scan read the HTML source of each page, the way a crawler does, following the sitemap and internal links and respecting robots.txt. Anything found in the source runs outside GTM. Tags that GTM fires at runtime are not in the source, so they are not listed here; the configuration audit covers them.';

  /* ---------- Markdown ---------- */
  function md(R) {
    var esc = function (s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); };
    var L = [];
    var F = R.format || {}, on = function (k) { return !F.sections || F.sections[k] !== false; };
    L.push('# ' + (F.title || 'GTM container audit') + (R.website ? ': ' + R.website : ''), '');
    if (F.preparedFor || F.preparedBy) L.push([F.preparedFor ? 'Prepared for ' + F.preparedFor : '', F.preparedBy ? 'Prepared by ' + F.preparedBy : ''].filter(Boolean).join(' · ') + '.', '');
    L.push('Generated ' + date(R.generatedAt) + '. Static, read-only audit of the exported configuration. Nothing was changed or published.', '');
    L.push('| Container | Type | Version | Score |', '|---|---|---|---:|');
    R.containers.forEach(function (c) { L.push('| ' + esc(c.name) + ' (' + c.publicId + ') | ' + ctxLabel(c) + ' | ' + esc(c.version ? c.version + (c.versionName ? ' · ' + c.versionName : '') : 'workspace') + ' | ' + c.score + ' |'); });
    L.push('', '## Summary', '');
    L.push('- **Overall configuration score:** ' + R.score + ' / 100');
    L.push('- **Fix first:** ' + R.counts.critical + ' · **Confirm:** ' + R.counts.review + ' · **Notes:** ' + R.counts.info);
    if (reviewLine(R)) L.push('- **Review:** ' + reviewLine(R));
    if (R.flow) L.push('- **Web → server routes:** ' + R.flow.summary.routes + ' traced, ' + R.flow.summary.delivered + ' delivered, ' + R.flow.summary.conditional + ' conditional, ' + R.flow.summary.dead + ' dead ends' + (R.flow.summary.unknown ? ', ' + R.flow.summary.unknown + ' unresolved' : ''));
    L.push('', '### Scores by check', '');
    L.push('| Check | ' + R.containers.map(function (c) { return c.publicId; }).join(' | ') + ' |', '|---|' + R.containers.map(function () { return '---:'; }).join('|') + '|');
    R.containers[0].dims.forEach(function (d, i) { L.push('| ' + d.label + ' | ' + R.containers.map(function (c) { return c.dims[i].score; }).join(' | ') + ' |'); });
    ['critical', 'review'].forEach(function (sev) {
      if (!on(sev === 'critical' ? 'fix' : 'confirm')) return;
      var rows = R.items.filter(function (i) { return i.severity === sev; });
      L.push('', '## ' + SEV[sev] + ' (' + rows.length + ')', '');
      if (!rows.length) { L.push('Nothing in this group.'); return; }
      L.push(sev === 'critical' ? 'These cannot work as configured. Fix them before anything else.' : 'These need a decision from someone who knows the setup.', '');
      L.push('| Element | Container | Check | Finding | Decision |', '|---|---|---|---|---|');
      rows.forEach(function (i) { L.push('| ' + esc(i.name) + ' <br>' + i.kind + ' ' + esc(i.ref) + ' | ' + i.container + ' | ' + i.check + ' | ' + esc(i.message) + ' | ' + esc(decText(i) || 'Open') + ' |'); });
    });
    if (R.flow && on('flow')) {
      L.push('', '## Web → server signal flow', '');
      L.push('Each web tag that sends to the server container (' + (R.flow.hosts.join(', ') || 'no endpoint found') + ') was matched to the client that claims it, its event name was tested against every server trigger, and the server tags those triggers fire were followed to their destination.' + (R.flow.paired ? '' : ' The server container does not list the web container ID, so the pairing is assumed.'), '');
      L.push('| Status | Web tag | Event | Client | Server tags | Destinations |', '|---|---|---|---|---|---|');
      R.flow.routes.forEach(function (r) { L.push('| ' + STATUS[r.status] + ' | ' + esc(r.tag) + ' | ' + esc(r.event || '—') + ' | ' + esc(r.client || '—') + ' | ' + esc(r.tags.join(', ') || 'none') + ' | ' + esc(r.destinations.join(', ') || '—') + ' |'); });
      var why = R.flow.routes.filter(function (r) { return r.reason; });
      if (why.length) { L.push(''); why.forEach(function (r) { L.push('- **' + esc(r.tag) + ':** ' + esc(r.reason)); }); }
    }
    if (R.scan && on('scan')) {
      L.push('', '## Live site scan: ' + R.scan.website, '');
      if (R.scan.error) L.push('The live-site scan did not finish: ' + esc(R.scan.error) + ' The configuration audit above is unaffected.');
      else {
        var sf = scanFacts(R.scan);
        L.push(SCAN_INTRO, '');
        sf.facts.forEach(function (f) { L.push('- **' + f[0] + ':** ' + esc(f[1])); });
        if (R.scan.hardcoded.length) { L.push('', '| Hard-coded outside GTM | ID | Pages |', '|---|---|---:|'); R.scan.hardcoded.forEach(function (h) { L.push('| ' + esc(h.vendor) + ' | ' + esc(h.id || '—') + ' | ' + h.pages + ' |'); }); }
        else L.push('', 'No tracking tags are hard-coded in the page source; everything found runs through GTM.');
        L.push('', '| Page | Result |', '|---|---|');
        R.scan.pages.forEach(function (p) { L.push('| ' + esc(sf.path(p.url)) + ' | ' + esc(p.status === 'ok' ? 'Read' + (p.title ? ': ' + p.title : '') : (p.error || 'Not read')) + ' |'); });
      }
    }
    if (R.notes.length && on('notes')) {
      L.push('', '## Housekeeping notes', '');
      L.push('| Count | Container | Note | Examples |', '|---:|---|---|---|');
      R.notes.forEach(function (g) { L.push('| ' + g.count + ' | ' + g.container + ' | ' + esc(g.message) + ' | ' + esc(g.examples.join(', ') + (g.count > g.examples.length ? ', …' : '')) + ' |'); });
    }
    if (on('inventory')) {
    L.push('', '## Inventory', '');
    L.push('| Container | Tags | Triggers | Variables | Clients | Folders |', '|---|---:|---:|---:|---:|---:|');
    R.containers.forEach(function (c) { L.push('| ' + c.publicId + ' | ' + c.counts.tags + ' | ' + c.counts.triggers + ' | ' + c.counts.variables + ' | ' + (c.counts.clients || '—') + ' | ' + c.counts.folders + ' |'); });
    L.push('', 'Tags by platform: ' + Object.keys(R.vendors).sort(function (a, b) { return R.vendors[b] - R.vendors[a]; }).map(function (v) { return v + ' ' + R.vendors[v]; }).join(', ') + '.');
    }
    if (on('scope')) {
      L.push('', '## What this audit did not check, and how to check it', '');
      L.push('| Not checked | How to check it |', '|---|---|');
      R.skipped.forEach(function (s) { L.push('| ' + esc(s[0]) + ' | ' + esc(s[1]) + ' |'); });
      L.push('', R.scope, '');
    }
    return L.join('\n');
  }

  /* ---------- PDF ---------- */
  var C0 = { ink: [23, 21, 15], muted: [107, 101, 87], rule: [220, 214, 200], wash: [246, 243, 234], accent: [150, 118, 0], crit: [190, 52, 45], review: [168, 112, 0], note: [107, 101, 87], pass: [30, 128, 86] };
  var C = C0, SEVC = { critical: C0.crit, review: C0.review, info: C0.note };
  function ascii(s) { return String(s == null ? '' : s).replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '|').replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, ''); }
  function pdf(R, jsPDF) {
    var F = R.format || {}, on = function (k) { return !F.sections || F.sections[k] !== false; };
    C = F.accent ? Object.assign({}, C0, { accent: F.accent }) : C0;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, y;
    var color = function (c) { doc.setTextColor(c[0], c[1], c[2]); };
    var fill = function (c) { doc.setFillColor(c[0], c[1], c[2]); };
    var stroke = function (c) { doc.setDrawColor(c[0], c[1], c[2]); };
    var text = function (s, x, yy, o) { doc.text(ascii(s), x, yy, o); };
    var label = function (s, x, yy) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setCharSpace(1.1); color(C.muted); text(s.toUpperCase(), x, yy); doc.setCharSpace(0); };
    var section = function (title, note) {
      if (y > H - 140) { doc.addPage(); y = M + 10; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); color(C.ink); text(title, M, y); y += 8;
      stroke(C.rule); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 14;
      if (note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(C.muted); var ls = doc.splitTextToSize(ascii(note), W - 2 * M); doc.text(ls, M, y); y += ls.length * 11.5 + 6; }
    };
    var table = function (head, body, opts) {
      doc.autoTable(Object.assign({
        startY: y, head: [head], body: body, margin: { left: M, right: M, top: M, bottom: 54 }, theme: 'plain',
        styles: { font: 'helvetica', fontSize: 8.4, cellPadding: { top: 5, bottom: 5, left: 5, right: 5 }, textColor: C.ink, lineColor: C.rule, lineWidth: { bottom: 0.4 }, overflow: 'linebreak', valign: 'top' },
        headStyles: { fontStyle: 'bold', fontSize: 7.4, textColor: C.muted, fillColor: C.wash, lineWidth: 0 },
      }, opts || {}));
      y = doc.lastAutoTable.finalY + 22;
    };

    /* page 1: executive summary */
    fill(C.ink); doc.rect(0, 0, W, 6, 'F'); fill(C.accent); doc.rect(0, 6, W, 2, 'F');
    y = M + 8; label(F.title || 'GTM container audit', M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color(C.muted); text(date(R.generatedAt), W - M, y, { align: 'right' });
    y += 30; doc.setFont('helvetica', 'bold'); doc.setFontSize(26); color(C.ink); text(R.website || R.containers[0].name, M, y);
    y += 20; doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color(C.muted);
    text(R.containers.map(function (c) { return ctxLabel(c) + ' ' + c.publicId + (c.version ? ' (v' + c.version + ')' : ''); }).join('   |   '), M, y);
    if (F.preparedFor || F.preparedBy) { y += 14; doc.setFontSize(9); text([F.preparedFor ? 'Prepared for ' + F.preparedFor : '', F.preparedBy ? 'Prepared by ' + F.preparedBy : ''].filter(Boolean).join('   |   '), M, y); }
    y += 30;
    // score + severity tiles
    var top = y, tileW = (W - 2 * M - 16) / 4;
    fill(C.wash); doc.roundedRect(M, top, tileW, 86, 3, 3, 'F');
    label('Configuration score', M + 12, top + 18);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(38); color(R.score >= 85 ? C.pass : R.score >= 65 ? C.accent : C.crit); text(String(R.score), M + 12, top + 62);
    var sw = doc.getTextWidth(String(R.score)); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color(C.muted); text('/ 100', M + 16 + sw, top + 62);
    [['critical', 'Fix first', 'Cannot work as configured'], ['review', 'Confirm', 'Needs a decision'], ['info', 'Notes', 'Housekeeping']].forEach(function (s, i) {
      var x = M + (tileW + 16 / 3) * (i + 1);
      stroke(C.rule); doc.setLineWidth(0.6); doc.roundedRect(x, top, tileW, 86, 3, 3, 'S');
      fill(SEVC[s[0]]); doc.rect(x, top + 10, 2.5, 66, 'F');
      label(s[1], x + 12, top + 18);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(28); color(SEVC[s[0]]); text(String(R.counts[s[0]]), x + 12, top + 56);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color(C.muted); text(s[2], x + 12, top + 72);
    });
    y = top + 112;
    // scores by check
    label('Scores by check', M, y); y += 14;
    var colW = (W - 2 * M - 110) / R.containers.length;
    R.containers.forEach(function (c, ci) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); color(C.ink); text(c.publicId + '  ' + c.score, M + 110 + ci * colW, y); });
    y += 10;
    R.containers[0].dims.forEach(function (d, i) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(C.ink); text(d.label, M, y + 7);
      R.containers.forEach(function (c, ci) {
        var x = M + 110 + ci * colW, bw = colW - 46, v = c.dims[i].score;
        fill(C.wash); doc.rect(x, y + 1, bw, 7, 'F');
        fill(v >= 90 ? C.pass : v >= 60 ? C.accent : C.crit); doc.rect(x, y + 1, Math.max(1.5, bw * v / 100), 7, 'F');
        doc.setFontSize(8.5); color(C.muted); text(String(v), x + bw + 8, y + 7.5);
      });
      y += 17;
    });
    y += 14;
    // top issues
    var top5 = R.items.slice(0, 6);
    label('What to fix first', M, y); y += 12;
    if (!top5.length) { doc.setFontSize(10); color(C.muted); text('No fix-first or confirm findings.', M, y + 8); y += 20; }
    top5.forEach(function (it) {
      if (y > H - 110) return;
      fill(SEVC[it.severity]); doc.circle(M + 3, y + 5, 2.6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); color(C.ink); text(it.name, M + 12, y + 8);
      var nameW = doc.getTextWidth(ascii(it.name));
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color(C.muted); text(SEV[it.severity] + '  |  ' + it.container + '  |  ' + it.check, M + 18 + nameW, y + 8);
      doc.setFontSize(9); color(C.ink); var ls = doc.splitTextToSize(ascii(it.message), W - 2 * M - 12); doc.text(ls.slice(0, 2), M + 12, y + 21);
      y += 21 + Math.min(2, ls.length) * 11 + 6;
    });
    if (reviewLine(R)) { y += 4; doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); color(C.ink); text(reviewLine(R), M, y + 6); y += 18; }
    if (R.flow) {
      y += 6; stroke(C.rule); doc.line(M, y, W - M, y); y += 16; label('Web to server signal flow', M, y); y += 14;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); color(C.ink);
      var s = R.flow.summary; text(s.routes + ' routes traced:  ' + s.delivered + ' delivered,  ' + s.conditional + ' conditional,  ' + s.dead + ' dead ends' + (s.unknown ? ',  ' + s.unknown + ' unresolved' : '') + '.', M, y);
    }

    /* findings */
    doc.addPage(); y = M + 10;
    ['critical', 'review'].forEach(function (sev) {
      if (!on(sev === 'critical' ? 'fix' : 'confirm')) return;
      var rows = R.items.filter(function (i) { return i.severity === sev; });
      if (!rows.length) return;
      section(SEV[sev] + ' (' + rows.length + ')', sev === 'critical' ? 'These cannot work as configured. Fix them before anything else.' : 'These need a decision from someone who knows the setup: keep, merge, rename or remove.');
      var anyDec = R.items.some(function (i) { return i.decision; });
      table(['Element', 'Container', 'Check', 'Finding'].concat(anyDec ? ['Decision'] : []), rows.map(function (i) { return [ascii(i.name) + '\n' + i.kind + ' ' + ascii(i.ref), i.container, i.check, ascii(i.message)].concat(anyDec ? [ascii(decText(i) || 'Open')] : []); }),
        { columnStyles: anyDec ? { 0: { cellWidth: 112, fontStyle: 'bold' }, 1: { cellWidth: 74, textColor: C.muted }, 2: { cellWidth: 58, textColor: SEVC[sev] }, 3: {}, 4: { cellWidth: 90 } } : { 0: { cellWidth: 150, fontStyle: 'bold' }, 1: { cellWidth: 76, textColor: C.muted }, 2: { cellWidth: 62, textColor: SEVC[sev] }, 3: {} },
          didParseCell: function (d) { if (d.section === 'body' && d.column.index === 4) { var it = rows[d.row.index]; d.cell.styles.textColor = it.decision === 'fix' ? C.crit : it.decision === 'keep' ? C.pass : it.decision === 'ask' ? C.review : C.muted; d.cell.styles.fontStyle = 'bold'; } } });
    });
    if (R.flow && on('flow')) {
      section('Web to server signal flow', 'Each web tag that sends to the server container (' + (R.flow.hosts.join(', ') || 'no endpoint') + ') was matched to the client that claims it, its event name tested against every server trigger, and the server tags those triggers fire followed to their destination.' + (R.flow.paired ? '' : ' The server container does not list the web container ID, so the pairing is assumed.'));
      table(['Status', 'Web tag', 'Event', 'Server tags', 'Destination'], R.flow.routes.map(function (r) { return [STATUS[r.status], ascii(r.tag) + (r.reason ? '\n' + ascii(r.reason) : ''), ascii(r.event || '-'), ascii(r.tags.join(', ') || 'none'), ascii(r.destinations.join(', ') || '-')]; }),
        { columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' }, 1: { cellWidth: 170 }, 2: { cellWidth: 80 } },
          didParseCell: function (d) { if (d.section === 'body' && d.column.index === 0) { var st = R.flow.routes[d.row.index].status; d.cell.styles.textColor = st === 'delivered' ? C.pass : st === 'dead-end' ? C.crit : C.review; } } });
    }
    if (R.scan && on('scan')) {
      if (R.scan.error) section('Live site scan: ' + ascii(R.scan.website), 'The live-site scan did not finish: ' + ascii(R.scan.error) + ' The configuration audit is unaffected.');
      else {
        var sf = scanFacts(R.scan);
        section('Live site scan: ' + ascii(R.scan.website), SCAN_INTRO);
        table(['What the source shows', ''], sf.facts.map(function (f) { return [ascii(f[0]), ascii(f[1])]; }), { columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' } } });
        if (R.scan.hardcoded.length) table(['Hard-coded outside GTM', 'ID', 'Pages'], R.scan.hardcoded.map(function (h) { return [ascii(h.vendor), ascii(h.id || '-'), h.pages]; }), { columnStyles: { 2: { halign: 'right', cellWidth: 50 } } });
        table(['Page', 'Result'], R.scan.pages.map(function (p) { return [ascii(sf.path(p.url)), ascii(p.status === 'ok' ? 'Read' + (p.title ? ': ' + p.title : '') : (p.error || 'Not read'))]; }), { columnStyles: { 0: { cellWidth: 220 } } });
      }
    }
    if (R.notes.length && on('notes')) {
      section('Housekeeping notes', 'Low-risk items. Worth a tidy-up pass; none of them stop data from flowing.');
      table(['Count', 'Container', 'Note', 'Examples'], R.notes.map(function (g) { return [String(g.count), g.container, ascii(g.message), ascii(g.examples.join(', ') + (g.count > g.examples.length ? ', ...' : ''))]; }),
        { columnStyles: { 0: { cellWidth: 40, halign: 'right', fontStyle: 'bold' }, 1: { cellWidth: 76, textColor: C.muted }, 2: { cellWidth: 190 } } });
    }
    if (on('inventory')) {
    section('Inventory');
    table(['Container', 'Type', 'Tags', 'Triggers', 'Variables', 'Clients', 'Folders'], R.containers.map(function (c) { return [ascii(c.name) + '\n' + c.publicId, ctxLabel(c), c.counts.tags, c.counts.triggers, c.counts.variables, c.counts.clients || '-', c.counts.folders]; }),
      { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } });
    var vend = Object.keys(R.vendors).sort(function (a, b) { return R.vendors[b] - R.vendors[a]; });
    table(['Platform', 'Tags'], vend.map(function (v) { return [ascii(v), R.vendors[v]]; }), { tableWidth: 240, columnStyles: { 1: { halign: 'right' } } });
    }
    if (on('scope')) {
      section('What this audit did not check, and how to check it', R.scope);
      table(['Not checked', 'How to check it'], R.skipped.map(function (s) { return [ascii(s[0]), ascii(s[1])]; }), { columnStyles: { 0: { cellWidth: 150, fontStyle: 'bold' } } });
    }

    /* footer on every page */
    var n = doc.getNumberOfPages();
    for (var p = 1; p <= n; p++) {
      doc.setPage(p); stroke(C.rule); doc.setLineWidth(0.5); doc.line(M, H - 34, W - M, H - 34);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color(C.muted);
      text((R.website || R.containers[0].publicId) + '  |  ' + (F.title || 'GTM container audit') + (F.preparedBy ? '  |  ' + F.preparedBy : '') + '  |  static, read-only review of the exported configuration', M, H - 22);
      text(p + ' / ' + n, W - M, H - 22, { align: 'right' });
    }
    return doc.output('arraybuffer');
  }
  return { markdown: md, pdf: pdf, fileBase: fileBase };
})();
if (typeof module !== 'undefined') module.exports = GTM_REPORT;

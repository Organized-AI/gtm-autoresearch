#!/usr/bin/env python3
"""Assemble the single-file Container Atlas page from src/."""
import json, pathlib
here = pathlib.Path(__file__).parent
src = lambda n: (here / 'src' / n).read_text()

markup = src('atlas-markup.html')
markup = markup.replace('<div id="app">', '<div id="app" hidden>', 1)
markup = markup.replace('<span class="spacer"></span><button id="reset" class="primary">Reset</button>',
  '<span class="spacer"></span>'
  '<div class="reportbar"><button id="reviewBtn" type="button" aria-pressed="true">Review</button>'
  '<button id="pdfBtn" type="button" class="primary">PDF report</button>'
  '<button id="mdBtn" type="button">Markdown</button>'
  '<button id="newBtn" type="button">New audit</button>'
  '<span class="rmsg" id="rmsg" aria-live="polite"></span></div>'
  '<button id="reset" type="button">Reset view</button>', 1)
assert 'reviewBtn' in markup
i = markup.rindex('</aside>') + len('</aside>')
markup = markup[:i] + '\n' + src('review.html') + markup[i:]

sample = json.dumps({
  'web': json.loads((here / 'fixtures/sample-web.json').read_text()),
  'server': json.loads((here / 'fixtures/sample-server.json').read_text()),
}, separators=(',', ':')).replace('</', '<\\/')

page = f'''<title>GTM Container Atlas</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap">
<style>{src('atlas.css')}
{src('intake.css')}</style>
{src('intake.html')}
{markup}
<script type="application/json" id="sample-data">{sample}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
<script>
{src('gtm-auto.js')}
{src('drift.js')}
{src('engine.js')}
{src('report.js')}
{src('atlas-client.js')}
{src('app.js')}
</script>
'''
out = here / 'container-atlas.html'
out.write_text(page)
print(out, len(page))

# Worker Assets need their own document skeleton (the Artifact host adds one; Cloudflare does not).
def doc(body):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>html,body{margin:0}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>')
pub = here / 'worker' / 'public'; pub.mkdir(parents=True, exist_ok=True)
(pub / 'index.html').write_text(doc(page))
(pub / 'drift.html').write_text(doc(src('drift-page.html')))
(pub / 'build.html').write_text(doc(src('build-page.html')))
(pub / 'runs.html').write_text(doc(src('runs-page.html')))
(pub / 'openrouter-callback.html').write_text(doc(src('openrouter-callback.html')))
(pub / '404.html').write_text(doc('<title>Not found</title><main style="font-family:monospace;padding:48px 16px;background:#0c0b09;color:#f7f2df;min-height:100vh"><h1>Page not found</h1><p><a style="color:#ffe94a" href="/">Start a new audit</a></p></main>'))
(here / 'worker' / 'src' / 'drift.js').write_text(src('drift.js').replace("if (typeof module !== 'undefined') module.exports = GTM_DRIFT;", 'export default GTM_DRIFT;'))
print('worker assets written')

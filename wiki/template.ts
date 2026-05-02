/**
 * HTML templates for the two documentation sites.
 *
 * - wikiTemplate()  — Single-page wiki style (Wrangler CLI Wiki)
 * - guideTemplate() — Tabbed multi-page guide style (MLX Guide)
 */

// ─── Shared ─────────────────────────────────────────────────────────────────

function sharedHead(title: string, cssPath: string, description?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0a0a0a">
  ${description ? `<meta name="description" content="${escapeAttr(description)}">` : ''}
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x1F4D6;</text></svg>">
  <link rel="stylesheet" href="${cssPath}">
</head>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Wiki Template (Wrangler) ───────────────────────────────────────────────

export interface WikiPage {
  slug: string;
  title: string;
  description: string;
  contentHtml: string;
  headings: { id: string; text: string; level: number }[];
}

export interface WikiSite {
  siteTitle: string;
  siteDescription: string;
  pages: WikiPage[];
}

/**
 * Generates the wiki index page.
 */
export function wikiIndexTemplate(site: WikiSite): string {
  const cssPath = './styles.css';
  const cards = site.pages
    .map(
      (p) => `    <a class="nav-card" href="./${p.slug}.html">
      <div class="nav-card-title">${escapeHtml(p.title)}</div>
      <div class="nav-card-desc">${escapeHtml(p.description)}</div>
    </a>`
    )
    .join('\n');

  return `${sharedHead(site.siteTitle, cssPath, site.siteDescription)}
<body>
<div class="page-wrapper">

  <h1 class="page-title">${escapeHtml(site.siteTitle)}</h1>
  <div class="page-subtitle">${escapeHtml(site.siteDescription)}</div>

  <div class="how-to-use">
    <div class="how-to-use-header">How To Use</div>
    <p>Click any page below to read the full reference. Each page covers a specific area of the CLI with commands, flags, code examples, and tips.</p>
  </div>

  <h2>Pages</h2>
  <div class="nav-grid">
${cards}
  </div>

  <div class="footer">
    Built with <a href="#">wiki/build.ts</a> &middot; Dark terminal aesthetic
  </div>

</div>
</body>
</html>`;
}

/**
 * Generates a single wiki content page.
 */
export function wikiPageTemplate(page: WikiPage, site: WikiSite): string {
  const cssPath = './styles.css';

  // TOC from h2 and h3 headings
  const tocItems = page.headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => {
      const indent = h.level === 3 ? '      ' : '    ';
      return `${indent}<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
    })
    .join('\n');

  // Sidebar nav links
  const navLinks = site.pages
    .map((p) => {
      const active = p.slug === page.slug ? ' class="active"' : '';
      return `    <li${active}><a href="./${p.slug}.html">${escapeHtml(p.title)}</a></li>`;
    })
    .join('\n');

  return `${sharedHead(`${page.title} - ${site.siteTitle}`, cssPath, page.description)}
<body>
<div class="page-wrapper">

  <div class="breadcrumb">
    <a href="./index.html">${escapeHtml(site.siteTitle)}</a>
    <span class="sep">/</span>
    ${escapeHtml(page.title)}
  </div>

  <h1 class="page-title">${escapeHtml(page.title)}</h1>
  <div class="page-subtitle">${escapeHtml(page.description)}</div>

${tocItems ? `  <div class="toc">
    <div class="toc-title">On This Page</div>
    <ul>
${tocItems}
    </ul>
  </div>` : ''}

  <div class="content">
${page.contentHtml}
  </div>

  <div class="footer">
    <a href="./index.html">&larr; Back to index</a> &middot;
    Built with <a href="#">wiki/build.ts</a>
  </div>

</div>
</body>
</html>`;
}

// ─── Guide Template (MLX) ───────────────────────────────────────────────────

export interface GuidePage {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  features: string[];
  contentHtml: string;
  headings: { id: string; text: string; level: number }[];
}

export interface GuideSite {
  siteTitle: string;
  siteDescription: string;
  version: string;
  pages: GuidePage[];
}

/**
 * Generates the guide index page.
 */
export function guideIndexTemplate(site: GuideSite): string {
  const cssPath = './styles.css';

  // Skip first page (Home) in tabs since we have a dedicated Home tab
  const tabs = site.pages
    .filter((p) => p.slug !== 'home')
    .map(
      (p) =>
        `    <a class="tab" href="./${p.slug}.html">${escapeHtml(p.shortTitle)}</a>`
    )
    .join('\n');

  const cards = site.pages
    .map(
      (p) => `    <a class="nav-card" href="./${p.slug}.html">
      <div class="nav-card-title">${escapeHtml(p.title)}</div>
      <div class="nav-card-desc">${escapeHtml(p.description)}</div>
${p.features.length > 0 ? `      <div class="chips-container" style="margin-top:10px;margin-bottom:0">${p.features.slice(0, 4).map((f) => `<span class="chip">${escapeHtml(f)}</span>`).join('')}</div>` : ''}
    </a>`
    )
    .join('\n');

  return `${sharedHead(site.siteTitle, cssPath, site.siteDescription)}
<body>
<div class="page-wrapper">

  <nav class="tabs">
    <a class="tab active" href="./index.html">Home</a>
${tabs}
  </nav>

  <h1 class="page-title">${escapeHtml(site.siteTitle)}</h1>
  <div class="page-subtitle">${escapeHtml(site.siteDescription)}</div>

  <div class="chips-container">
    <span class="chip">Apple Silicon</span>
    <span class="chip">Unified Memory</span>
    <span class="chip">Lazy Evaluation</span>
    <span class="chip">Metal GPU</span>
    <span class="chip">NumPy-like API</span>
  </div>

  <div class="nav-grid">
${cards}
  </div>

  <div class="footer">
    <span class="version-badge">v${escapeHtml(site.version)}</span> &middot;
    Built with <a href="#">wiki/build.ts</a>
  </div>

</div>
</body>
</html>`;
}

/**
 * Generates a single guide content page.
 */
export function guidePageTemplate(page: GuidePage, site: GuideSite): string {
  const cssPath = './styles.css';

  // Tab bar — skip "Home" page since there's a dedicated Home tab
  const tabs = site.pages
    .filter((p) => p.slug !== 'home')
    .map(
      (p) =>
        `    <a class="tab${p.slug === page.slug ? ' active' : ''}" href="./${p.slug}.html">${escapeHtml(p.shortTitle)}</a>`
    )
    .join('\n');

  // Feature chips
  const chips = page.features
    .map((f) => `<span class="chip">${escapeHtml(f)}</span>`)
    .join('');

  // TOC from h2 and h3 headings
  const tocItems = page.headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => {
      const indent = h.level === 3 ? '      ' : '    ';
      return `${indent}<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`;
    })
    .join('\n');

  return `${sharedHead(`${page.title} - ${site.siteTitle}`, cssPath, page.description)}
<body>
<div class="page-wrapper">

  <nav class="tabs">
    <a class="tab" href="./index.html">Home</a>
${tabs}
  </nav>

  <div class="breadcrumb">
    <a href="./index.html">${escapeHtml(site.siteTitle)}</a>
    <span class="sep">/</span>
    ${escapeHtml(page.title)}
  </div>

  <h1 class="page-title">${escapeHtml(page.title)}</h1>
  <div class="page-subtitle">${escapeHtml(page.description)}</div>

${chips ? `  <div class="chips-container">${chips}</div>` : ''}

${tocItems ? `  <div class="toc">
    <div class="toc-title">On This Page</div>
    <ul>
${tocItems}
    </ul>
  </div>` : ''}

  <div class="content">
${page.contentHtml}
  </div>

  <div class="footer">
    <a href="./index.html">&larr; Back to index</a> &middot;
    <span class="version-badge">v${escapeHtml(site.version)}</span> &middot;
    Built with <a href="#">wiki/build.ts</a>
  </div>

</div>
</body>
</html>`;
}

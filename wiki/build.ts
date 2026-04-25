#!/usr/bin/env npx tsx
/**
 * wiki/build.ts
 *
 * Static site builder for two documentation sites:
 *   - Wrangler CLI Wiki  (wiki/wrangler/*.md  -> wiki/dist/wrangler/)
 *   - MLX Guide          (wiki/mlx/*.md       -> wiki/dist/mlx/)
 *
 * Usage:
 *   npx tsx wiki/build.ts
 *
 * No external dependencies beyond Node.js built-ins and tsx (already in devDeps).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  wikiIndexTemplate,
  wikiPageTemplate,
  guideIndexTemplate,
  guidePageTemplate,
  type WikiPage,
  type WikiSite,
  type GuidePage,
  type GuideSite,
} from './template.js';

// ─── Paths ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname));
const WRANGLER_SRC = path.join(ROOT, 'wrangler');
const MLX_SRC = path.join(ROOT, 'mlx');
const DIST_WRANGLER = path.join(ROOT, 'dist', 'wrangler');
const DIST_MLX = path.join(ROOT, 'dist', 'mlx');
const STYLES_PATH = path.join(ROOT, 'styles.css');

// ─── Markdown Parser ────────────────────────────────────────────────────────

interface Heading {
  id: string;
  text: string;
  level: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Process inline markdown: bold, italic, inline code, links, images, strikethrough.
 */
function processInline(text: string): string {
  // Inline code first (protect from other transforms)
  const codeSegments: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = codeSegments.length;
    codeSegments.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  // Images: ![alt](src "title")
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt, src, title) => {
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${t}>`;
  });

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, url) => {
    return `<a href="${escapeHtml(url)}">${linkText}</a>`;
  });

  // Wiki links: [[Page Name]] -> just render as text (no actual page linking for cross-refs)
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_m, page) => {
    // Link to slug if it looks like a page ref
    const parts = page.split('#');
    const pageName = parts[0].trim();
    const anchor = parts[1] ? `#${slugify(parts[1])}` : '';
    if (pageName) {
      const slug = slugify(pageName);
      return `<a href="./${slug}.html${anchor}">${escapeHtml(page)}</a>`;
    }
    return `<a href="${anchor}">${escapeHtml(page)}</a>`;
  });

  // Bold + italic: ***text*** or ___text___
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (but not in the middle of words)
  text = text.replace(/(?<![a-zA-Z0-9])\*([^*]+)\*(?![a-zA-Z0-9])/g, '<em>$1</em>');
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Restore code segments
  text = text.replace(/\x00CODE(\d+)\x00/g, (_m, idx) => codeSegments[parseInt(idx)]);

  return text;
}

/**
 * Convert a markdown string to HTML. Returns { html, headings }.
 */
function markdownToHtml(md: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const lines = md.split('\n');
  const output: string[] = [];

  let i = 0;
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';
  let inTable = false;
  let tableRows: string[][] = [];
  let tableAlign: string[] = [];
  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  function closeList() {
    if (inList) {
      output.push(`</${listType}>`);
      inList = false;
    }
  }

  function closeTable() {
    if (inTable && tableRows.length > 0) {
      let html = '<table>\n<thead>\n<tr>';
      const headers = tableRows[0];
      for (let c = 0; c < headers.length; c++) {
        const align = tableAlign[c] ? ` style="text-align:${tableAlign[c]}"` : '';
        html += `<th${align}>${processInline(headers[c].trim())}</th>`;
      }
      html += '</tr>\n</thead>\n<tbody>';
      for (let r = 1; r < tableRows.length; r++) {
        html += '\n<tr>';
        for (let c = 0; c < tableRows[r].length; c++) {
          const align = tableAlign[c] ? ` style="text-align:${tableAlign[c]}"` : '';
          html += `<td${align}>${processInline(tableRows[r][c].trim())}</td>`;
        }
        html += '</tr>';
      }
      html += '\n</tbody>\n</table>';
      output.push(html);
      inTable = false;
      tableRows = [];
      tableAlign = [];
    }
  }

  function closeBlockquote() {
    if (inBlockquote) {
      const inner = blockquoteLines.join('\n');
      const { html } = markdownToHtml(inner);
      output.push(`<blockquote>\n${html}\n</blockquote>`);
      inBlockquote = false;
      blockquoteLines = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code blocks ──
    if (!inCodeBlock && /^```(\w*)/.test(line)) {
      closeList();
      closeTable();
      closeBlockquote();
      const match = line.match(/^```(\w*)/);
      codeLang = match?.[1] ?? '';
      codeLines = [];
      inCodeBlock = true;
      i++;
      continue;
    }

    if (inCodeBlock) {
      if (line.startsWith('```')) {
        const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
        output.push(
          `<pre${langAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`
        );
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        codeLines.push(line);
      }
      i++;
      continue;
    }

    // ── Blank line ──
    if (line.trim() === '') {
      closeList();
      closeTable();
      closeBlockquote();
      i++;
      continue;
    }

    // ── Blockquote ──
    if (/^>\s?/.test(line)) {
      closeList();
      closeTable();
      const content = line.replace(/^>\s?/, '');
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteLines = [content];
      } else {
        blockquoteLines.push(content);
      }
      i++;
      continue;
    } else if (inBlockquote) {
      closeBlockquote();
    }

    // ── Horizontal rule ──
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      closeList();
      closeTable();
      output.push('<hr>');
      i++;
      continue;
    }

    // ── Headings (ATX style) ──
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    if (headingMatch) {
      closeList();
      closeTable();
      const level = headingMatch[1].length;
      const rawText = headingMatch[2];
      const text = processInline(rawText);
      // Strip HTML tags for the plain-text slug and heading record
      const plainText = rawText.replace(/<[^>]+>/g, '').replace(/`([^`]+)`/g, '$1');
      const id = slugify(plainText);
      headings.push({ id, text: plainText, level });
      output.push(`<h${level} id="${id}">${text}</h${level}>`);
      i++;
      continue;
    }

    // ── Table ──
    const tableRowMatch = line.match(/^\|(.+)\|$/);
    if (tableRowMatch) {
      closeList();
      closeBlockquote();
      const cells = tableRowMatch[1].split('|').map((c) => c.trim());

      // Check if next line is a separator
      if (!inTable) {
        const nextLine = lines[i + 1]?.trim() ?? '';
        if (/^\|[\s:|-]+\|$/.test(nextLine)) {
          // This is a table header
          inTable = true;
          tableRows = [cells];
          // Parse alignment from separator
          const sepCells = nextLine.replace(/^\||\|$/g, '').split('|');
          tableAlign = sepCells.map((s) => {
            s = s.trim();
            if (s.startsWith(':') && s.endsWith(':')) return 'center';
            if (s.endsWith(':')) return 'right';
            return '';
          });
          i += 2; // skip header + separator
          continue;
        }
      }

      if (inTable) {
        tableRows.push(cells);
        i++;
        continue;
      }
    } else if (inTable) {
      closeTable();
    }

    // ── Unordered list ──
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.+)/);
    if (ulMatch) {
      closeTable();
      closeBlockquote();
      if (!inList) {
        inList = true;
        listType = 'ul';
        output.push('<ul>');
      } else if (listType !== 'ul') {
        output.push(`</${listType}>`);
        listType = 'ul';
        output.push('<ul>');
      }
      output.push(`<li>${processInline(ulMatch[2])}</li>`);
      i++;
      continue;
    }

    // ── Ordered list ──
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      closeTable();
      closeBlockquote();
      if (!inList) {
        inList = true;
        listType = 'ol';
        output.push('<ol>');
      } else if (listType !== 'ol') {
        output.push(`</${listType}>`);
        listType = 'ol';
        output.push('<ol>');
      }
      output.push(`<li>${processInline(olMatch[2])}</li>`);
      i++;
      continue;
    }

    // ── Paragraph ──
    closeList();
    closeTable();
    // Gather contiguous non-blank, non-special lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>\s?|[-*_]{3,}\s*$|\|.*\|$|(\s*)[*+-]\s|(\s*)\d+\.\s)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    output.push(`<p>${processInline(paraLines.join('\n'))}</p>`);
  }

  // Close any dangling blocks
  if (inCodeBlock) {
    const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
    output.push(`<pre${langAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  closeList();
  closeTable();
  closeBlockquote();

  return { html: output.join('\n'), headings };
}

// ─── File Utilities ─────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readMarkdownFiles(dir: string): { slug: string; raw: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => {
      // Put Home first
      if (a === 'Home.md') return -1;
      if (b === 'Home.md') return 1;
      return a.localeCompare(b);
    })
    .map((f) => ({
      slug: slugify(f.replace(/\.md$/, '')),
      raw: fs.readFileSync(path.join(dir, f), 'utf-8'),
    }));
}

/**
 * Extract the first heading and first paragraph as title/description.
 */
function extractMeta(raw: string): { title: string; description: string; features: string[] } {
  const titleMatch = raw.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].replace(/`/g, '') : 'Untitled';

  // First paragraph after the title (non-heading, non-blank)
  const lines = raw.split('\n');
  let desc = '';
  let pastTitle = false;
  for (const line of lines) {
    if (!pastTitle) {
      if (/^#\s+/.test(line)) pastTitle = true;
      continue;
    }
    if (line.trim() === '') continue;
    if (line.startsWith('#') || line.startsWith('---') || line.startsWith('|') || line.startsWith('```')) break;
    desc = line.trim();
    break;
  }

  // Extract features from "Key Features" or "Key characteristics" section
  const features: string[] = [];
  const featureRegex = /^\d+\.\s+\*\*(.+?)\*\*/gm;
  let fm;
  while ((fm = featureRegex.exec(raw)) !== null) {
    features.push(fm[1]);
    if (features.length >= 6) break;
  }

  // Also try bullet points with bold
  if (features.length === 0) {
    const bulletFeatureRegex = /^[-*]\s+\*\*(.+?)\*\*/gm;
    let bm;
    while ((bm = bulletFeatureRegex.exec(raw)) !== null) {
      features.push(bm[1]);
      if (features.length >= 6) break;
    }
  }

  return { title, description: desc, features };
}

/**
 * Generate a concise tab label from a slug and full title.
 */
function makeShortTitle(slug: string, fullTitle: string): string {
  if (slug === 'home') return 'Overview';

  // Map of known abbreviations that should stay uppercase
  const upperTokens = new Set(['lm', 'nn', 'mlx', 'api', 'cli', 'gpu', 'cpu', 'jit']);

  // Strip leading "mlx-" prefix from the slug
  let label = slug.replace(/^mlx-?/, '');

  // If stripping left nothing, fall back to the full title
  if (!label) return fullTitle;

  // Convert slug dashes to spaces, capitalize properly
  label = label
    .split('-')
    .map((tok) => {
      if (upperTokens.has(tok)) return tok.toUpperCase();
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join(' ');

  return label;
}

// ─── Build Wrangler Wiki ────────────────────────────────────────────────────

function buildWrangler() {
  console.log('Building Wrangler CLI Wiki...');
  ensureDir(DIST_WRANGLER);

  // Copy CSS
  fs.copyFileSync(STYLES_PATH, path.join(DIST_WRANGLER, 'styles.css'));

  const files = readMarkdownFiles(WRANGLER_SRC);
  if (files.length === 0) {
    console.log('  No markdown files found in wiki/wrangler/');
    return;
  }

  const pages: WikiPage[] = files.map((f) => {
    const meta = extractMeta(f.raw);
    const { html, headings } = markdownToHtml(f.raw);
    return {
      slug: f.slug,
      title: meta.title,
      description: meta.description,
      contentHtml: html,
      headings,
    };
  });

  const site: WikiSite = {
    siteTitle: 'Wrangler CLI Wiki',
    siteDescription: 'Complete reference for Cloudflare Wrangler v4.x',
    pages,
  };

  // Write index
  fs.writeFileSync(path.join(DIST_WRANGLER, 'index.html'), wikiIndexTemplate(site));
  console.log(`  index.html`);

  // Write each page
  for (const page of pages) {
    const html = wikiPageTemplate(page, site);
    fs.writeFileSync(path.join(DIST_WRANGLER, `${page.slug}.html`), html);
    console.log(`  ${page.slug}.html`);
  }

  console.log(`  -> ${pages.length} pages written to wiki/dist/wrangler/`);
}

// ─── Build MLX Guide ────────────────────────────────────────────────────────

function buildMLX() {
  console.log('Building MLX Guide...');
  ensureDir(DIST_MLX);

  // Copy CSS
  fs.copyFileSync(STYLES_PATH, path.join(DIST_MLX, 'styles.css'));

  const files = readMarkdownFiles(MLX_SRC);
  if (files.length === 0) {
    console.log('  No markdown files found in wiki/mlx/');
    return;
  }

  const pages: GuidePage[] = files.map((f) => {
    const meta = extractMeta(f.raw);
    const { html, headings } = markdownToHtml(f.raw);
    // Derive a short tab label from the filename
    const shortTitle = makeShortTitle(f.slug, meta.title);
    return {
      slug: f.slug,
      title: meta.title,
      shortTitle,
      description: meta.description,
      features: meta.features,
      contentHtml: html,
      headings,
    };
  });

  const site: GuideSite = {
    siteTitle: 'MLX Guide',
    siteDescription: "Apple's machine learning framework for Apple Silicon",
    version: '0.25.0',
    pages,
  };

  // Write index
  fs.writeFileSync(path.join(DIST_MLX, 'index.html'), guideIndexTemplate(site));
  console.log(`  index.html`);

  // Write each page
  for (const page of pages) {
    const html = guidePageTemplate(page, site);
    fs.writeFileSync(path.join(DIST_MLX, `${page.slug}.html`), html);
    console.log(`  ${page.slug}.html`);
  }

  console.log(`  -> ${pages.length} pages written to wiki/dist/mlx/`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log('='.repeat(60));
  console.log('wiki/build.ts — Static site builder');
  console.log('='.repeat(60));
  console.log();

  buildWrangler();
  console.log();
  buildMLX();

  console.log();
  console.log('Done.');
}

main();

'use strict';
// Phone startup entry contract: the web app manifest, the brand icon
// files, and the public/index.html head metadata that pin a home-screen
// launch to "/" (the new Budget interface). Before this change the tree
// shipped no manifest, no start_url and no icon files at all, so a phone
// launch landed on whatever URL the shortcut or Safari restore held —
// including the legacy multi-page interface. This suite reads the
// shipped files directly and reconciles the standalone icon against the
// inline brand mark and its CSS fills; it does not execute the page.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
let failures = 0;
function ok(cond, msg, detail) {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}${!cond && detail ? `  — ${detail}` : ''}`);
  if (!cond) failures++;
}

function readPublic(rel) {
  const p = path.join(PUBLIC, rel);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
function rects(svgText) {
  return [...svgText.matchAll(/<rect\b[^>]*>/g)].map(m => attrs(m[0]));
}
function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!buf || buf.length < 24 || !sig.every((b, i) => buf[i] === b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// --- The manifest exists, parses, and pins the entry to "/" -----------
const manifestBuf = readPublic('manifest.webmanifest');
ok(manifestBuf !== null, 'public/manifest.webmanifest exists');
let manifest = null;
try { manifest = manifestBuf && JSON.parse(manifestBuf.toString('utf8')); } catch { /* stays null */ }
ok(manifest !== null && typeof manifest === 'object', 'manifest parses as JSON');
if (manifest) {
  ok(manifest.start_url === '/', 'manifest start_url is "/"', `got ${JSON.stringify(manifest.start_url)}`);
  ok(manifest.scope === '/', 'manifest scope is "/"', `got ${JSON.stringify(manifest.scope)}`);
  ok(manifest.display === 'standalone', 'manifest display is "standalone"', `got ${JSON.stringify(manifest.display)}`);
  ok(typeof manifest.name === 'string' && manifest.name.trim() !== '', 'manifest name is a non-empty string');
  ok(typeof manifest.short_name === 'string' && manifest.short_name.trim() !== '', 'manifest short_name is a non-empty string');
  ok(/^#[0-9a-fA-F]{6}$/.test(manifest.theme_color || ''), 'manifest theme_color is a hex colour', `got ${JSON.stringify(manifest.theme_color)}`);
  ok(/^#[0-9a-fA-F]{6}$/.test(manifest.background_color || ''), 'manifest background_color is a hex colour', `got ${JSON.stringify(manifest.background_color)}`);

  // --- Every named icon exists with the declared dimensions -----------
  ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest declares at least one icon');
  for (const icon of manifest.icons || []) {
    const label = `icon ${icon.src}`;
    ok(typeof icon.src === 'string' && icon.src.startsWith('/'), `${label}: src is a root-relative path`);
    if (typeof icon.src !== 'string') continue;
    const buf = readPublic(icon.src.replace(/^\//, ''));
    ok(buf !== null, `${label}: file exists under public/`);
    if (!buf) continue;
    if (icon.type === 'image/png') {
      const size = pngSize(buf);
      ok(size !== null, `${label}: file is a PNG with a readable IHDR`);
      if (size) {
        ok(icon.sizes === `${size.width}x${size.height}`,
          `${label}: declared sizes match the PNG's real dimensions`,
          `declared ${JSON.stringify(icon.sizes)}, actual ${size.width}x${size.height}`);
      }
    } else if (icon.type === 'image/svg+xml') {
      const text = buf.toString('utf8');
      ok(/<svg\b[^>]*viewBox="0 0 32 32"/.test(text), `${label}: SVG carries the brand mark viewBox`);
      ok(icon.sizes === 'any', `${label}: SVG icon declares sizes "any"`, `got ${JSON.stringify(icon.sizes)}`);
    } else {
      ok(false, `${label}: icon type is image/png or image/svg+xml`, `got ${JSON.stringify(icon.type)}`);
    }
  }
}

// --- The standalone icon is the inline brand mark, faithfully ---------
const indexHtml = readPublic('index.html').toString('utf8');
const blendCss = readPublic('budget-blend.css').toString('utf8');
const inlineMark = indexHtml.match(/<svg class="blend-mark"[^>]*>([\s\S]*?)<\/svg>/);
ok(inlineMark !== null, 'index.html still carries the inline blend-mark SVG');
const iconSvgBuf = readPublic('icon.svg');
ok(iconSvgBuf !== null, 'public/icon.svg exists');
if (inlineMark && iconSvgBuf) {
  const cssFill = cls => {
    const m = blendCss.match(new RegExp(`\\.${cls}\\s*\\{\\s*fill:\\s*(#[0-9a-fA-F]{6})`));
    return m && m[1].toLowerCase();
  };
  const expected = rects(inlineMark[1]).map(r => ({
    geometry: [r.x || '0', r.y || '0', r.width, r.height, r.rx || '0'].join('/'),
    fill: cssFill(r.class),
  }));
  const actual = rects(iconSvgBuf.toString('utf8')).map(r => ({
    geometry: [r.x || '0', r.y || '0', r.width, r.height, r.rx || '0'].join('/'),
    fill: (r.fill || '').toLowerCase(),
  }));
  ok(actual.length === expected.length && expected.length === 5,
    'icon.svg has the same five rects as the inline mark', `inline ${expected.length}, icon ${actual.length}`);
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    'icon.svg rects match the inline mark geometry and CSS fills exactly',
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- index.html head wiring --------------------------------------------
const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
ok(/<link rel="manifest" href="\/manifest\.webmanifest">/.test(head),
  'index.html head links the manifest');
const touch = head.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
ok(touch !== null, 'index.html head links an apple-touch-icon');
if (touch) {
  const size = pngSize(readPublic(touch[1].replace(/^\//, '')));
  ok(size !== null && size.width === 180 && size.height === 180,
    'apple-touch-icon target exists and is a 180x180 PNG',
    size ? `actual ${size.width}x${size.height}` : 'missing or not a PNG');
}
ok(/<meta name="apple-mobile-web-app-capable" content="yes">/.test(head),
  'index.html head declares apple-mobile-web-app-capable');
ok(/<meta name="apple-mobile-web-app-title" content="[^"]+">/.test(head),
  'index.html head declares apple-mobile-web-app-title');
ok(/<meta name="theme-color"[^>]*content="#[0-9a-fA-F]{6}"/.test(head),
  'index.html head declares a theme-color');

console.log(failures ? `\n${failures} startup-manifest check(s) FAILED` : '\nAll startup-manifest checks passed');
process.exit(failures ? 1 : 0);

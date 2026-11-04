/**
 * scripts/pwa-inject.js — DischargeBuddy PWA Post-Build Patcher
 *
 * Run AFTER `npx expo export --platform web` to make the output PWA-ready.
 *
 * Usage (add to package.json scripts):
 *   "export:web": "expo export --platform web && node scripts/pwa-inject.js"
 *
 * What it does:
 *  1. Scans dist/ for every JS, CSS, and HTML file → builds the real asset list
 *  2. Generates a build hash from the timestamp (or file content hashes)
 *  3. Writes dist/service-worker.js with the correct STATIC_ASSETS array stamped in
 *  4. Copies manifest.json to dist/manifest.json
 *  5. Patches every .html in dist/ to:
 *       - add <link rel="manifest"> pointing to /manifest.json
 *       - add <meta name="theme-color"> for browser chrome tinting
 *       - add <meta name="apple-mobile-web-app-*"> for iOS home-screen install
 *       - add a <script> that registers /service-worker.js
 *  6. Updates vercel.json to add correct Cache-Control headers for the SW
 *     (must be no-cache so the browser always checks for a new worker)
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const DIST       = path.join(ROOT, 'dist');
const SW_TMPL    = path.join(__dirname, '..', 'src', 'pwa', 'service-worker.js');  // template
const SW_DEST    = path.join(DIST, 'service-worker.js');                           // output
const MANIFEST_SRC  = path.join(__dirname, '..', 'src', 'pwa', 'manifest.json');
const MANIFEST_DEST = path.join(DIST, 'manifest.json');
const VERCEL_JSON   = path.join(ROOT, 'vercel.json');

// ─── Step 1: Collect all static asset URLs from dist/ ────────────────────────
function collectAssets() {
  const assets = new Set([
    '/',
    '/index.html',
    '/favicon.ico',
    '/manifest.json',
    '/service-worker.js',
  ]);

  function walk(dir, base = '') {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const relPath  = base + '/' + entry;
      const stat     = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Skip node_modules in dist/assets
        if (entry === 'node_modules') continue;
        walk(fullPath, relPath);
      } else {
        // Only cache files the browser actually needs
        const ext = path.extname(entry).toLowerCase();
        if (['.js', '.css', '.html', '.json', '.ico', '.png', '.jpg', '.svg', '.woff', '.woff2', '.ttf'].includes(ext)) {
          assets.add(relPath);
        }
      }
    }
  }

  walk(DIST);
  return Array.from(assets).sort();
}

// ─── Step 2: Build hash from current timestamp + file count ──────────────────
function buildHash(assets) {
  const ts = Date.now().toString(36);
  const ct = assets.length.toString(36);
  return `${ts}-${ct}`;
}

// ─── Step 3: Write service-worker.js with stamped asset list + hash ──────────
function writeServiceWorker(assets, hash) {
  let template = fs.readFileSync(SW_TMPL, 'utf8');

  // Replace the build hash placeholder
  template = template.replace(/__BUILD_HASH__/g, hash);

  // Replace the STATIC_ASSETS array — find the array in the template and
  // replace it with the full discovered asset list
  const assetLines = assets.map(a => `  '${a}',`).join('\n');
  const newArray = `[\n${assetLines}\n]`;
  template = template.replace(
    /const STATIC_ASSETS = \[[\s\S]*?\];/,
    `const STATIC_ASSETS = ${newArray};`
  );

  fs.writeFileSync(SW_DEST, template, 'utf8');
  console.log(`[pwa-inject] ✓ service-worker.js written (${assets.length} assets, hash: ${hash})`);
}

// ─── Step 4: Copy manifest.json to dist/ ─────────────────────────────────────
function copyManifest() {
  fs.copyFileSync(MANIFEST_SRC, MANIFEST_DEST);
  console.log('[pwa-inject] ✓ manifest.json copied to dist/');
}

// ─── Step 5: Patch all HTML files in dist/ ───────────────────────────────────
const PWA_HEAD_TAGS = `
  <!-- PWA: manifest + theme -->
  <link rel="manifest" href="/manifest.json"/>
  <meta name="theme-color" content="#208AEF"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
  <meta name="apple-mobile-web-app-title" content="DischargeBuddy"/>
  <link rel="apple-touch-icon" href="/assets/images/icon.png"/>`.trim();

const SW_REGISTER_SCRIPT = `
  <script>
    // Register the service worker for offline-first PWA capability
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker
          .register('/service-worker.js', { scope: '/' })
          .then(function (reg) {
            console.log('[SW] Registered. Scope:', reg.scope);
            // Listen for updates — notify the user if a new version is available
            reg.addEventListener('updatefound', function () {
              const newWorker = reg.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', function () {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[SW] New version available — will activate on next reload.');
                  }
                });
              }
            });
          })
          .catch(function (err) {
            console.warn('[SW] Registration failed:', err);
          });
      });
    }
  </script>`.trim();

function patchHtmlFile(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');

  // Skip if already patched
  if (html.includes('rel="manifest"')) {
    console.log(`[pwa-inject] ↷ Already patched: ${path.basename(filePath)}`);
    return;
  }

  // Inject PWA head tags right before </head>
  html = html.replace('</head>', `  ${PWA_HEAD_TAGS}\n</head>`);

  // Inject SW registration script right before </body>
  html = html.replace('</body>', `  ${SW_REGISTER_SCRIPT}\n</body>`);

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`[pwa-inject] ✓ Patched: ${path.basename(filePath)}`);
}

function patchAllHtml() {
  const htmlFiles = fs.readdirSync(DIST)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(DIST, f));

  for (const file of htmlFiles) {
    patchHtmlFile(file);
  }
}

// ─── Step 6: Update vercel.json with SW cache-control headers ────────────────
function updateVercelJson() {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
  } catch {
    console.warn('[pwa-inject] vercel.json not found or invalid — creating fresh');
  }

  // Ensure outputDirectory and rewrites are set
  config.outputDirectory = 'dist';

  if (!Array.isArray(config.rewrites)) {
    config.rewrites = [];
  }
  // Ensure the SPA fallback rewrite is present
  const hasFallback = config.rewrites.some(r => r.source === '/(.*)');
  if (!hasFallback) {
    config.rewrites.push({ source: '/(.*)', destination: '/index.html' });
  }

  // Add headers so the service-worker.js is NEVER cached by the browser
  // (the browser must always fetch the latest SW to detect updates)
  if (!Array.isArray(config.headers)) {
    config.headers = [];
  }
  const hasSwHeader = config.headers.some(h => h.source === '/service-worker.js');
  if (!hasSwHeader) {
    config.headers.push({
      source: '/service-worker.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    });
  }
  // JS/CSS bundles are hashed — safe to cache forever
  const hasStaticHeader = config.headers.some(h => h.source === '/_expo/static/(.*)');
  if (!hasStaticHeader) {
    config.headers.push({
      source: '/_expo/static/(.*)',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    });
  }

  fs.writeFileSync(VERCEL_JSON, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log('[pwa-inject] ✓ vercel.json updated with SW headers');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(function main() {
  console.log('\n[pwa-inject] Starting PWA post-build injection…\n');

  if (!fs.existsSync(DIST)) {
    console.error(`[pwa-inject] ✗ dist/ not found at ${DIST}`);
    console.error('  Run `npx expo export --platform web` first.');
    process.exit(1);
  }

  const assets = collectAssets();
  console.log(`[pwa-inject] Found ${assets.length} cacheable assets`);

  const hash = buildHash(assets);
  console.log(`[pwa-inject] Build hash: ${hash}`);

  writeServiceWorker(assets, hash);
  copyManifest();
  patchAllHtml();
  updateVercelJson();

  console.log('\n[pwa-inject] ✓ Done. The app is now PWA-ready.\n');
  console.log('  Next steps:');
  console.log('  1. npx vercel --prod --yes');
  console.log('  2. Open the production URL in Chrome/Safari → "Add to Home Screen"');
  console.log('  3. Enable airplane mode → reopen the app → everything loads offline\n');
})();

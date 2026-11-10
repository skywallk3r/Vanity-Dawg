// Replaces YOUR-DOMAIN.example everywhere it matters with your real domain.
// Usage: npm run sync-domain -- your.domain.com   (after first build)
import { readFileSync, writeFileSync } from 'node:fs';

const domain = process.argv[2];
if (!domain || domain.includes('://') || domain.includes('/')) {
  console.error('Usage: node scripts/sync-domain.mjs your.domain.com');
  process.exit(1);
}
const files = ['public/index.html', 'public/.well-known/farcaster.json', 'src/config.js'];
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const after = before.replaceAll('YOUR-DOMAIN.example', domain);
  if (before !== after) {
    writeFileSync(f, after);
    console.log('updated', f);
  }
}
console.log('Done. NEXT: npm run build (config is baked into app.js), then generate accountAssociation for', domain, 'with the Manifest Tool and paste it into public/.well-known/farcaster.json');

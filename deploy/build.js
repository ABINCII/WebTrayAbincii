const fs = require('fs');
const path = require('path');
const root = __dirname;
const out = path.join(root, 'dist');
const excluded = new Set(['dist', '.vercel']);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (excluded.has(entry.name) || ['package.json', 'build.js', 'vercel.json'].includes(entry.name)) continue;
  fs.cpSync(path.join(root, entry.name), path.join(out, entry.name), { recursive: true });
}
console.log('Static deployment files copied to dist/');

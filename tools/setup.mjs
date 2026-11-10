#!/usr/bin/env node
// npm run setup
//   1. Download the LCC Web SDK release zip from the XGRIDS website, verify sha256,
//      extract sdk/lcc-sdk-three.js(+.d.ts) into vendor/lcc-web-sdk/.
//   2. Install headless Chromium for `npm run scene -- shot` and `npm run check` (skip with --no-browser).
// SDK release page: https://www.xgrids.com/us/support/download/lcc-for-web
// The SDK is not part of this repository; the XGRIDS terms apply to it.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SDK_DIR, SDK_FILE } from './env.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: npm run setup [-- --no-browser] [--force]\n  downloads the LCC Web SDK (sha256-checked) into vendor/lcc-web-sdk/ and installs headless Chromium (about 150 MB) for checks');
  process.exit(0);
}

const SDK = {
  version: '0.6.4',
  url: 'https://d1hl53kddblsn9.cloudfront.net/prdfr/lixel/app/Lcc_Web_SDK/0.6.4/LCC-Web-0.6.4.zip',
  sha256: '6138a89ac753f8a16f58921d5fccc18500430ff367c70ed6f87c6af10141e11d',
  files: ['sdk/lcc-sdk-three.js', 'sdk/lcc-sdk-three.d.ts'],
};

async function installSdk() {
  try {
    if (!process.argv.includes('--force') && existsSync(SDK_FILE) && (await readFile(join(SDK_DIR, 'VERSION'), 'utf8')).trim() === SDK.version) { console.log(`LCC Web SDK ${SDK.version} already installed`); return; }
  } catch {}
  console.log(`Downloading LCC Web SDK ${SDK.version} ...`);
  const res = await fetch(SDK.url, { signal: AbortSignal.timeout(120_000) }).catch((e) => { throw new Error(`download failed (${e.message}): ${SDK.url}\nCheck your network or proxy, or download it manually from https://www.xgrids.com/us/support/download/lcc-for-web and put sdk/lcc-sdk-three.js from the zip into ${SDK_DIR}/`); });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${SDK.url}\nDownload it manually from https://www.xgrids.com/us/support/download/lcc-for-web and put sdk/lcc-sdk-three.js from the zip into ${SDK_DIR}/`);
  const zip = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha256').update(zip).digest('hex');
  if (hash !== SDK.sha256) throw new Error(`sha256 mismatch: got ${hash}, expected ${SDK.sha256}`);
  await mkdir(SDK_DIR, { recursive: true });
  for (const name of SDK.files) await writeFile(join(SDK_DIR, name.split('/').pop()), unzipEntry(zip, name));
  await writeFile(join(SDK_DIR, 'VERSION'), SDK.version + '\n');
  console.log(`Extracted to ${SDK_DIR}`);
}

// Read one entry from a zip via its central directory (stored/deflate only; enough for the SDK zip).
function unzipEntry(zip, name) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), elen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const off = zip.readUInt32LE(p + 42);
    const n = zip.toString('utf8', p + 46, p + 46 + nlen);
    if (n === name || n.endsWith('/' + name)) {
      const start = off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28);
      const data = zip.subarray(start, start + csize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`${name} not found in zip`);
}

await installSdk();
if (!process.argv.includes('--no-browser')) {
  console.log('Installing headless Chromium (for scene shots and checks) ...');
  try { execSync('npx playwright install chromium', { stdio: 'inherit' }); }
  catch { console.error('Chromium install failed. On Linux you may need system libraries: npx playwright install --with-deps chromium'); process.exit(1); }
}
console.log('Done. Next: npm run scene -- add <scene-folder-or-zip> --name <name>');

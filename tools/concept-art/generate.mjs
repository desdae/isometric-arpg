// Concept art through Cloudflare Workers AI (FLUX.1 schnell).
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node tools/concept-art/generate.mjs [id …]
//
// Reads prompts.json, prepends the shared style line and writes one JPEG per
// prompt (and per seed) to tools/concept-art/out/. With ids, only those run.
// The token needs the Workers AI permission on the account.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { model, style, steps, seeds, prompts } = JSON.parse(fs.readFileSync(path.join(here, 'prompts.json'), 'utf8'));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN;
if (!account || !token) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

const only = new Set(process.argv.slice(2));
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });

for (const p of prompts) {
  if (only.size && !only.has(p.id)) continue;
  for (const seed of seeds) {
    const file = path.join(out, `${p.id}-${seed}.jpg`);
    if (fs.existsSync(file)) continue;
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // FLUX schnell takes no seed, so each run of the same prompt is a fresh variant.
      body: JSON.stringify({ prompt: `${p.prompt}. ${style}`, steps }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.result?.image) {
      console.error(`${p.id} (seed ${seed}) failed: ${res.status} ${JSON.stringify(body?.errors ?? body)}`);
      continue;
    }
    fs.writeFileSync(file, Buffer.from(body.result.image, 'base64'));
    console.log('wrote', path.relative(process.cwd(), file));
  }
}

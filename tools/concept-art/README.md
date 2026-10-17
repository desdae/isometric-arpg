# Concept art

`generate.mjs` sends each prompt in `prompts.json` to Cloudflare Workers AI
(FLUX.1 schnell) and saves the images in `out/` (not committed). Edit the
prompts or the shared `style` line, then run:

```sh
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node tools/concept-art/generate.mjs
node tools/concept-art/generate.mjs boss-the-silent-abbess   # just one
```

Existing images are skipped, so delete one to redo it. The images are
reference for building the zones, monsters and effects in code; they do not
ship with the game.

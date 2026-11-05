# hotring

LAN party word game (letter ring, hidden fuse, category cards). Bun server + websockets, vanilla TS client.

- `bun run dev` serves on :5757 (PORT to change), bound to 0.0.0.0. Phones on the same Wi-Fi join through the QR in the share button.
- Prod runs on Cloudflare: `worker/index.ts` routes `/ws?r=CODE` to one `Room` Durable Object (holds a `server/hub.ts` Hub = Game + sockets); the client is bundled by `scripts/build.sh` into `dist/` as static assets. `bun run deploy`. If wrangler says not logged in, run it with `XDG_CONFIG_HOME=~/.config`.
- `shared/protocol.ts` is the wire contract. The server (`server/game.ts`) is authoritative; clients render snapshots and react to `ev` events.
- `bun test` covers the game rules. `bun run typecheck` before committing.
- Sounds are synthesized with earshot: `scripts/sfx/make.py` writes `public/sfx/*.mp3`. Never add recorded samples.
- UI rules: minimal, flat colors, no gradients on surfaces, almost no text, no website feel (no scrolling, no nav, no marketing copy).

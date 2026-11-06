# hotring

LAN party word game (letter ring, hidden fuse, category cards). Peer to peer: the host phone's browser runs the game (Trystero + WebRTC), vanilla TS client.

- `bun run dev` serves the static client on :5757 (PORT to change), bound to 0.0.0.0, so phones on the same Wi-Fi can open it; the QR in the share button points there. The game itself runs in the host phone's browser (`client/net.ts`: the phone that opens a bare URL is the host and keeps `?r=CODE` in its address bar; phones opening `?r=CODE` join it). Trystero uses public Nostr relays only to introduce phones, so the internet is needed to join.
- Prod is Cloudflare static assets only (no Worker, no Durable Object): `scripts/build.sh` bundles the client into `dist/`; `bun run deploy`. If wrangler says not logged in, run it with `XDG_CONFIG_HOME=~/.config`.
- `shared/protocol.ts` is the wire contract. The host's Game (`server/game.ts`, driven by `server/hub.ts`) is authoritative; clients render snapshots and react to `ev` events.
- `bun test` covers the game rules. `bun run typecheck` before committing.
- Sounds are synthesized with earshot: `scripts/sfx/make.py` writes `public/sfx/*.mp3`. Never add recorded samples.
- UI rules: minimal, flat colors, no gradients on surfaces, almost no text, no website feel (no scrolling, no nav, no marketing copy).

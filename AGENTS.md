# hotring

LAN party word game (letter ring, hidden fuse, category cards). Bun server + websockets, vanilla TS client.

- `bun run dev` serves on :5757 (PORT to change), bound to 0.0.0.0. Phones on the same Wi-Fi join through the QR in the share button.
- `shared/protocol.ts` is the wire contract. The server (`server/game.ts`) is authoritative; clients render snapshots and react to `ev` events.
- `bun test` covers the game rules. `bun run typecheck` before committing.
- Sounds are synthesized with earshot: `scripts/sfx/make.py` writes `public/sfx/*.mp3`. Never add recorded samples.
- UI rules: minimal, flat colors, no gradients on surfaces, almost no text, no website feel (no scrolling, no nav, no marketing copy).

# hotring

A party word game on a ring of letters: name something in the category, tap its letter, pass the turn. Every tap restarts a hidden fuse. Whoever holds it when it blows takes a mark; three marks and you're out.

One shared table per room code (`?r=ABCD`). Anyone in the room can add, remove and reorder players, tap letters and draw cards. Phones that open the link are remotes.

## Run it on your laptop (no internet latency)

```sh
bun install
bun run dev
```

It prints a `lan` URL such as `http://192.168.1.20:5757`. Open it on the laptop, tap the QR icon, and scan it with the phones. Everyone has to be on the same Wi-Fi. If macOS asks whether bun may accept incoming connections, allow it. The roster is kept in `.data/`.

## Cloudflare (internet play)

Live: https://hotring.carloantonioct.workers.dev. Static assets only: the host phone runs the game and the other phones join it peer to peer (Trystero over WebRTC).

```sh
bun run deploy   # builds the client into dist/ and runs wrangler deploy
```

## Dev

```sh
bun test                  # rules
bun run typecheck
ROOM=ABCD bun scripts/bots.ts 2 --lazy   # fake phones that seat players and tap
~/tools/earshot-venv/bin/python -I scripts/sfx/make.py   # regenerate the sounds (earshot)
```

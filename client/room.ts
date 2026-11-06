// A party is a short room code in the URL (?r=ABCD). No code yet: this phone makes one, keeps it in the
// address bar and becomes the host (its browser runs the game). Reloading the host's tab keeps it the host.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O ambiguity worth worrying about with 4 letters

function make() {
  const b = crypto.getRandomValues(new Uint8Array(4))
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('')
}

const HOST_KEY = 'hotring:host:'

export const { roomCode, isHost } = (() => {
  const url = new URL(location.href)
  let code = (url.searchParams.get('r') ?? '').toUpperCase()
  let host = false
  if (!/^[A-Z0-9]{3,8}$/.test(code)) {
    code = make()
    url.searchParams.set('r', code)
    history.replaceState(null, '', url)
    host = true
    sessionStorage.setItem(HOST_KEY + code, '1')
  } else host = sessionStorage.getItem(HOST_KEY + code) === '1'
  return { roomCode: code, isHost: host }
})()

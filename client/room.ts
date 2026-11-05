// A party is a short room code in the URL (?r=ABCD). No code yet: make one and keep it in the address bar.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O ambiguity worth worrying about with 4 letters

function make() {
  const b = crypto.getRandomValues(new Uint8Array(4))
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('')
}

export const roomCode = (() => {
  const url = new URL(location.href)
  let code = (url.searchParams.get('r') ?? '').toUpperCase()
  if (!/^[A-Z0-9]{3,8}$/.test(code)) {
    code = make()
    url.searchParams.set('r', code)
    history.replaceState(null, '', url)
  }
  return code
})()

/* One-off PWA icon generator — dependency-free (Node zlib only).

   Produces full-bleed PNG icons (red field + a centred white "signal pulse"
   motif) into public/icons/. Full-bleed + centred-in-the-safe-zone means the
   same file works as a maskable icon (Android adaptive crop) and as an iOS
   apple-touch-icon (iOS applies its own rounding). Re-run with:
       node scripts/gen-icons.mjs
   The output PNGs are committed, so nothing runs at build time and there is no
   image dependency in the install. Tweak BG / sizes here to rebrand. */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const OUT = path.resolve(process.cwd(), 'public/icons')
const BG = [0xdc, 0x26, 0x26]   // Labour red (Tailwind red-600)
const FG = [0xff, 0xff, 0xff]   // white pulse
const SIZES = [192, 512, 180]   // 180 = apple-touch-icon

// CRC32 (PNG chunk checksum) — standard table implementation.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/* Is pixel (x,y) part of the white motif? Normalised distance from centre; a
   central dot + three concentric rings, all inside the 0.40·N maskable safe
   radius (max reach 0.388·N). */
function isPulse(x, y, N) {
  const d = Math.hypot(x - N / 2, y - N / 2) / N
  if (d < 0.055) return true
  for (const r of [0.15, 0.255, 0.36]) if (Math.abs(d - r) < 0.028) return true
  return false
}

function renderPng(N) {
  const rowLen = 1 + N * 4
  const raw = Buffer.alloc(rowLen * N)
  for (let y = 0; y < N; y++) {
    const rowStart = y * rowLen
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < N; x++) {
      const [r, g, b] = isPulse(x, y, N) ? FG : BG
      const p = rowStart + 1 + x * 4
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(OUT, { recursive: true })
for (const N of SIZES) {
  const name = N === 180 ? 'apple-touch-icon.png' : `icon-${N}.png`
  fs.writeFileSync(path.join(OUT, name), renderPng(N))
  console.log(`✓ ${name} (${N}×${N})`)
}

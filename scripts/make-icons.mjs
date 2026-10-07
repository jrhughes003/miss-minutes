// Draws the app icon (a clock face) and writes it as PNG files, using only
// Node's built-in zlib. No image library is needed, and the icon can be
// regenerated after any design tweak:  node scripts/make-icons.mjs
//
// Outputs:
//   build/icon.png      256×256, used by electron-builder for the installer and .exe
//   build/tray.png      32×32 tray icon
//   build/tray@2x.png   64×64 tray icon for high-DPI screens (Electron picks it automatically)

import fs from 'node:fs'
import zlib from 'node:zlib'

const ORANGE = [217, 98, 43]
const CREAM = [255, 246, 238]
const INK = [43, 33, 24]

// Signed distance from point p to segment a–b, for drawing the clock hands.
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Colour at a point in a 1×1 unit square (0..1), or null for transparent.
function shade(x, y) {
  const r = Math.hypot(x - 0.5, y - 0.5)
  if (r > 0.47) return null
  if (r > 0.38) return ORANGE
  const w = 0.045
  if (segmentDistance(x, y, 0.5, 0.5, 0.5, 0.22) < w) return INK // minute hand → 12
  if (segmentDistance(x, y, 0.5, 0.5, 0.68, 0.6) < w) return INK // hour hand → 4
  return CREAM
}

function render(size) {
  const ss = 4 // 4×4 supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size)
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++ }
        }
      }
      const i = (y * size + x) * 4
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a }
      px[i + 3] = Math.round((a / (ss * ss)) * 255)
    }
  }
  return encodePng(size, size, px)
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlace) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit depth, RGBA, deflate, no filter, no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync('build', { recursive: true })
fs.writeFileSync('build/icon.png', render(256))
fs.writeFileSync('build/tray.png', render(32))
fs.writeFileSync('build/tray@2x.png', render(64))
console.log('Wrote build/icon.png, build/tray.png, build/tray@2x.png')

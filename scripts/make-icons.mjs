// Renders the app and tray icons from their SVG sources (original art, D40)
// to the PNG files Electron and electron-builder use, with the Chromium that
// Playwright already installs for the tests. Re-run after editing an SVG:
//   node scripts/make-icons.mjs
//
// Sources:  build/icon.svg (app icon, also the web favicon), build/tray.svg
// Outputs:
//   build/icon.png      256×256, used by electron-builder for the installer and .exe
//   build/tray.png      32×32 tray icon
//   build/tray@2x.png   64×64 tray icon for high-DPI screens (Electron picks it automatically)
//   public/favicon.svg  a copy of build/icon.svg for the web build

import fs from 'node:fs'
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage()

async function render(svgFile, size, out) {
  const svg = fs.readFileSync(svgFile, 'utf8')
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

await render('build/icon.svg', 256, 'build/icon.png')
await render('build/tray.svg', 32, 'build/tray.png')
await render('build/tray.svg', 64, 'build/tray@2x.png')
fs.copyFileSync('build/icon.svg', 'public/favicon.svg')
await browser.close()
console.log('Wrote build/icon.png, build/tray.png, build/tray@2x.png, public/favicon.svg')

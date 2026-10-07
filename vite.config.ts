import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { CSP } from './src/shared/csp'

// The CSP lives in src/shared/csp.ts so the Electron main process can send the
// same policy as a header. It's injected at build time only, because Vite's dev
// server needs inline scripts and a websocket for hot reload.
const CHARSET = '<meta charset="UTF-8" />'

function contentSecurityPolicy(): Plugin {
  return {
    name: 'miss-minutes-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes(CHARSET)) {
          throw new Error('index.html charset meta not found; the CSP injection anchors on it')
        }
        const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`
        return html.replace(CHARSET, `${CHARSET}\n    ${meta}`)
      },
    },
  }
}

// base: './' keeps asset URLs relative, so the same bundle loads from Electron's
// file:// origin and from a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: { port: 5173, strictPort: true },
})

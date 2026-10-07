import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/vt323/latin-400.css'
import { App } from './App'
import './styles.css'
import { applyTheme, savedTheme } from './ui/theme'

applyTheme(savedTheme())

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing from index.html')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled locally (OFL-1.1); remote fonts are blocked by CSP.
import '@fontsource/michroma'
import '@fontsource/jetbrains-mono'
import './styles/theme.css'
import './styles/app.css'
import { App } from './App.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// opsz build (not the wght-only default): at display sizes Inter v4's optical
// axis narrows the glyphs, which InterVariable renders at display sizes.
import '@fontsource-variable/inter/opsz.css'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

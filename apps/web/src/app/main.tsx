import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// opsz build (not the wght-only default): at display sizes Inter v4's optical
// axis narrows the glyphs, which InterVariable renders at display sizes.
import '@fontsource-variable/inter/opsz.css'
// Display face for the FAQ/footer headings. full.css is the only Fraunces
// build carrying the SOFT/WONK axes.
import '@fontsource-variable/fraunces/full.css'
import { BrowserRouter } from 'react-router-dom'
import '../shared/styles/global.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

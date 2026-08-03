import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens corporativos Zelix — fuente única: zelix-brand/zelix-tokens.css.
// NO editar la copia local: se regenera con `node zelix-brand/sync-tokens.mjs`.
import './zelix-tokens.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

import { Component, type ReactNode } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh',
        background: 'var(--bg, #0f1117)', gap: '16px',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(239,68,68,0.12)', color: '#ef4444',
        }}>
          <AlertTriangle size={28} />
        </div>
        <p style={{ color: 'var(--text, #fff)', fontWeight: 700, fontSize: 16, margin: 0 }}>
          Algo salió mal
        </p>
        <p style={{ color: 'var(--text-muted, rgba(255,255,255,0.45))', fontSize: 13, margin: 0 }}>
          Ocurrió un error inesperado en la interfaz
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8, display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 12, border: '1px solid var(--border, rgba(255,255,255,0.1))',
            background: 'var(--surface-1, rgba(255,255,255,0.06))', color: 'var(--text, #fff)',
            fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}>
          <RefreshCw size={14} /> Recargar página
        </button>
      </div>
    )
  }
}

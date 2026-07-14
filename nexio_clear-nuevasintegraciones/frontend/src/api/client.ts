import axios from 'axios'
import toast from 'react-hot-toast'
import { isReadOnlyNow } from '../store/readonly'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || ''
export const apiUrl = (path: string) => `${API_BASE_URL}${path}`

const api = axios.create({
  baseURL: API_BASE_URL || undefined,
  headers: { 'Content-Type': 'application/json' },
})

// Métodos que modifican datos: se bloquean en modo observador.
const MUTATING = ['post', 'put', 'patch', 'delete']

// Acciones mutantes pero inofensivas para el trabajo de agendadoras/vendedores,
// que siguen permitidas en modo observador (login, chat IA, marcar leído, exportar).
const READONLY_SAFE = [
  /\/api\/auth\/login$/,
  /\/api\/nexin\/chat$/,
  /\/read(-all)?$/,
  /\/export/,
]

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // Red de seguridad: el supervisor en modo observador no puede ejecutar
  // acciones que afecten los procesos, aunque un botón se escape sin desactivar.
  const method = (config.method || 'get').toLowerCase()
  if (MUTATING.includes(method) && isReadOnlyNow()) {
    const url = config.url || ''
    const safe = READONLY_SAFE.some(re => re.test(url))
    if (!safe) {
      toast.error('Estás en modo observador. Habilita la edición para realizar esta acción.', { id: 'readonly-block' })
      return Promise.reject(new axios.Cancel('read-only'))
    }
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    // Normalize Pydantic 422 validation errors to a readable string
    if (err.response?.status === 422) {
      const detail = err.response.data?.detail
      if (Array.isArray(detail)) {
        err.response.data.detail = detail
          .map((d: any) => {
            const field = d.loc?.slice(1).join('.') ?? ''
            return field ? `${field}: ${d.msg}` : d.msg
          })
          .join(' | ')
      }
    }
    return Promise.reject(err)
  }
)

export default api

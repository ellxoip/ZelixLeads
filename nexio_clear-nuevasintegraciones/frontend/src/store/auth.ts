import { create } from 'zustand'
import { login as apiLogin, getMe } from '../api'
import type { PlanLimits } from '../utils/plans'

interface User {
  id: number
  name: string
  email: string
  role: string
  group_id: number | null
  whatsapp_number: string | null
  negocio_plan: string
  negocio_plan_limits: PlanLimits | null
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  })(),
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),

  login: async (email, password) => {
    const data = await apiLogin(email, password)
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data.user))
    set({ user: data.user, token: data.access_token, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null, isAuthenticated: false })
  },

  refreshUser: async () => {
    try {
      const me = await getMe()
      localStorage.setItem('user', JSON.stringify(me))
      set({ user: me })
    } catch { /* silent — token may be expired */ }
  },
}))

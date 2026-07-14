import { create } from 'zustand'

// Roles que arrancan en "modo observador" (solo lectura) hasta habilitarse a sí mismos.
export const SUPERVISOR_ROLES = ['superadmin', 'subadmin']

// Tras este tiempo sin actividad, la edición se vuelve a bloquear sola.
const INACTIVITY_MS = 10 * 60 * 1000

let relockTimer: ReturnType<typeof setTimeout> | null = null

interface ReadonlyState {
  editUnlocked: boolean
  unlock: () => void
  lock: () => void
  /** Reinicia el temporizador de inactividad mientras la edición está habilitada. */
  touch: () => void
}

export const useReadonlyStore = create<ReadonlyState>((set, get) => ({
  editUnlocked: false,
  unlock: () => {
    set({ editUnlocked: true })
    get().touch()
  },
  lock: () => {
    if (relockTimer) { clearTimeout(relockTimer); relockTimer = null }
    set({ editUnlocked: false })
  },
  touch: () => {
    if (!get().editUnlocked) return
    if (relockTimer) clearTimeout(relockTimer)
    relockTimer = setTimeout(() => get().lock(), INACTIVITY_MS)
  },
}))

export const isSupervisorRole = (role?: string | null): boolean =>
  !!role && SUPERVISOR_ROLES.includes(role)

// Lee el rol del usuario desde el auth persistido en localStorage.
// (Evita importar el store de auth → sin dependencias circulares con el cliente axios.)
function currentRole(): string | null {
  try {
    return (JSON.parse(localStorage.getItem('user') || 'null')?.role as string) ?? null
  } catch {
    return null
  }
}

/**
 * True cuando el usuario actual es supervisor (superadmin/subadmin) y NO ha
 * habilitado la edición. Seguro de llamar fuera de React (interceptor axios).
 */
export const isReadOnlyNow = (): boolean =>
  isSupervisorRole(currentRole()) && !useReadonlyStore.getState().editUnlocked

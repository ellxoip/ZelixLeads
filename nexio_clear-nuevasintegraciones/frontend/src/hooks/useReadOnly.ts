import { useAuthStore } from '../store/auth'
import { useReadonlyStore, isSupervisorRole } from '../store/readonly'

/**
 * Hook reactivo del "modo observador".
 *
 * - `readOnly`: true si el usuario es supervisor (superadmin/subadmin) y no ha
 *   habilitado la edición. Úsalo para desactivar/atenuar botones peligrosos.
 * - `isSupervisor`: true si el rol arranca en modo observador.
 * - `editUnlocked`, `unlock`, `lock`: control del candado de edición.
 */
export function useReadOnly() {
  const role = useAuthStore(s => s.user?.role)
  const editUnlocked = useReadonlyStore(s => s.editUnlocked)
  const unlock = useReadonlyStore(s => s.unlock)
  const lock = useReadonlyStore(s => s.lock)

  const isSupervisor = isSupervisorRole(role)
  return {
    readOnly: isSupervisor && !editUnlocked,
    isSupervisor,
    editUnlocked,
    unlock,
    lock,
  }
}

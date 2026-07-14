import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, User, Phone, LayoutGrid, ArrowRight, CornerDownLeft, CheckSquare, FileText } from 'lucide-react'
import { globalSearch, type SearchGroup, type SearchItem } from '../api'
import { STAGE_LABELS, STAGE_COLORS } from '../types'
import { openLeadDrawer } from '../lib/leadDrawerBus'

interface Props { onClose: () => void }

const TYPE_ICON: Record<string, typeof User> = {
  lead: User, contact: Phone, task: CheckSquare, history: FileText, module: LayoutGrid,
}

export default function GlobalSearch({ onClose }: Props) {
  const [query, setQuery]     = useState('')
  const [groups, setGroups]   = useState<SearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate = useNavigate()

  useEffect(() => { inputRef.current?.focus() }, [])

  // Índice PLANO: las flechas recorren toda la lista sin importar la categoría.
  const flat = useMemo<SearchItem[]>(() => groups.flatMap(g => g.items), [groups])

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setGroups([]); return }
    setLoading(true)
    try {
      const data = await globalSearch(q.trim())
      setGroups(data.groups ?? [])
      setSelected(0)
    } catch { setGroups([]) }
    finally { setLoading(false) }
  }, [])

  // Debounce 280ms (≥250ms) — anti-saturación del input.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(query), 280)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query, doSearch])

  const run = useCallback((item?: SearchItem) => {
    if (!item) return
    if (item.action.kind === 'drawer') openLeadDrawer(item.action.leadId)  // Fricción Cero
    else navigate(item.action.to)                                          // navegación cliente
    onClose()
  }, [navigate, onClose])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, flat.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); run(flat[selected]) }
  }

  // Auto-scroll del item activo al cambiar la selección por teclado.
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }) }, [selected])

  const hasResults = flat.length > 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center pt-16 px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ maxHeight: '70vh' }}>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search size={18} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Buscar leads, contactos, módulos…"
            className="flex-1 text-sm text-gray-800 placeholder:text-gray-400 outline-none bg-transparent"
          />
          {loading && <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin flex-shrink-0" />}
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-surface-2 transition-colors flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 104px)' }}>
          {query.trim().length >= 2 && !loading && !hasResults && (
            <p className="text-sm text-gray-400 text-center py-10">No se encontraron resultados para "{query}"</p>
          )}
          {query.trim().length < 2 && (
            <p className="text-xs text-gray-400 text-center py-8">Escribe al menos 2 caracteres (nombre, teléfono, RUT o módulo)</p>
          )}

          {groups.map(group => {
            const Icon = TYPE_ICON[group.type] ?? ArrowRight
            return (
              <div key={group.type} className="border-b border-gray-50 last:border-0 py-1.5">
                <p className="px-4 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{group.label}</p>
                {group.items.map(item => {
                  const isActive = flat[selected] === item
                  const stage = item.badge?.stage
                  return (
                    <button
                      key={`${group.type}-${item.id ?? item.title}`}
                      ref={isActive ? activeRef : null}
                      onClick={() => run(item)}
                      onMouseMove={() => setSelected(flat.indexOf(item))}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-lime-dim' : 'hover:bg-surface-3'
                      }`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isActive ? 'bg-lime/20 text-lime' : 'bg-surface-3 text-gray-400'
                      }`}>
                        <Icon size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
                        {item.subtitle && <p className="text-xs text-gray-400 truncate">{item.subtitle}</p>}
                      </div>
                      {stage && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0 ${
                          STAGE_COLORS[stage] ?? 'bg-surface-3 text-gray-600'
                        }`}>
                          {STAGE_LABELS[stage] ?? item.badge?.label}
                        </span>
                      )}
                      {isActive && <CornerDownLeft size={13} className="text-gray-400 flex-shrink-0" />}
                    </button>
                  )
                })}
                {group.has_more && (
                  <p className="px-4 py-1.5 pl-14 text-[11px] text-gray-400 italic">
                    Hay más resultados en {group.label} — refina tu búsqueda
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        {hasResults && (
          <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between">
            <span>↑↓ navegar · Enter abrir · Esc cerrar</span>
            <span>{flat.length} resultado{flat.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  )
}

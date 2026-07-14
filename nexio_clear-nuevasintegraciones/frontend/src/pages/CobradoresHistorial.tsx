import { useState, useEffect, useCallback } from 'react'
import { getCobradorHistorial } from '../api'
import { Search, Clock, CheckCircle, RefreshCw, Phone, Mail, Building2, FileText, Download } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import * as XLSX from 'xlsx'

function fmt(n: number | null | undefined) {
  if (!n) return '$0'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try { return format(parseISO(iso), "d MMM yyyy HH:mm", { locale: es }) } catch { return iso }
}

function exportToExcel(leads: any[]) {
  const rows = leads.map(l => ({
    'Nombre': l.nombre,
    'RUT': l.rut || '',
    'Empresa': l.empresa || '',
    'Teléfono': l.telefono || '',
    'Email': l.email || '',
    'Deuda total ($)': l.lf_total_facturado ?? l.monto_deuda ?? 0,
    'Total pagado ($)': l.lf_total_pagado ?? l.monto_pagado ?? 0,
    'Pagado el': l.pagado_at ? format(parseISO(l.pagado_at), "dd/MM/yyyy HH:mm", { locale: es }) : '',
    'Notas': l.notes || '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Historial')
  XLSX.writeFile(wb, `historial_cartera_${format(new Date(), 'yyyyMMdd')}.xlsx`)
}

export default function CobradoresHistorial() {
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getCobradorHistorial(search ? { search } : undefined)
      setLeads(data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [search])

  useEffect(() => {
    const t = setTimeout(() => load(), 300)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)', fontFamily: '"Space Grotesk", sans-serif' }}>
            Historial de Cartera
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Clientes que completaron su pago — se reactivan si vuelven a tener cuotas vencidas
          </p>
        </div>
        <div className="flex items-center gap-2">
          {leads.length > 0 && (
            <button onClick={() => exportToExcel(leads)}
              className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-semibold transition-colors"
              style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#16a34a' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.16)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.08)'}>
              <Download size={13} />
              Exportar Excel
            </button>
          )}
          <button onClick={load} className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
            style={{ border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <input
          className="w-full pl-9 pr-3 h-9 text-sm rounded-xl outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
          placeholder="Buscar por nombre, RUT o empresa…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs"
        style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.20)', color: 'rgba(22,163,74,0.90)' }}>
        <CheckCircle size={13} className="flex-shrink-0 mt-0.5" />
        <p>
          Los clientes pasan aquí automáticamente 24 horas después de marcarlos como pagados.
          Si Legal Finance detecta nuevas cuotas vencidas, volverán a <strong>Lead Moroso</strong> en el próximo sync.
        </p>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <RefreshCw size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1.5px dashed var(--border-2)' }}>
          <Clock size={32} className="mb-3" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-3)' }}>Sin registros en historial</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Los clientes pagados aparecerán aquí después de 24 horas
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden table-scroll" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                {['Cliente', 'RUT', 'Empresa', 'Deuda total', 'Total pagado', 'Pagado el', 'Contacto'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-xs"
                    style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, i) => (
                <tr key={lead.id}
                  style={{
                    background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                  }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                        style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}>
                        {lead.nombre?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <span className="font-medium" style={{ color: 'var(--text)' }}>{lead.nombre}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-3)' }}>{lead.rut || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      {lead.empresa && <Building2 size={12} style={{ color: 'var(--text-muted)' }} />}
                      {lead.empresa || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--text)' }}>
                    {fmt(lead.lf_total_facturado)}
                  </td>
                  <td className="px-4 py-3 font-semibold" style={{ color: '#16a34a' }}>
                    {fmt(lead.lf_total_pagado)}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <div className="flex items-center gap-1">
                      <CheckCircle size={11} color="#16a34a" />
                      {fmtDate(lead.pagado_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {lead.telefono && (
                        <a href={`tel:${lead.telefono}`} title={lead.telefono}
                          className="p-1 rounded-lg transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--primary)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
                          <Phone size={13} />
                        </a>
                      )}
                      {lead.email && (
                        <a href={`mailto:${lead.email}`} title={lead.email}
                          className="p-1 rounded-lg transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--primary)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'}>
                          <Mail size={13} />
                        </a>
                      )}
                      {lead.notes && (
                        <span title={lead.notes} className="p-1" style={{ color: 'var(--text-muted)' }}>
                          <FileText size={13} />
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
            {leads.length} cliente{leads.length !== 1 ? 's' : ''} en historial
          </div>
        </div>
      )}
    </div>
  )
}

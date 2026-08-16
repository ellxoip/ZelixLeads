import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import {
  X, Sparkles, Download, Save, Loader2, Trash2,
  ChevronLeft, FileText, CheckCircle, Plus, Minus, Eye, AlertCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { rutOnChange } from '../utils/rut'
import {
  getOTTypes, createWorkOrder, updateWorkOrder, deleteWorkOrder,
  aiFillWorkOrder, listWorkOrders, downloadWorkOrderPdf,
} from '../api'

const SnapPieContext = createContext<(() => void) | null>(null)

// ── Types ──────────────────────────────────────────────────────────────────────

interface OTType { key: string; label: string; subtitle: string; icon: string; has_diagnosis: boolean; ai_fields: string[] }
interface WorkOrder { id: number; lead_id: number; ot_type: string; fields_json: Record<string, any>; status: string; is_copy: boolean; created_by: number; created_at: string; updated_at?: string; ot_label: string }
interface Props { leadId: number; onClose: () => void; onSaved?: () => void; autoOpen?: boolean; honorarios?: number; autoClose?: boolean }

// ── Document primitives ────────────────────────────────────────────────────────

// Underline input — looks like the blank fields in the Word doc
function Blank({ fieldKey, value, onChange, style }: {
  fieldKey: string; value: string; onChange: (k: string, v: string) => void; style?: React.CSSProperties
}) {
  return (
    <input
      className="border-b-2 border-gray-400 bg-transparent text-gray-900 text-[13px] font-bold outline-none px-1 align-bottom"
      style={{ minWidth: 120, flex: 1, ...style }}
      value={value || ''}
      onChange={e => onChange(fieldKey, e.target.value)}
    />
  )
}

function BlankLine({ fieldKey, value, onChange, label, short, transform }: {
  fieldKey: string; value: string; onChange: (k: string, v: string) => void
  label: string; short?: boolean; transform?: (v: string) => string
}) {
  return (
    <div className="flex items-end gap-1 mb-[6px]">
      <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap shrink-0">{label}</span>
      <input
        className="border-b-2 border-gray-400 bg-transparent text-gray-900 text-[13px] font-bold outline-none px-1 align-bottom"
        style={{ width: short ? 180 : undefined, flex: short ? undefined : 1, minWidth: 80 }}
        value={value || ''}
        onChange={e => onChange(fieldKey, transform ? transform(e.target.value) : e.target.value)}
      />
    </div>
  )
}

function fmtCLP(v: string | number): string {
  const n = parseInt(String(v).replace(/\D/g, '')) || 0
  return '$ ' + n.toLocaleString('es-CL')
}

function gi(v: any): number {
  const n = parseFloat(String(v ?? '0'))
  return isNaN(n) ? 0 : Math.round(n)
}

function computePaymentFields(fields: Record<string, any>): Record<string, any> {
  const hon = gi(fields.honorarios)
  const pie = gi(fields.pie_inicial)
  const nc  = gi(fields.num_cuotas) || 1
  if (hon > 0 && nc > 0) {
    const mc = Math.floor((hon - pie) / nc)
    const pieExact = hon - nc * mc
    return { ...fields, monto_cuota: String(mc), pie_inicial: String(Math.max(0, pieExact)) }
  }
  return fields
}

function MoneyBlank({ fieldKey, value, onChange, style, snapOnBlur }: {
  fieldKey: string; value: string | number; onChange: (k: string, v: string) => void; style?: React.CSSProperties; snapOnBlur?: boolean
}) {
  const snapPie = useContext(SnapPieContext)
  const raw = String(value ?? '').replace(/\D/g, '')
  const num = parseInt(raw) || 0
  return (
    <div className="flex flex-col" style={style}>
      <input
        data-html2canvas-ignore="true"
        className="border-b-2 border-gray-400 bg-transparent text-[13px] font-bold text-gray-900 outline-none px-1"
        style={{ minWidth: 120 }}
        value={raw}
        inputMode="numeric"
        onChange={e => onChange(fieldKey, e.target.value.replace(/\D/g, ''))}
        onBlur={snapOnBlur && snapPie ? snapPie : undefined}
      />
      {num > 0 && (
        <span className="text-[13px] font-bold text-blue-700 mt-0.5 px-1" style={{ fontWeight: 700 }}>{fmtCLP(raw)}</span>
      )}
    </div>
  )
}

function BlankArea({ fieldKey, value, onChange, rows = 2 }: {
  fieldKey: string; value: string; onChange: (k: string, v: string) => void; rows?: number
}) {
  return (
    <textarea
      className="w-full border-b-2 border-gray-400 bg-transparent text-gray-900 text-[13px] font-bold outline-none px-1 resize-none mt-0.5"
      rows={rows}
      value={value || ''}
      onChange={e => onChange(fieldKey, e.target.value)}
    />
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-bold text-gray-900 mt-5 mb-2 uppercase tracking-wide">
      {children}
    </p>
  )
}

function BodyText({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-bold text-gray-900 leading-relaxed mb-2">{children}</p>
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mb-2 space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[13px] font-bold text-gray-900 leading-relaxed">
          <span className="shrink-0 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function AIBadge() {
  return (
    <span data-html2canvas-ignore="true"
      className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-semibold ml-1 align-middle"
      style={{ background: '#1e3a8a', color: '#bfdbfe', border: '1px solid #3b82f6' }}>
      <Sparkles size={8} /> IA
    </span>
  )
}

// ── Shared document sections ───────────────────────────────────────────────────

function ClientSection({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. INDIVIDUALIZACIÓN DEL CLIENTE</SectionTitle>
      <BlankLine label="Nombre o Razón Social:" fieldKey="nombre_razon_social" value={f.nombre_razon_social} onChange={ch} />
      <BlankLine label="RUT:" fieldKey="rut" value={f.rut} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Domicilio:" fieldKey="domicilio" value={f.domicilio} onChange={ch} />
      <div className="flex flex-wrap gap-x-6">
        <BlankLine label="Comuna:" fieldKey="comuna" value={f.comuna} onChange={ch} short />
        <BlankLine label="Teléfono:" fieldKey="telefono" value={f.telefono} onChange={ch} short />
      </div>
      <BlankLine label="Correo electrónico:" fieldKey="email" value={f.email} onChange={ch} />
    </>
  )
}

function HonorariosSection({ f, ch, showBank }: { f: Record<string, any>; ch: (k: string, v: string) => void; showBank?: boolean }) {
  return (
    <>
      <SectionTitle>HONORARIOS PROFESIONALES</SectionTitle>
      <BodyText>Los honorarios profesionales correspondientes a los servicios indicados precedentemente ascienden a la suma de:</BodyText>
      <div className="flex items-end gap-1 mb-2">
        <span className="text-[13px] font-bold text-gray-900" data-html2canvas-ignore="true">$</span>
        <MoneyBlank fieldKey="honorarios" value={f.honorarios ?? ''} onChange={ch} style={{ width: 260 }} />
      </div>
      <BlankLine label="Forma de pago:" fieldKey="forma_de_pago" value={f.forma_de_pago} onChange={ch} />
      <div className="flex flex-wrap gap-x-6 mt-1">
        <div className="flex items-end gap-1 mb-[6px]">
          <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap shrink-0">Pie Inicial: </span><span className="text-[13px] font-bold text-gray-900" data-html2canvas-ignore="true">$</span>
          <MoneyBlank fieldKey="pie_inicial" value={f.pie_inicial ?? ''} onChange={ch} snapOnBlur />
        </div>
        <div className="flex flex-wrap items-end gap-1 mb-[6px]">
          <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap shrink-0">Cuotas:</span>
          <input className="border-b-2 border-gray-400 bg-transparent text-[13px] font-bold text-gray-900 outline-none px-1 text-center w-12"
            value={String(f.num_cuotas ?? '').replace(/\D/g, '')}
            inputMode="numeric"
            onChange={e => ch('num_cuotas', e.target.value.replace(/\D/g, ''))} />
          <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap shrink-0">de </span><span className="text-[13px] font-bold text-gray-900" data-html2canvas-ignore="true">$</span>
          <MoneyBlank fieldKey="monto_cuota" value={f.monto_cuota ?? ''} onChange={ch} />
        </div>
      </div>
      {showBank && (
        <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200 text-[12px] font-bold text-gray-700">
          <p className="mb-0.5">DATOS PARA TRANSFERENCIA</p>
          <p>Titular: Abogados Chile SpA &nbsp;|&nbsp; RUT: 78.216.743-K &nbsp;|&nbsp; Banco: Santander (Cta. Cte.) &nbsp;|&nbsp; N° 99606614</p>
          <p>Comprobantes: cobranza@abogadostributarioschile.com</p>
        </div>
      )}
    </>
  )
}

function AcceptanceSection({ sectionNum }: { sectionNum: string }) {
  return (
    <>
      <SectionTitle>{sectionNum}. ACEPTACIÓN DEL SERVICIO</SectionTitle>
      <BodyText>Las partes dejan constancia que la aceptación expresa de los servicios profesionales indicados en la presente orden de trabajo se entenderá materializada mediante el pago del abono inicial acordado entre las partes.</BodyText>
      <BodyText>Dicho pago constituirá señal inequívoca de aceptación de las condiciones de prestación de servicios y autorización para iniciar las gestiones profesionales correspondientes.</BodyText>
      <p className="text-[13px] font-bold text-gray-900 mt-5">Atentamente,</p>
      <p className="text-[13px] font-bold text-gray-900">Abogados Tributarios Chile SpA</p>
    </>
  )
}

// ── Document templates per OT type ────────────────────────────────────────────

function Prescripcion({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>II. OBJETO DE LA CONTRATACIÓN</SectionTitle>
      <BodyText>Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales consistentes en la revisión, análisis y tramitación de acciones administrativas y/o judiciales destinadas a obtener la prescripción de deudas tributarias mantenidas ante la Tesorería General de la República y/o Servicio de Impuestos Internos, conforme a lo dispuesto en el artículo 200 del Código Tributario y demás normas aplicables.</BodyText>
      <BodyText>La presente gestión tiene por finalidad obtener la declaración de prescripción de las obligaciones tributarias que legalmente correspondan y lograr la eliminación de las deudas registradas a nombre del contribuyente.</BodyText>
      <SectionTitle>III. SERVICIOS INCLUIDOS</SectionTitle>
      <BodyText>La presente orden de trabajo incluye:</BodyText>
      <BulletList items={[
        'Revisión y análisis de antecedentes tributarios y cartolas de deuda.',
        'Estudio de prescripción conforme al artículo 200 del Código Tributario y normativa complementaria.',
        'Determinación de periodos tributarios susceptibles de prescripción.',
        'Elaboración de estrategia jurídica y tributaria.',
        'Preparación y presentación de escritos, solicitudes y antecedentes administrativos y/o judiciales que correspondan.',
        'Tramitación integral del procedimiento de prescripción tributaria.',
        'Seguimiento de actuaciones ante Tesorería General de la República, Servicio de Impuestos Internos y/o tribunales competentes.',
        'Asistencia a comparendos, audiencias o reuniones administrativas que fueren necesarias en primera instancia.',
        'Gestión destinada a obtener la eliminación total o parcial de las deudas prescritas registradas a nombre del contribuyente.',
        'Obtención y entrega final de certificado emitido por Tesorería General de la República que indique que el RUT del contribuyente no mantiene deuda tributaria pendiente, según corresponda.',
      ]} />
      <SectionTitle>IV. FUNDAMENTOS NORMATIVOS</SectionTitle>
      <BodyText>La presente gestión se desarrollará conforme a las disposiciones contenidas en:</BodyText>
      <BulletList items={[
        'Artículo 200 del Código Tributario.',
        'Normas sobre prescripción contenidas en el Código Tributario.',
        'DFL N°1 de 1994 del Ministerio de Hacienda.',
        'Normativa administrativa vigente de Tesorería General de la República y Servicio de Impuestos Internos.',
      ]} />
      <SectionTitle>V. PLAZO ESTIMADO DEL PROCEDIMIENTO <AIBadge /></SectionTitle>
      <BlankArea fieldKey="plazo_estimado" value={f.plazo_estimado} onChange={ch} rows={2} />
      <HonorariosSection f={f} ch={ch} />
      <SectionTitle>VII. OBLIGACIONES DEL CLIENTE</SectionTitle>
      <BodyText>El cliente se obliga a:</BodyText>
      <BulletList items={[
        'Entregar oportunamente todos los antecedentes requeridos para la adecuada tramitación del procedimiento.',
        'Informar cualquier notificación, requerimiento o actuación relacionada con las deudas tributarias materia de esta gestión.',
        'Mantener comunicación activa durante la vigencia del procedimiento.',
      ]} />
      <AcceptanceSection sectionNum="VIII" />
    </>
  )
}

function Desbloqueo({ f, ch, conContable }: { f: Record<string, any>; ch: (k: string, v: string) => void; conContable?: boolean }) {
  return (
    <>
      <SectionTitle>II. OBJETO DE LA CONTRATACIÓN</SectionTitle>
      <BodyText>Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales destinados al levantamiento de bloqueos, restricciones y/o anotaciones registradas por el Servicio de Impuestos Internos respecto del contribuyente, que afecten su situación tributaria y capacidad de emisión de documentos tributarios electrónicos.</BodyText>
      <SectionTitle>III. SERVICIOS INCLUIDOS</SectionTitle>
      <BulletList items={[
        'Revisión y análisis de anotaciones, bloqueos y observaciones registradas por el SII.',
        'Elaboración de estrategia administrativa para el levantamiento de observaciones.',
        'Presentación de escritos, solicitudes y documentación ante el SII.',
        'Asistencia a reuniones, fiscalizaciones o audiencias ante funcionarios del SII.',
        ...(conContable ? [
          'Rectificación y/o declaración de impuestos pendientes (IVA u otros).',
          'Normalización del estado tributario ante SII.',
          'Presentación ante el SII de la documentación contable elaborada.',
        ] : []),
        'Seguimiento integral del procedimiento hasta su resolución.',
        'Obtención de folios de emergencia para continuidad operacional del contribuyente.',
      ]} />
      <SectionTitle>IV. FOLIOS DE EMERGENCIA Y CONTINUIDAD OPERACIONAL</SectionTitle>
      <BodyText>En paralelo al procedimiento de desbloqueo tributario, se activará de forma inmediata la solicitud y obtención de folios de emergencia ante el SII, permitiendo al cliente emitir documentación tributaria dentro de un plazo aproximado de una semana.</BodyText>
      <SectionTitle>V. PLAZO ESTIMADO DEL PROCEDIMIENTO <AIBadge /></SectionTitle>
      <BlankArea fieldKey="plazo_estimado" value={f.plazo_estimado} onChange={ch} rows={2} />
      <SectionTitle>VI. OBSERVACIONES <AIBadge /></SectionTitle>
      <BlankArea fieldKey="observaciones_adicionales" value={f.observaciones_adicionales} onChange={ch} rows={2} />
      <HonorariosSection f={f} ch={ch} />
      <SectionTitle>VIII. OBLIGACIONES DEL CLIENTE</SectionTitle>
      <BodyText>El cliente se obliga a entregar oportunamente la información y antecedentes requeridos, informar cualquier nueva notificación del SII, y mantener comunicación activa.</BodyText>
      <AcceptanceSection sectionNum="IX" />
    </>
  )
}

function LiquidacionJuridica({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES</SectionTitle>
      <BlankLine label="Representante Legal:" fieldKey="representante_legal" value={f.representante_legal} onChange={ch} />
      <BlankLine label="RUT Representante:" fieldKey="rut_representante" value={f.rut_representante} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Razón Social:" fieldKey="razon_social" value={f.razon_social} onChange={ch} />
      <BlankLine label="RUT Empresa:" fieldKey="rut_empresa" value={f.rut_empresa} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Email de Contacto:" fieldKey="email" value={f.email} onChange={ch} />
      <p className="text-[13px] font-bold text-gray-900 mt-1">Perfil: Persona Jurídica (Empresa Deudora).</p>
      <SectionTitle>DIAGNÓSTICO FINANCIERO Y JUDICIAL <AIBadge /></SectionTitle>
      <BlankLine label="Deuda Total Estimada:" fieldKey="deuda_total_estimada" value={f.deuda_total_estimada} onChange={ch} />
      <BlankLine label="Estado de Alerta:" fieldKey="estado_alerta" value={f.estado_alerta} onChange={ch} />
      <div className="mb-2">
        <p className="text-[13px] font-bold text-gray-900">Observación Técnica:</p>
        <BlankArea fieldKey="observacion_tecnica" value={f.observacion_tecnica} onChange={ch} rows={2} />
      </div>
      <SectionTitle>SERVICIO CONTRATADO</SectionTitle>
      <BodyText>Asesoría legal integral para el cierre y extinción de pasivos de la sociedad mediante:</BodyText>
      <BodyText><strong>Liquidación Voluntaria de Empresa (Ley 20.720):</strong> Tramitación judicial del procedimiento de quiebra para la persona jurídica, con el objetivo de realizar los activos y extinguir la totalidad de las deudas vigentes.</BodyText>
      <SectionTitle>OBJETO Y ALCANCE DEL SERVICIO</SectionTitle>
      <BulletList items={[
        'Fase de Preparación: Recopilación de certificados de deuda, revisión de estados financieros e inventario de bienes de la empresa.',
        'Fase Concursal: Presentación de solicitud de liquidación voluntaria ante el Juzgado Civil correspondiente.',
        'Protección Financiera Concursal: Suspensión inmediata de juicios, embargos y medidas de apremio.',
        'Extinción de Deuda y Cierre: Obtención de resolución de término con extinción de saldos insolutos.',
      ]} />
      <HonorariosSection f={f} ch={ch} showBank />
      <AcceptanceSection sectionNum="V" />
    </>
  )
}

function LiquidacionNatural({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES</SectionTitle>
      <BlankLine label="Titular:" fieldKey="nombre_razon_social" value={f.nombre_razon_social} onChange={ch} />
      <BlankLine label="RUT:" fieldKey="rut" value={f.rut} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Email:" fieldKey="email" value={f.email} onChange={ch} />
      <BlankLine label="Perfil:" fieldKey="perfil_deudor" value={f.perfil_deudor} onChange={ch} />
      <SectionTitle>DIAGNÓSTICO FINANCIERO <AIBadge /></SectionTitle>
      <BlankLine label="Deuda Total Consolidada:" fieldKey="deuda_total_consolidada" value={f.deuda_total_consolidada} onChange={ch} />
      <BlankLine label="Estado de Pago:" fieldKey="estado_pago" value={f.estado_pago} onChange={ch} />
      <div className="mb-2">
        <p className="text-[13px] font-bold text-gray-900">Observación Crítica:</p>
        <BlankArea fieldKey="observacion_critica" value={f.observacion_critica} onChange={ch} rows={2} />
      </div>
      <SectionTitle>COMPOSICIÓN DE LA DEUDA <AIBadge /></SectionTitle>
      <DebtTableDoc value={f.composicion_deuda} onChange={v => ch('composicion_deuda', v)} />
      <SectionTitle>SERVICIO CONTRATADO</SectionTitle>
      <BodyText><strong>Liquidación Voluntaria (Ley 20.720):</strong> Tramitación judicial ante el tribunal civil correspondiente para lograr el perdón legal de las deudas (discharge) mediante la entrega de activos o declaración de carencia de bienes.</BodyText>
      <BulletList items={[
        'Fase de Preparación: Análisis de antecedentes financieros, comerciales y de activos.',
        'Fase Concursal: Presentación de la demanda de quiebra y apertura del procedimiento concursal.',
        'Protección Financiera: Cese de intereses, multas y suspensión de cualquier acción de embargo.',
        'Extinción de Deuda: Resolución de término que extingue el 100% de los saldos insolutos.',
      ]} />
      <HonorariosSection f={f} ch={ch} showBank />
      <AcceptanceSection sectionNum="V" />
    </>
  )
}

function FacturasIrregulares({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>II. OBJETO DE LA CONTRATACIÓN</SectionTitle>
      <BodyText>Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales consistentes en la defensa administrativa derivada de observaciones formuladas por el SII respecto de facturas presuntamente irregulares, con la finalidad de resguardar los derechos del contribuyente y evitar la configuración de antecedentes que pudieren derivar en acciones penales tributarias.</BodyText>
      <SectionTitle>III. SERVICIOS INCLUIDOS</SectionTitle>
      <BulletList items={[
        'Revisión y análisis de antecedentes tributarios asociados a las facturas observadas.',
        'Rectificación de formularios de IVA y declaraciones tributarias observadas.',
        'Desarrollo de estrategia de defensa orientada a evitar imputaciones del Art. 97 N°4 C.T.',
        'Asistencia a audiencias ante funcionarios del SII y Jefe de Grupo.',
        'Preparación de antecedentes para acreditar inexistencia de participación dolosa.',
        'Seguimiento administrativo hasta la conclusión del procedimiento.',
      ]} />
      <SectionTitle>IV. FUNDAMENTOS NORMATIVOS</SectionTitle>
      <BulletList items={[
        'Código Tributario, especialmente Art. 97 N°4.',
        'Ley sobre Impuesto a las Ventas y Servicios.',
        'Normativa administrativa vigente del SII.',
      ]} />
      <SectionTitle>V. OBSERVACIONES <AIBadge /></SectionTitle>
      <BlankArea fieldKey="observaciones_adicionales" value={f.observaciones_adicionales} onChange={ch} rows={3} />
      <HonorariosSection f={f} ch={ch} />
      <AcceptanceSection sectionNum="VII" />
    </>
  )
}

function ConvenioFull({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>II. EXPOSICIÓN DE LOS HECHOS</SectionTitle>
      <BodyText>Que el contribuyente antes individualizado mantiene actualmente obligaciones tributarias pendientes ante la Tesorería General de la República. Atendida su situación económica actual y capacidad financiera, se solicita la suscripción de un convenio de pago que permita regularizar razonablemente la deuda fiscal existente.</BodyText>
      <SectionTitle>III. FUNDAMENTOS DE DERECHO</SectionTitle>
      <BulletList items={[
        'Artículo 192 del Código Tributario.',
        'DFL N°1 de 1994 del Ministerio de Hacienda.',
        'Normativa administrativa vigente de Tesorería General de la República.',
      ]} />
      <SectionTitle>IV. PROPUESTA DE CONVENIO</SectionTitle>
      <BodyText>En virtud de lo expuesto, se propone:</BodyText>
      <p className="text-[13px] font-bold text-gray-900 mb-1">1. Pago parcial de deuda activa</p>
      <BodyText>Enterar aproximadamente un 40% de la deuda vigente mediante cuotas mensuales compatibles con la capacidad económica del contribuyente.</BodyText>
      <p className="text-[13px] font-bold text-gray-900 mb-1">2. Cuotas propuestas</p>
      <div className="flex gap-6">
        <BlankLine label="Cantidad de cuotas:" fieldKey="cuotas_propuestas_cantidad" value={f.cuotas_propuestas_cantidad} onChange={ch} short />
        <BlankLine label="Monto aprox. cuota: $" fieldKey="cuotas_propuestas_monto" value={f.cuotas_propuestas_monto} onChange={ch} short />
      </div>
      <SectionTitle>V. OBSERVACIONES <AIBadge /></SectionTitle>
      <BlankArea fieldKey="observaciones_adicionales" value={f.observaciones_adicionales} onChange={ch} rows={2} />
      <HonorariosSection f={f} ch={ch} />
      <AcceptanceSection sectionNum="VII" />
    </>
  )
}

function DefensaEjecutiva({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES</SectionTitle>
      <BlankLine label="Titular:" fieldKey="nombre_razon_social" value={f.nombre_razon_social} onChange={ch} />
      <BlankLine label="RUT:" fieldKey="rut" value={f.rut} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Email:" fieldKey="email" value={f.email} onChange={ch} />
      <BlankLine label="Perfil:" fieldKey="perfil_deudor" value={f.perfil_deudor} onChange={ch} />
      <SectionTitle>DIAGNÓSTICO JUDICIAL Y FINANCIERO <AIBadge /></SectionTitle>
      <BlankLine label="Deuda Total Consolidada:" fieldKey="deuda_total_consolidada" value={f.deuda_total_consolidada} onChange={ch} />
      <BlankLine label="Estado de Alerta:" fieldKey="estado_alerta" value={f.estado_alerta} onChange={ch} />
      <div className="mb-2">
        <p className="text-[13px] font-bold text-gray-900">Observación Técnica:</p>
        <BlankArea fieldKey="observacion_tecnica" value={f.observacion_tecnica} onChange={ch} rows={2} />
      </div>
      <SectionTitle>SERVICIO CONTRATADO</SectionTitle>
      <BodyText>Asesoría legal integral para la Defensa Ejecutiva Completa, orientada a:</BodyText>
      <BulletList items={[
        'Representación Judicial: Defensa en juicios ejecutivos iniciados por acreedores.',
        'Estrategia de Prescripción: Dilación técnica y verificación de plazos legales para prescripción de la acción ejecutiva.',
        'Monitoreo Preventivo: Vigilancia diaria en el Poder Judicial para detectar demandas antes de notificación.',
        'Protección de Bienes: Gestión de tercerías para impedir embargo de bienes muebles y/o vehículos.',
      ]} />
      <SectionTitle>OBJETO Y ALCANCE DEL SERVICIO</SectionTitle>
      <BulletList items={[
        'Oposición a la Ejecución: Interposición de excepciones (Art. 464 CPC).',
        'Búsqueda de Prescripción: Monitoreo de inactividad del acreedor.',
        'Estrategia de Salida: Negociaciones con quitas sustanciales.',
        'Vigilancia Sitfa/Suj: Revisión constante de ingresos en tribunales civiles.',
      ]} />
      <SectionTitle>COMPOSICIÓN DE LA DEUDA <AIBadge /></SectionTitle>
      <DebtTableDoc value={f.composicion_deuda} onChange={v => ch('composicion_deuda', v)} />
      <HonorariosSection f={f} ch={ch} showBank />
      <AcceptanceSection sectionNum="V" />
    </>
  )
}

function ProteccionPatrimonial({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. IDENTIFICACIÓN DEL CLIENTE</SectionTitle>
      <BlankLine label="Titular:" fieldKey="nombre_razon_social" value={f.nombre_razon_social} onChange={ch} />
      <BlankLine label="RUT:" fieldKey="rut" value={f.rut} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Email:" fieldKey="email" value={f.email} onChange={ch} />
      <BlankLine label="Perfil del Deudor:" fieldKey="perfil_deudor" value={f.perfil_deudor} onChange={ch} />
      <SectionTitle>DIAGNÓSTICO FINANCIERO <AIBadge /></SectionTitle>
      <BlankLine label="Deuda Financiera Total:" fieldKey="deuda_financiera_total" value={f.deuda_financiera_total} onChange={ch} />
      <BlankLine label="Origen de la deuda:" fieldKey="origen_deuda" value={f.origen_deuda} onChange={ch} />
      <div className="mb-2">
        <p className="text-[13px] font-bold text-gray-900">Observación Técnica:</p>
        <BlankArea fieldKey="observacion_tecnica" value={f.observacion_tecnica} onChange={ch} rows={2} />
      </div>
      <div className="mb-2">
        <p className="text-[13px] font-bold text-gray-900">Protección Patrimonial Solicitada:</p>
        <BlankArea fieldKey="proteccion_patrimonial_solicitada" value={f.proteccion_patrimonial_solicitada} onChange={ch} rows={2} />
      </div>
      <SectionTitle>COMPOSICIÓN DE LA DEUDA <AIBadge /></SectionTitle>
      <DebtTableDoc value={f.composicion_deuda} onChange={v => ch('composicion_deuda', v)} />
      <SectionTitle>II. SERVICIO CONTRATADO</SectionTitle>
      <BodyText>Asesoría legal integral para la Defensa Ejecutiva de Largo Plazo y gestión de protección patrimonial, orientada a:</BodyText>
      <BulletList items={[
        'Blindaje patrimonial frente a embargos y retiros de especies.',
        'Oposición estratégica mediante excepciones legales en juicios ejecutivos.',
        'Gestión de incobrabilidad fáctica y abandono de procedimiento.',
        'Ejecución de estrategia de transferencia de bien raíz para resguardo frente a acreedores.',
      ]} />
      <HonorariosSection f={f} ch={ch} showBank />
      <AcceptanceSection sectionNum="IV" />
    </>
  )
}

function Renegociacion({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. IDENTIFICACIÓN DEL CLIENTE</SectionTitle>
      <BlankLine label="Titular:" fieldKey="nombre_razon_social" value={f.nombre_razon_social} onChange={ch} />
      <BlankLine label="RUT:" fieldKey="rut" value={f.rut} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Email:" fieldKey="email" value={f.email} onChange={ch} />
      <BlankLine label="Perfil del Deudor:" fieldKey="perfil_deudor" value={f.perfil_deudor} onChange={ch} />
      <SectionTitle>DIAGNÓSTICO FINANCIERO <AIBadge /></SectionTitle>
      <BlankLine label="Deuda Total Reportada:" fieldKey="deuda_total_reportada" value={f.deuda_total_reportada} onChange={ch} />
      <BlankLine label="Estado de Pago:" fieldKey="estado_pago" value={f.estado_pago} onChange={ch} />
      <div className="mb-2">
        <p className="text-[13px] font-bold text-gray-900">Observación Técnica:</p>
        <BlankArea fieldKey="observacion_tecnica" value={f.observacion_tecnica} onChange={ch} rows={2} />
      </div>
      <SectionTitle>COMPOSICIÓN DE LA DEUDA FINANCIERA <AIBadge /></SectionTitle>
      <DebtTableDoc value={f.composicion_deuda} onChange={v => ch('composicion_deuda', v)} />
      <SectionTitle>SERVICIO CONTRATADO</SectionTitle>
      <BodyText>Asesoría legal integral y representación técnica ante la Superintendencia de Insolvencia y Reemprendimiento (SUPERIR), orientada a:</BodyText>
      <BulletList items={[
        'Reestructuración Integral de Pasivos: Consolidar la deuda en un plan de pago único.',
        'Condonación de Intereses y Multas: Eliminar recargos generados por la mora pesada.',
        'Protección Financiera Concursal: Suspensión legal de juicios ejecutivos durante negociación.',
        'Blindaje y Rehabilitación: Eliminación de registros de morosidad en Dicom.',
      ]} />
      <HonorariosSection f={f} ch={ch} showBank />
      <AcceptanceSection sectionNum="V" />
    </>
  )
}

function Alzamiento({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES</SectionTitle>
      <BlankLine label="Titular:" fieldKey="nombre_razon_social" value={f.nombre_razon_social} onChange={ch} />
      <BlankLine label="RUT:" fieldKey="rut" value={f.rut} onChange={ch} short transform={rutOnChange} />
      <BlankLine label="Email:" fieldKey="email" value={f.email} onChange={ch} />
      <BlankLine label="Causa / Rol:" fieldKey="causa_referencia" value={f.causa_referencia} onChange={ch} short />
      <BlankLine label="Tribunal:" fieldKey="tribunal" value={f.tribunal} onChange={ch} />
      <BlankLine label="Acreedor / Demandante:" fieldKey="acreedor_demandante" value={f.acreedor_demandante} onChange={ch} />
      <SectionTitle>II. SERVICIO CONTRATADO</SectionTitle>
      <BodyText>Asesoría y gestión legal especializada para el Alzamiento de Embargo de vehículo motorizado, con tramitación ante el Archivero Judicial, Tribunal Civil y Registro Civil e Identificación.</BodyText>
      <SectionTitle>III. OBJETO Y ALCANCE DEL SERVICIO (HOJA DE RUTA)</SectionTitle>
      <BulletList items={[
        'Gestión de Desarchivo: Solicitud de desarchivo ante el tribunal y pago de derechos.',
        'Impulso ante Archivero Judicial: Coordinación del envío efectivo del expediente.',
        'Notificación a la Demandante: Gestión con Receptor Judicial.',
        'Solicitud de Alzamiento de Embargo: Presentación de escrito judicial.',
        'Inscripción en Registro Civil: Cancelación del embargo en el RVM.',
      ]} />
      <SectionTitle>IV. ESTRATEGIA LEGAL <AIBadge /></SectionTitle>
      <BlankArea fieldKey="estrategia_legal" value={f.estrategia_legal} onChange={ch} rows={3} />
      <HonorariosSection f={f} ch={ch} showBank />
      <AcceptanceSection sectionNum="VI" />
    </>
  )
}

function Constitucion({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>II. OBJETO DE LA CONTRATACIÓN</SectionTitle>
      <BodyText>Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales destinados a la creación de una nueva sociedad del tipo y giro elegido, incluyendo la constitución, inicio de actividades y verificación de actividad económica ante el SII.</BodyText>
      <div className="flex gap-6 mb-2">
        <div className="flex items-end gap-1">
          <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap shrink-0">Tipo societario:</span>
          <select className="border-b-2 border-gray-400 bg-transparent text-[13px] font-bold text-gray-900 outline-none px-1"
            value={f.tipo_societario || ''} onChange={e => ch('tipo_societario', e.target.value)}>
            <option value="">Seleccionar…</option>
            {['SpA','SRL','EIRL','SA','Otro'].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-1">
          <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap shrink-0">Método:</span>
          <select className="border-b-2 border-gray-400 bg-transparent text-[13px] font-bold text-gray-900 outline-none px-1"
            value={f.metodo_constitucion || ''} onChange={e => ch('metodo_constitucion', e.target.value)}>
            <option value="">Seleccionar…</option>
            <option>Digital (RES)</option>
            <option>Tradicional (Notaría + CBR)</option>
          </select>
        </div>
      </div>
      <SectionTitle>III. SERVICIOS INCLUIDOS</SectionTitle>
      <BulletList items={[
        'Redacción de escritura de constitución, inscripción en CBR y publicación en Diario Oficial.',
        'Inicio de actividades, obtención de RUT y cédula e-RUT ante el SII.',
        'Redacción de contratos para Verificación de actividades económicas.',
        'Seguimiento integral del procedimiento.',
      ]} />
      <SectionTitle>IV. FUNDAMENTOS NORMATIVOS</SectionTitle>
      <BulletList items={[
        'Art. 2053 y siguientes del Código Civil.',
        'Ley N° 3.918 (SRL) / Ley N° 20.190 (SpA).',
        'Decreto Ley N° 824 y N° 825.',
      ]} />
      <SectionTitle>V. PLAZO ESTIMADO DEL PROCEDIMIENTO <AIBadge /></SectionTitle>
      <BlankArea fieldKey="plazo_estimado" value={f.plazo_estimado} onChange={ch} rows={2} />
      <HonorariosSection f={f} ch={ch} />
      <AcceptanceSection sectionNum="VII" />
    </>
  )
}

// ── Debt table ─────────────────────────────────────────────────────────────────

function DebtTableDoc({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const rows: any[] = Array.isArray(value) ? value : (typeof value === 'string' ? (() => { try { return JSON.parse(value) } catch { return [] } })() : [])
  const setRow = (i: number, key: string, val: string) => onChange(rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r))
  const addRow = () => onChange([...rows, { acreedor: '', tipo_producto: '', monto_total: '', estado_critico: '' }])
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i))
  return (
    <div className="mb-3">
      <table className="w-full text-[12px] font-bold border border-gray-400">
        <thead>
          <tr className="bg-gray-200">
            {['Acreedor', 'Tipo de Producto', 'Monto Total', 'Estado'].map(h => (
              <th key={h} className="border border-gray-400 px-2 py-1 text-left font-bold text-gray-900">{h}</th>
            ))}
            <th className="w-6 border border-gray-400" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {(['acreedor','tipo_producto','monto_total','estado_critico'] as const).map(col => (
                <td key={col} className="border border-gray-400 px-1">
                  <input className="w-full bg-transparent text-gray-900 font-bold outline-none text-[12px] py-0.5 px-1"
                    value={row[col] || ''} onChange={e => setRow(i, col, e.target.value)} placeholder="—" />
                </td>
              ))}
              <td className="border border-gray-400 text-center" data-html2canvas-ignore="true">
                <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 px-1"><Minus size={10} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button data-html2canvas-ignore="true" onClick={addRow} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-gray-500 hover:text-gray-700 border border-dashed border-gray-300 px-2 py-0.5 rounded">
        <Plus size={10} /> Agregar fila
      </button>
    </div>
  )
}


// ── Contrato de encargo de tratamiento (Ley 21.719) ──────────────────────────
// Reutiliza este mismo motor de documentos, que ya no se ocupa para el rubro
// legal. La ley exige contrato ESCRITO entre responsable (la pyme) y encargado
// (Zelix); sin él, onboardear pymes después de diciembre de 2026 es infracción
// de las dos partes. El wording debe ir igual que en `ot_templates.py`, que es
// el que emite el PDF — si divergen, el cliente firma una cosa y recibe otra.
function EncargoDatos({ f, ch }: { f: Record<string, any>; ch: (k: string, v: string) => void }) {
  return (
    <>
      <SectionTitle>II. PARTES Y ROLES</SectionTitle>
      <BodyText>Para efectos de la Ley N° 19.628, con las modificaciones introducidas por la Ley N° 21.719, las partes reconocen expresamente los siguientes roles:</BodyText>
      <BulletList items={[
        'EL CLIENTE individualizado en la sección anterior actúa como RESPONSABLE del tratamiento respecto de los datos personales de sus propios clientes y contactos.',
        'ZELIX actúa como ENCARGADO del tratamiento, tratando dichos datos únicamente por cuenta del responsable y conforme a sus instrucciones documentadas.',
      ]} />
      <BodyText>Zelix no determina los fines del tratamiento ni utiliza los datos para finalidades propias.</BodyText>

      <SectionTitle>III. OBJETO, NATURALEZA, FINALIDAD Y DURACIÓN</SectionTitle>
      <BodyText>El objeto es el tratamiento de datos personales necesario para prestar el servicio de asistente conversacional de ventas: recibir mensajes de los clientes del responsable, responderlos automáticamente, registrar pedidos y facilitar el cobro.</BodyText>

      <SectionTitle>IV. DATOS Y TITULARES ALCANZADOS</SectionTitle>
      <BulletList items={[
        'Identificadores de contacto: número de teléfono y nombre de perfil del cliente final.',
        'Contenido de las conversaciones sostenidas con el asistente.',
        'Datos de pedidos: productos, cantidades, montos y fechas.',
        'Datos de identificación del responsable y de sus operadores autorizados.',
      ]} />
      <BodyText>Zelix aplica filtros automáticos que impiden el almacenamiento de datos de tarjetas de pago.</BodyText>

      <SectionTitle>V. OBLIGACIONES DEL ENCARGADO</SectionTitle>
      <BulletList items={[
        'Tratar los datos únicamente conforme a las instrucciones documentadas del responsable.',
        'Garantizar que quienes accedan a los datos estén sujetos a deber de confidencialidad.',
        'Aplicar medidas técnicas y organizativas apropiadas al riesgo, incluyendo aislamiento lógico entre comercios, cifrado de credenciales y registro de accesos.',
        'No comunicar ni ceder los datos a terceros distintos de los subencargados autorizados.',
        'Asistir al responsable en el cumplimiento de sus propias obligaciones.',
        'Mantener un registro de las actividades de tratamiento y ponerlo a su disposición.',
      ]} />

      <SectionTitle>VI. SUBENCARGADOS AUTORIZADOS</SectionTitle>
      <BulletList items={[
        'Supabase, Inc. (EE.UU.) — almacenamiento de base de datos y bóveda cifrada de credenciales.',
        'Render, Inc. (EE.UU.) — alojamiento y procesamiento del backend.',
        'Cloudflare, Inc. (EE.UU.) — sitio web y red de entrega de contenidos.',
        'OpenAI, LLC (EE.UU.) — generación de las respuestas del asistente.',
        'Google LLC (EE.UU.) — respaldo ante indisponibilidad del proveedor principal.',
        'Meta Platforms, Inc. (EE.UU.) — transporte de los mensajes de WhatsApp.',
        'Telegram Messenger Inc. — transporte de los mensajes del canal Telegram.',
        'Flow (Chile) — procesamiento de pagos; Zelix no accede a datos de tarjeta.',
      ]} />

      <SectionTitle>VII. TRANSFERENCIA INTERNACIONAL</SectionTitle>
      <BodyText>Salvo Flow, los subencargados se encuentran fuera del territorio nacional. La transferencia se ampara en cláusulas contractuales de protección de datos que imponen obligaciones equivalentes y prohíben el uso de los datos para fines propios del proveedor. Tratándose de proveedores de inteligencia artificial, el tratamiento excluye el uso del contenido de las conversaciones para entrenar sus modelos.</BodyText>

      <SectionTitle>VIII. SEGURIDAD Y NOTIFICACIÓN DE VULNERACIONES</SectionTitle>
      <BodyText>Detectada una vulneración que afecte datos tratados por cuenta del responsable, Zelix se lo notificará SIN DILACIÓN INDEBIDA, informando naturaleza, categorías y volumen aproximado de datos afectados, consecuencias probables y medidas adoptadas. La notificación a la Agencia y a los titulares es obligación del responsable; Zelix le prestará la asistencia necesaria para cumplirla en plazo.</BodyText>

      <SectionTitle>IX. ASISTENCIA EN EL EJERCICIO DE DERECHOS</SectionTitle>
      <BodyText>Zelix asistirá al responsable para atender solicitudes de acceso, rectificación, supresión, oposición, portabilidad y bloqueo. Si un titular se dirige directamente a Zelix, su solicitud se deriva al responsable sin demora.</BodyText>

      <SectionTitle>X. DEVOLUCIÓN O SUPRESIÓN AL TÉRMINO</SectionTitle>
      <BodyText>Terminada la prestación, Zelix suprimirá los datos, salvo el respaldo tributario de las operaciones, que se conserva seis años conforme al artículo 200 del Código Tributario y no incluye el contenido de las conversaciones ni los identificadores de contacto.</BodyText>

      <SectionTitle>XI. AUDITORÍA Y ACREDITACIÓN</SectionTitle>
      <BodyText>Zelix pondrá a disposición del responsable la información necesaria para acreditar el cumplimiento, y permitirá auditorías razonables acordadas con antelación, sin comprometer la seguridad ni la confidencialidad de los datos de otros comercios.</BodyText>

      <SectionTitle>XII. PLAZO Y VIGENCIA <AIBadge /></SectionTitle>
      <BlankArea fieldKey="vigencia_encargo" value={f.vigencia_encargo} onChange={ch} rows={2} />
    </>
  )
}

// ── Full document renderer ────────────────────────────────────────────────────

function renderTypeContent(otType: string, f: Record<string, any>, ch: (k: string, v: string) => void) {
  switch (otType) {
    case 'prescripcion':           return <Prescripcion f={f} ch={ch} />
    case 'desbloqueo':             return <Desbloqueo f={f} ch={ch} />
    case 'desbloqueo_contable':    return <Desbloqueo f={f} ch={ch} conContable />
    case 'liquidacion_juridica':   return <LiquidacionJuridica f={f} ch={ch} />
    case 'liquidacion_natural':    return <LiquidacionNatural f={f} ch={ch} />
    case 'facturas_irregulares':   return <FacturasIrregulares f={f} ch={ch} />
    case 'convenio_full':          return <ConvenioFull f={f} ch={ch} />
    case 'defensa_ejecutiva':      return <DefensaEjecutiva f={f} ch={ch} />
    case 'proteccion_patrimonial': return <ProteccionPatrimonial f={f} ch={ch} />
    case 'renegociacion':          return <Renegociacion f={f} ch={ch} />
    case 'alzamiento':             return <Alzamiento f={f} ch={ch} />
    case 'constitucion':           return <Constitucion f={f} ch={ch} />
    case 'encargo_datos':          return <EncargoDatos f={f} ch={ch} />
    default:                       return null
  }
}

// Types that include their own client section
const HAS_OWN_CLIENT = new Set(['liquidacion_juridica','liquidacion_natural','defensa_ejecutiva','proteccion_patrimonial','renegociacion','alzamiento'])

function FullDocument({ otType, otTitle, otSubtitle, fields, onChange, docRef }: {
  otType: string; otTitle: string; otSubtitle: string
  fields: Record<string, any>
  onChange: (k: string, v: any) => void
  docRef?: React.RefObject<HTMLDivElement | null>
}) {
  const ch = (k: string, v: any) => onChange(k, v)

  return (
    // White A4-style paper
    <div ref={docRef} className="bg-white text-gray-900 min-h-full" style={{ fontFamily: '"Play", "Georgia", serif' }}>

      {/* Header image — the actual wave banner from the Word doc */}
      <img
        src="/ot_header.png"
        alt="Abogados Tributarios"
        className="w-full block"
        style={{ maxHeight: 120, objectFit: 'cover', objectPosition: 'center top' }}
      />

      {/* Document body */}
      <div className="px-4 sm:px-10 py-4 sm:py-6">

        {/* Document title block */}
        <div className="mb-4">
          <p className="text-[15px] font-bold text-gray-900 uppercase leading-tight">ORDEN DE TRABAJO</p>
          <p className="text-[13px] font-bold text-gray-900 uppercase leading-tight mt-0.5">{otTitle}</p>
          {otSubtitle && otSubtitle !== otTitle && (
            <p className="text-[12px] font-bold text-gray-900 uppercase leading-tight mt-0.5">{otSubtitle}</p>
          )}
        </div>

        {/* Date */}
        <BlankLine label="Fecha:" fieldKey="fecha" value={fields.fecha} onChange={ch} short />

        {/* Client section — for simple types */}
        {!HAS_OWN_CLIENT.has(otType) && (
          <ClientSection f={fields} ch={ch} />
        )}

        {/* Type-specific content */}
        {renderTypeContent(otType, fields, ch)}

      </div>

      {/* Footer image */}
      <img
        src="/ot_footer.gif"
        alt="Footer"
        className="w-full block mt-4"
        style={{ maxHeight: 50, objectFit: 'contain' }}
      />
    </div>
  )
}

// ── Main Modal ──────────────────────────────────────────────────────────────────

export function WorkOrderModal({ leadId, onClose, onSaved, autoOpen, honorarios, autoClose }: Props) {
  const [step, setStep] = useState<'list' | 'select' | 'form'>('list')
  const [otTypes, setOtTypes] = useState<OTType[]>([])
  const [otList, setOtList] = useState<WorkOrder[]>([])
  const [selectedType, setSelectedType] = useState<OTType | null>(null)
  const [currentWO, setCurrentWO] = useState<WorkOrder | null>(null)
  const [fields, setFields] = useState<Record<string, any>>({})
  const [loadingNew, setLoadingNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aiFilling, setAiFilling] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [isNewUnsaved, setIsNewUnsaved] = useState(false)
  const [newOtIds, setNewOtIds] = useState<number[]>([])
  const docRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    try { setOtList(await listWorkOrders(leadId)) } catch { /* silent */ }
  }, [leadId])

  useEffect(() => {
    const init = async () => {
      const [types, list] = await Promise.all([
        getOTTypes().catch(() => [] as OTType[]),
        listWorkOrders(leadId).catch(() => [] as WorkOrder[]),
      ])
      setOtTypes(types)
      setOtList(list)
      if (autoOpen && list.length > 0) {
        // Prefer copia (has current values synced from lead edits)
        const target = list.find((w: WorkOrder) => w.is_copy) ?? list.find((w: WorkOrder) => !w.is_copy) ?? list[0]
        const type = types.find((t: OTType) => t.key === target.ot_type) ?? null
        setCurrentWO(target); setFields(computePaymentFields(target.fields_json)); setSelectedType(type); setStep('form')
      }
    }
    init()
  }, [leadId, autoOpen])

  const snapPieToExact = useCallback(() => {
    setFields(prev => {
      const hon = gi(prev.honorarios)
      const nc  = gi(prev.num_cuotas) || 1
      const mc  = gi(prev.monto_cuota)
      if (hon > 0 && nc > 0 && mc > 0) {
        const pieExact = hon - nc * mc
        if (pieExact >= 0) return { ...prev, pie_inicial: String(pieExact) }
      }
      return prev
    })
  }, [])

  const setField = (key: string, value: any) => setFields(prev => {
    const next = { ...prev, [key]: value }
    const hon = gi(key === 'honorarios'  ? value : prev.honorarios)
    let   pie = gi(key === 'pie_inicial' ? value : prev.pie_inicial)
    const nc  = gi(key === 'num_cuotas'  ? value : prev.num_cuotas) || 1
    const mc  = gi(key === 'monto_cuota' ? value : prev.monto_cuota)
    // Regla dura: el pie inicial NUNCA puede superar los honorarios.
    if (key === 'pie_inicial' && hon > 0 && pie > hon) {
      toast.error('El pie inicial no puede ser mayor que los honorarios profesionales')
      pie = hon
      next.pie_inicial = String(hon)
    }
    if (key === 'honorarios' || key === 'num_cuotas') {
      const mc_new = nc > 0 ? Math.floor((hon - pie) / nc) : 0
      next.monto_cuota = String(mc_new)
      next.pie_inicial = String(Math.max(0, hon - nc * mc_new))
    } else if (key === 'pie_inicial') {
      next.monto_cuota = nc > 0 ? String(Math.max(0, Math.round((hon - pie) / nc))) : '0'
    } else if (key === 'monto_cuota') {
      const pieExact = hon - nc * mc
      next.pie_inicial = String(Math.max(0, pieExact))
    }
    return next
  })

  const openNew = async (type: OTType) => {
    setLoadingNew(true)
    try {
      const result = await createWorkOrder({ lead_id: leadId, ot_type: type.key })
      const copy: WorkOrder = result.copia
      const original: WorkOrder = result.original
      setNewOtIds([original.id, copy.id])
      setCurrentWO(copy); setFields(computePaymentFields(copy.fields_json)); setSelectedType(type); setIsNewUnsaved(true); setStep('form')
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Error al crear OT')
    } finally { setLoadingNew(false) }
  }

  const openExisting = (wo: WorkOrder) => {
    const type = otTypes.find(t => t.key === wo.ot_type)
    setCurrentWO(wo); setFields(computePaymentFields(wo.fields_json)); setSelectedType(type || null); setStep('form')
  }

  const handleSave = async (status?: string) => {
    if (!currentWO) return
    // Guard de coherencia financiera antes de persistir (cinturón + tirantes
    // sobre el clamp en vivo de setField).
    const _hon = gi(fields.honorarios), _pie = gi(fields.pie_inicial)
    if (_hon > 0 && _pie > _hon) {
      toast.error('El pie inicial no puede ser mayor que los honorarios profesionales. Corrige los montos antes de guardar.')
      return
    }
    setSaving(true)
    try {
      const updated: WorkOrder = await updateWorkOrder(currentWO.id, { fields_json: fields, status: status || currentWO.status, notify_agendadora: true })
      setCurrentWO(updated); setFields(computePaymentFields(updated.fields_json))
      setIsNewUnsaved(false); setNewOtIds([])
      toast.success('OT guardada'); loadList(); onSaved?.()
      if (autoClose) { setTimeout(() => onClose(), 400) }
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Error al guardar') }
    finally { setSaving(false) }
  }

  const handleAIFill = async () => {
    if (!currentWO) return
    setSaving(true)
    try { await updateWorkOrder(currentWO.id, { fields_json: fields }) } catch { /* ignore */ } finally { setSaving(false) }
    setAiFilling(true)
    try {
      const updated: WorkOrder = await aiFillWorkOrder(currentWO.id)
      setCurrentWO(updated); setFields(computePaymentFields(updated.fields_json))
      toast.success('Campos completados por IA ✓')
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Error al llamar la IA') }
    finally { setAiFilling(false) }
  }

  const handleDownload = async () => {
    if (!docRef.current) return
    await handleSave('final')
    setDownloading(true)
    let offscreen: HTMLDivElement | null = null
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      const BASE = 'font-family:Georgia,serif;font-size:13px;font-weight:700;color:#111827;background:transparent;outline:none;padding:0 2px 3px;line-height:1.5;vertical-align:baseline;'
      const UL = ''

      // Read live values before cloning
      const liveInputs = Array.from(docRef.current.querySelectorAll('input')).map((i: any) => i.value)
      const liveTextareas = Array.from(docRef.current.querySelectorAll('textarea')).map((t: any) => t.value)
      const liveSelects = Array.from(docRef.current.querySelectorAll('select')).map((s: any) => s.value)

      const clone = docRef.current.cloneNode(true) as HTMLDivElement

      clone.querySelectorAll('input').forEach((inp: any, i: number) => {
        if (inp.hasAttribute('data-html2canvas-ignore')) { inp.remove(); return }
        const val = liveInputs[i] || ''
        const hasFlex = inp.style.flex !== '' || inp.style.flexGrow !== ''
        const hasExplicitWidth = inp.style.width !== '' && inp.style.width !== 'auto'
        const span = document.createElement('span')
        span.textContent = val || '\u00a0'
        const border = ''
        span.setAttribute('style',
          BASE + border +
          'display:inline-block;' +
          `min-width:${inp.style.minWidth || '80px'};` +
          (hasExplicitWidth ? `width:${inp.style.width};` : 'flex:1;min-width:0;')
        )
        inp.replaceWith(span)
      })
      clone.querySelectorAll('textarea').forEach((ta: any, i: number) => {
        const val = liveTextareas[i] || ''
        const span = document.createElement('span')
        span.textContent = val || '\u00a0'
        const border = ''
        span.setAttribute('style', BASE + border + 'display:block;width:100%;white-space:pre-wrap;min-height:1.4em;')
        ta.replaceWith(span)
      })
      clone.querySelectorAll('select').forEach((sel: any, i: number) => {
        const span = document.createElement('span')
        span.textContent = liveSelects[i] || '\u00a0'
        span.setAttribute('style', BASE + 'display:inline-block;min-width:80px;')
        sel.replaceWith(span)
      })
      clone.querySelectorAll('[data-html2canvas-ignore]').forEach((e: any) => e.remove())

      // Force bold + black on all text spans so html2canvas picks it up without Tailwind
      clone.querySelectorAll('span').forEach((sp: any) => {
        sp.style.fontWeight = '700'
        if (sp.style.color === '' || sp.classList.contains('text-blue-700')) {
          sp.style.color = '#111827'
        }
      })

      // Force explicit flex/align styles so html2canvas renders them correctly
      clone.querySelectorAll('div').forEach((div: any) => {
        const cl = Array.from(div.classList) as string[]
        if (cl.includes('flex')) {
          div.style.display = 'flex'
          if (cl.includes('items-end')) {
            div.style.alignItems = 'baseline'
          } else if (cl.includes('items-center')) {
            div.style.alignItems = 'center'
          }
          if (cl.includes('gap-1')) div.style.gap = '4px'
          else if (cl.includes('gap-6')) div.style.gap = '24px'
        }
      })

      // Mount offscreen at A4 width, outside modal
      offscreen = document.createElement('div')
      offscreen.style.cssText = 'position:fixed;top:-99999px;left:0;width:794px;background:#fff;z-index:-9999;overflow:visible;'
      offscreen.appendChild(clone)
      document.body.appendChild(offscreen)
      await new Promise(r => setTimeout(r, 150))

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollY: 0,
        windowWidth: 794,
        width: 794,
        height: clone.scrollHeight,
        logging: false,
      })

      const imgData = canvas.toDataURL('image/png')
      const pdfW = 210  // A4 width mm
      const imgH = (canvas.height * pdfW) / canvas.width
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfW, imgH] })
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, imgH)
      const nombre = fields.nombre_razon_social || 'lead_' + leadId
      pdf.save('OT_' + nombre + '_' + currentWO!.ot_type + '.pdf')
      toast.success('PDF descargado')
    } catch (e) {
      console.error(e)
      toast.error('Error al generar PDF')
    } finally {
      offscreen?.remove()
      setDownloading(false)
    }
  }

  const handleDownloadViewOnly = async () => {
    if (!docRef.current || !currentWO) return
    setDownloading(true)
    let offscreen: HTMLDivElement | null = null
    try {
      const html2canvas = (await import('html2canvas')).default
      const { jsPDF } = await import('jspdf')

      const BASE = 'font-family:Georgia,serif;font-size:13px;font-weight:700;color:#111827;background:transparent;outline:none;padding:0 2px 3px;line-height:1.5;vertical-align:baseline;'

      // Convert live images to data URLs (avoids html2canvas CORS/loading issues)
      const imgDataMap = new Map<string, string>()
      for (const imgEl of Array.from(docRef.current.querySelectorAll('img')) as HTMLImageElement[]) {
        if (!imgEl.naturalWidth) continue
        try {
          const c = document.createElement('canvas')
          c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight
          c.getContext('2d')!.drawImage(imgEl, 0, 0)
          imgDataMap.set(imgEl.src, c.toDataURL('image/png'))
        } catch { /* tainted canvas — skip, html2canvas will try on its own */ }
      }

      const liveInputs    = Array.from(docRef.current.querySelectorAll('input')).map((i: any) => i.value)
      const liveTextareas = Array.from(docRef.current.querySelectorAll('textarea')).map((t: any) => t.value)
      const liveSelects   = Array.from(docRef.current.querySelectorAll('select')).map((s: any) => s.value)

      const clone = docRef.current.cloneNode(true) as HTMLDivElement

      // Substitute image srcs with preloaded data URLs
      clone.querySelectorAll('img').forEach((img: any) => {
        const d = imgDataMap.get(img.src)
        if (d) img.src = d
      })

      clone.querySelectorAll('input').forEach((inp: any, i: number) => {
        if (inp.hasAttribute('data-html2canvas-ignore')) { inp.remove(); return }
        const val = liveInputs[i] || ''
        const hasFlex = inp.style.flex !== '' || inp.style.flexGrow !== ''
        const hasExplicitWidth = inp.style.width !== '' && inp.style.width !== 'auto'
        const span = document.createElement('span')
        span.textContent = val || ' '
        span.setAttribute('style',
          BASE + 'display:inline-block;' +
          `min-width:${inp.style.minWidth || '80px'};` +
          (hasExplicitWidth ? `width:${inp.style.width};` : 'flex:1;min-width:0;')
        )
        inp.replaceWith(span)
      })
      clone.querySelectorAll('textarea').forEach((ta: any, i: number) => {
        const span = document.createElement('span')
        span.textContent = liveTextareas[i] || ' '
        span.setAttribute('style', BASE + 'display:block;width:100%;white-space:pre-wrap;min-height:1.4em;')
        ta.replaceWith(span)
      })
      clone.querySelectorAll('select').forEach((sel: any, i: number) => {
        const span = document.createElement('span')
        span.textContent = liveSelects[i] || ' '
        span.setAttribute('style', BASE + 'display:inline-block;min-width:80px;')
        sel.replaceWith(span)
      })
      clone.querySelectorAll('[data-html2canvas-ignore]').forEach((e: any) => e.remove())

      clone.querySelectorAll('span').forEach((sp: any) => {
        sp.style.fontWeight = '700'
        if (sp.style.color === '' || sp.classList.contains('text-blue-700')) sp.style.color = '#111827'
      })
      clone.querySelectorAll('div').forEach((div: any) => {
        const cl = Array.from(div.classList) as string[]
        if (cl.includes('flex')) {
          div.style.display = 'flex'
          if (cl.includes('items-end')) div.style.alignItems = 'baseline'
          else if (cl.includes('items-center')) div.style.alignItems = 'center'
          if (cl.includes('gap-1')) div.style.gap = '4px'
          else if (cl.includes('gap-6')) div.style.gap = '24px'
        }
      })

      offscreen = document.createElement('div')
      offscreen.style.cssText = 'position:fixed;top:-99999px;left:0;width:794px;background:#fff;z-index:-9999;overflow:visible;'
      offscreen.appendChild(clone)
      document.body.appendChild(offscreen)
      await new Promise(r => setTimeout(r, 200))

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        scrollY: 0,
        windowWidth: 794,
        width: 794,
        height: clone.scrollHeight || 1000,
        logging: false,
      })

      const imgData = canvas.toDataURL('image/png')
      const pdfW = 210
      const imgH = (canvas.height * pdfW) / canvas.width
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfW, imgH] })
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, imgH)
      const nombre = fields.nombre_razon_social || 'lead_' + leadId
      pdf.save('OT_' + nombre + '_' + currentWO!.ot_type + '.pdf')
      toast.success('PDF descargado')
    } catch (e) {
      console.error('html2canvas error:', e)
      toast.error('Error al generar PDF')
    } finally {
      offscreen?.remove()
      setDownloading(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    try {
      await deleteWorkOrder(id); toast.success('OT eliminada'); loadList()
      if (currentWO?.id === id) { setStep('list'); setCurrentWO(null) }
    } catch { toast.error('Error al eliminar') }
    finally { setDeleting(null) }
  }

  const backToSelect = async () => {
    if (isNewUnsaved) {
      await Promise.all(newOtIds.map(id => deleteWorkOrder(id).catch(() => {})))
    }
    setIsNewUnsaved(false); setNewOtIds([]); setStep('select'); setCurrentWO(null); loadList()
  }

  const handleClose = async () => {
    if (isNewUnsaved) {
      await Promise.all(newOtIds.map(id => deleteWorkOrder(id).catch(() => {})))
    }
    onClose()
  }

  // ── STEP: List ──────────────────────────────────────────────────────────────

  if (step === 'list' && autoOpen) return (
    <Shell onClose={onClose} title="Orden de Trabajo">
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(225,29,72,0.07)', border: '1.5px solid rgba(225,29,72,0.15)' }}>
          <FileText size={28} style={{ color: '#e11d48', opacity: 0.6 }} />
        </div>
        <div className="text-center">
          <p className="font-semibold" style={{ color: '#1c1633', fontSize: '15px' }}>No se encontró la orden de trabajo</p>
          <p className="text-sm mt-1" style={{ color: 'rgba(28,22,51,0.50)' }}>Este lead aún no tiene una OT generada.</p>
        </div>
      </div>
    </Shell>
  )

  if (step === 'list') return (
    <Shell onClose={onClose} title="Órdenes de Trabajo"
      headerRight={
        <button onClick={() => setStep('select')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
          style={{ background: 'var(--zx-accent-text)', color: '#fff', boxShadow: '0 2px 8px rgba(53,122,14,0.25)' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#3451d1'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--zx-accent-text)'}>
          <Plus size={12} /> Nueva OT
        </button>
      }>
      {otList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(53,122,14,0.07)', border: '1.5px solid rgba(53,122,14,0.15)' }}>
            <FileText size={28} style={{ color: 'var(--zx-accent-text)', opacity: 0.55 }} />
          </div>
          <div className="text-center">
            <p className="font-semibold" style={{ color: '#1c1633', fontSize: '15px' }}>Sin órdenes de trabajo</p>
            <p className="text-sm mt-1" style={{ color: 'rgba(28,22,51,0.50)' }}>Usa el botón "+ Nueva OT" para crear una</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {otList.map(wo => {
            const isOriginal = !wo.is_copy
            return (
              <div key={wo.id}
                className="rounded-xl px-4 py-3 flex items-center gap-3 group transition-all"
                style={{
                  background: isOriginal ? '#fafafa' : '#faf9fd',
                  border: `1.5px solid ${isOriginal ? '#d1d5db' : '#e6e1f0'}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; (e.currentTarget as HTMLElement).style.borderColor = isOriginal ? '#cbd5e1' : '#c7d2fe' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isOriginal ? '#fafafa' : '#faf9fd'; (e.currentTarget as HTMLElement).style.borderColor = isOriginal ? '#d1d5db' : '#e6e1f0' }}
                onClick={() => openExisting(wo)}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isOriginal ? 'rgba(100,116,139,0.10)' : 'rgba(53,122,14,0.10)',
                    border: `1.5px solid ${isOriginal ? 'rgba(100,116,139,0.20)' : 'rgba(53,122,14,0.20)'}`,
                  }}>
                  <FileText size={18} style={{ color: isOriginal ? '#64748b' : 'var(--zx-accent-text)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#1c1633' }}>{wo.ot_label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs" style={{ color: 'rgba(28,22,51,0.50)' }}>
                      {new Date(wo.created_at).toLocaleDateString('es-CL')}
                    </p>
                    {isOriginal ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(100,116,139,0.12)', color: '#64748b', border: '1px solid rgba(100,116,139,0.20)' }}>
                        🔒 Original
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(53,122,14,0.10)', color: 'var(--zx-accent-text)', border: '1px solid rgba(53,122,14,0.20)' }}>
                        ✏️ Copia editable
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={e => { e.stopPropagation(); openExisting(wo) }}
                    className="p-2 rounded-lg transition-all"
                    style={{ color: isOriginal ? '#64748b' : 'var(--zx-accent-text)', background: isOriginal ? 'rgba(100,116,139,0.08)' : 'rgba(53,122,14,0.08)', border: `1px solid ${isOriginal ? 'rgba(100,116,139,0.15)' : 'rgba(53,122,14,0.15)'}` }}
                    title={isOriginal ? 'Ver original' : 'Abrir OT'}>
                    {isOriginal ? <Eye size={13} /> : <Download size={13} />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(wo.id) }} disabled={deleting === wo.id}
                    className="p-2 rounded-lg transition-all"
                    style={{ color: '#e11d48', background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.15)' }}>
                    {deleting === wo.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )

  // ── STEP: Select type ───────────────────────────────────────────────────────

  if (step === 'select') return (
    <Shell onClose={onClose} title="Seleccionar tipo de OT"
      headerLeft={
        <button onClick={() => setStep('list')}
          className="p-1.5 rounded-lg transition-all"
          style={{ color: 'rgba(28,22,51,0.45)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1c1633'; (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.06)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.45)'; (e.currentTarget as HTMLElement).style.background = '' }}>
          <ChevronLeft size={16} />
        </button>
      }>
      {loadingNew ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--zx-accent-text)' }} />
          <p className="text-sm font-medium" style={{ color: 'rgba(28,22,51,0.55)' }}>Creando orden de trabajo...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {otTypes.map(type => (
            <button key={type.key} onClick={() => openNew(type)} disabled={loadingNew}
              className="rounded-xl p-3.5 text-left transition-all"
              style={{ background: '#faf9fd', border: '1.5px solid #e8ecf4' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = '#eef2ff'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(53,122,14,0.35)'
                ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 14px rgba(53,122,14,0.12)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = '#faf9fd'
                ;(e.currentTarget as HTMLElement).style.borderColor = '#e8ecf4'
                ;(e.currentTarget as HTMLElement).style.boxShadow = ''
              }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 text-xl"
                style={{ background: 'rgba(53,122,14,0.08)', border: '1px solid rgba(53,122,14,0.14)' }}>
                {type.icon}
              </div>
              <p className="text-xs font-bold leading-snug" style={{ color: '#1c1633' }}>{type.label}</p>
            </button>
          ))}
        </div>
      )}
    </Shell>
  )

  // ── STEP: Document view ─────────────────────────────────────────────────────

  if (step === 'form' && selectedType && currentWO) {
    const isReadOnly = !currentWO.is_copy
    const viewOnly = !!autoOpen
    const missingHonorarios = !isReadOnly && (parseInt(String(fields.honorarios ?? '0').replace(/\D/g,'')) || 0) <= 0
    const openCopia = () => {
      const copia = otList.find(w => w.is_copy)
      if (!copia) return
      setCurrentWO(copia); setFields(copia.fields_json); setSelectedType(selectedType)
    }

    return (
      <Shell onClose={handleClose} title={selectedType.label} wide
        headerLeft={!viewOnly
          ? <button onClick={backToSelect} className="p-1.5 rounded-lg hover:bg-surface-2" style={{ color: 'var(--text-muted)' }}><ChevronLeft size={16} /></button>
          : undefined}
        headerRight={!viewOnly
          ? <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={isReadOnly
                ? { background: 'rgba(100,116,139,0.12)', color: '#64748b', border: '1px solid rgba(100,116,139,0.25)' }
                : { background: 'rgba(53,122,14,0.10)', color: 'var(--zx-accent-text)', border: '1px solid rgba(53,122,14,0.25)' }}>
              {isReadOnly ? '🔒 Original' : '✏️ Copia editable'}
            </span>
          : undefined}
        footer={viewOnly
          ? <div className="flex items-center justify-end px-3 sm:px-5 py-3 border-t" style={{ borderColor: 'rgba(28,22,51,0.09)', background: '#fafafa' }}>
              <button onClick={handleDownloadViewOnly} disabled={downloading}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {downloading ? 'Descargando...' : 'Descargar OT'}
              </button>
            </div>
          : <div className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-3 border-t" style={{ borderColor: 'rgba(28,22,51,0.09)', background: '#fafafa' }}>
            {!isReadOnly && (
              <button onClick={handleAIFill} disabled={aiFilling || saving}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all"
                style={{ background: '#1e3a8a', color: '#ffffff', border: '1px solid #3b82f6' }}>
                {aiFilling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {aiFilling ? 'Completando...' : 'IA'}
              </button>
            )}
            <div className="flex-1" />
            {missingHonorarios && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.25)', color: '#e11d48' }}>
                <AlertCircle size={12} /> Completa los honorarios para guardar
              </div>
            )}
            {!isReadOnly && (
              <button
                onClick={() => { if (missingHonorarios) { toast.error('Debes ingresar el monto de honorarios antes de guardar'); return } handleSave() }}
                disabled={saving || aiFilling}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                style={missingHonorarios ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {isNewUnsaved ? 'Agregar' : 'Guardar'}
              </button>
            )}
            <button
              onClick={() => { if (missingHonorarios) { toast.error('Debes ingresar el monto de honorarios antes de descargar el PDF'); return } handleDownload() }}
              disabled={saving || aiFilling || downloading}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
              style={missingHonorarios ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              PDF
            </button>
          </div>
        }>
        {isReadOnly && !viewOnly && (
          <div className="flex items-center gap-2 px-5 py-2 text-xs font-semibold"
            style={{ background: '#faf9fd', borderBottom: '1px solid #e6e1f0', color: '#64748b' }}>
            🔒 Este es el original bloqueado. Edita la "Copia editable" para modificar.
          </div>
        )}
        {viewOnly && (
          <style>{`
            .ot-view-only input:not([data-html2canvas-ignore]) { border-bottom-color: transparent !important; pointer-events: none; }
            .ot-view-only input[data-html2canvas-ignore] { display: none !important; }
            .ot-view-only textarea { border-bottom-color: transparent !important; pointer-events: none; resize: none; }
            .ot-view-only select { border-bottom-color: transparent !important; pointer-events: none; appearance: none; -webkit-appearance: none; }
            .ot-view-only .text-blue-700 { color: #111827 !important; }
            .ot-view-only [data-html2canvas-ignore] { display: none !important; }
          `}</style>
        )}
        <div className={viewOnly ? 'ot-view-only' : ''}>
          <SnapPieContext.Provider value={isReadOnly ? null : snapPieToExact}>
            <FullDocument
              otType={selectedType.key}
              otTitle={selectedType.label.toUpperCase()}
              otSubtitle={selectedType.subtitle.toUpperCase()}
              fields={fields}
              onChange={isReadOnly ? () => {} : setField}
              docRef={docRef}
            />
          </SnapPieContext.Provider>
        </div>
      </Shell>
    )
  }

  return null
}

// ── Modal shell ─────────────────────────────────────────────────────────────────

function Shell({ children, onClose, title, headerLeft, headerRight, footer, wide }: {
  children: React.ReactNode; onClose: () => void; title: string
  headerLeft?: React.ReactNode; headerRight?: React.ReactNode; footer?: React.ReactNode; wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}>
      <div className={`relative flex flex-col rounded-2xl overflow-hidden shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        style={{ background: '#ffffff', border: '1px solid rgba(28,22,51,0.12)', maxHeight: '92vh', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
        <div className="flex items-center gap-2 px-3 sm:px-5 py-3 sm:py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(28,22,51,0.08)', background: '#fafafa' }}>
          {headerLeft}
          <h2 className="flex-1 font-bold text-sm truncate" style={{ color: '#1c1633', fontFamily: '"Space Grotesk", sans-serif' }}>{title}</h2>
          {headerRight}
          <button onClick={onClose}
            className="p-1.5 rounded-lg transition-colors ml-1"
            style={{ color: 'rgba(28,22,51,0.40)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#1c1633'; (e.currentTarget as HTMLElement).style.background = 'rgba(28,22,51,0.07)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(28,22,51,0.40)'; (e.currentTarget as HTMLElement).style.background = '' }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer}
      </div>
    </div>
  )
}

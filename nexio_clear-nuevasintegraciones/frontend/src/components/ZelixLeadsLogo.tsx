/**
 * Logo de ZelixLeads.
 *
 * El anterior era el de **Nexio** —el CRM del que salió este código— y seguía
 * puesto en el login, la barra y el copiloto: la marca equivocada en lo primero
 * que ve alguien al entrar. Nexio es otro negocio; compartir logo hace que dos
 * productos distintos parezcan el mismo.
 *
 * ── La idea ──
 * Una **Z de embudo** dentro de una burbuja de conversación. Los tres trazos
 * blancos son a la vez la letra Z de Zelix y las etapas del embudo, que se van
 * angostando hacia abajo: entra mucho arriba, sale poco abajo. La burbuja dice
 * de dónde vienen esos leads —WhatsApp— sin copiar el ícono de nadie.
 *
 * Dibujado con pocas formas y trazos gruesos a propósito: se muestra desde 20 px
 * (la tarjeta del copiloto) hasta 54 px (el login), y un logo con detalle fino
 * se convierte en una mancha verde al achicarlo.
 */
export function ZelixLeadsLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
      role="img"
      aria-label="ZelixLeads"
    >
      <defs>
        <linearGradient id="zlG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--zx-accent-text)" />
          <stop offset="100%" stopColor="var(--zx-lime)" />
        </linearGradient>
      </defs>

      {/* Burbuja de conversación: esquinas muy redondeadas y la colita abajo a
          la izquierda, que es lo que la vuelve un mensaje y no un cuadrado. */}
      <path
        d="M 26,6 H 74 Q 94,6 94,26 V 60 Q 94,80 74,80 H 44 L 22,95 L 26,80 Q 6,79 6,60 V 26 Q 6,6 26,6 Z"
        fill="url(#zlG)"
      />

      {/* Z-embudo: tres etapas que se angostan hacia la salida. */}
      <g stroke="#ffffff" strokeWidth="9" strokeLinecap="round" fill="none">
        <line x1="30" y1="28" x2="70" y2="28" />
        <line x1="66" y1="31" x2="38" y2="55" />
        <line x1="40" y1="58" x2="60" y2="58" />
      </g>
    </svg>
  )
}

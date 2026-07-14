export function NexioLogo({ size = 36 }: { size?: number }) {
  const hex = "M 17,25 Q 22,16 32,16 L 68,16 Q 78,16 83,25 L 92,41 Q 97,50 92,59 L 83,75 Q 78,84 68,84 L 32,84 Q 22,84 17,75 L 8,59 Q 3,50 8,41 Z"

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="nexioG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed"/>
          <stop offset="100%" stopColor="#06b6d4"/>
        </linearGradient>
      </defs>

      <path d={hex} fill="url(#nexioG)"/>

      {/* Lines edge-to-edge */}
      <line x1="43" y1="43" x2="30" y2="30" stroke="white" strokeWidth="7" strokeLinecap="round"/>
      <line x1="57" y1="43" x2="70" y2="30" stroke="white" strokeWidth="7" strokeLinecap="round"/>
      <line x1="43" y1="57" x2="30" y2="70" stroke="white" strokeWidth="7" strokeLinecap="round"/>
      <line x1="57" y1="57" x2="70" y2="70" stroke="white" strokeWidth="7" strokeLinecap="round"/>

      {/* Satellites */}
      <circle cx="24" cy="24" r="10" fill="none" stroke="white" strokeWidth="6"/>
      <circle cx="76" cy="24" r="10" fill="none" stroke="white" strokeWidth="6"/>
      <circle cx="24" cy="76" r="10" fill="none" stroke="white" strokeWidth="6"/>
      <circle cx="76" cy="76" r="10" fill="none" stroke="white" strokeWidth="6"/>

      {/* Hub */}
      <circle cx="50" cy="50" r="14" fill="none" stroke="white" strokeWidth="7"/>
    </svg>
  )
}

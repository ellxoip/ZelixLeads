type Note = { freq: number; start: number; dur: number; gain: number }

function playNotes(notes: Note[]) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const now = ctx.currentTime
    notes.forEach(({ freq, start, dur, gain }) => {
      const osc = ctx.createOscillator()
      const g   = ctx.createGain()
      osc.connect(g)
      g.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + start)
      g.gain.setValueAtTime(0, now + start)
      g.gain.linearRampToValueAtTime(gain, now + start + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, now + start + dur)
      osc.start(now + start)
      osc.stop(now + start + dur + 0.05)
    })
    setTimeout(() => ctx.close(), 1500)
  } catch { /* Web Audio not available */ }
}

// Two-tone chime for incoming WhatsApp message
export function playMessageSound() {
  playNotes([
    { freq: 880,  start: 0,    dur: 0.12, gain: 0.35 },
    { freq: 1100, start: 0.14, dur: 0.15, gain: 0.28 },
  ])
}

// Three-tone ascending chime for new lead
export function playNewLeadSound() {
  playNotes([
    { freq: 600,  start: 0,    dur: 0.14, gain: 0.30 },
    { freq: 800,  start: 0.17, dur: 0.14, gain: 0.28 },
    { freq: 1050, start: 0.34, dur: 0.20, gain: 0.32 },
  ])
}

// Single soft tone for general notification (unread badge increase)
export function playNotificationSound() {
  playNotes([
    { freq: 660,  start: 0,    dur: 0.12, gain: 0.28 },
    { freq: 880,  start: 0.14, dur: 0.18, gain: 0.24 },
  ])
}

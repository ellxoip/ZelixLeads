'use strict'

const express = require('express')
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const QRCode = require('qrcode')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const NodeCache = require('node-cache')

const app = express()
app.use(express.json({ limit: '10mb' }))

const PORT = process.env.QR_SERVICE_PORT || 3001
const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000'
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || `http://localhost:${PORT}`
const SESSIONS_DIR = path.join(__dirname, 'sessions')
const MEDIA_DIR = path.join(__dirname, 'media')

// session map: sessionId -> { sock, status, qr, phone, reconnectTimer, msgStore }
// status: 'connecting' | 'qr_ready' | 'connected' | 'disconnected' | 'logged_out'
const sessions = new Map()

// Serialization helpers for Buffer round-tripping in msgstore.json
const _REPLACER = (_k, v) => {
  if (Buffer.isBuffer(v)) return { __buf__: v.toString('base64') }
  if (typeof v === 'bigint') return v.toString()
  return v
}
const _REVIVER = (_k, v) => {
  if (v && typeof v === 'object' && typeof v.__buf__ === 'string') return Buffer.from(v.__buf__, 'base64')
  return v
}

// Per-session persistent message store (last 5000 msgs per session)
// Persisted to sessions/{sessionId}/msgstore.json so getMessage() works across restarts
// (prevents "Esperando el mensaje" / pending-forever messages on recipient's phone)
function createMsgStore(sessionId) {
  const msgs = new Map()
  const storePath = sessionId
    ? path.join(SESSIONS_DIR, String(sessionId), 'msgstore.json')
    : null
  let saveTimer = null

  if (storePath && fs.existsSync(storePath)) {
    try {
      const arr = JSON.parse(fs.readFileSync(storePath, 'utf8'), _REVIVER)
      for (const { id, msg } of arr) {
        if (id) msgs.set(id, msg)
      }
      console.log(`[QR] Session ${sessionId}: loaded ${msgs.size} msgs from persistent store`)
    } catch (e) {
      console.error(`[QR] Session ${sessionId}: msgstore load error:`, e.message)
    }
  }

  const scheduleSave = () => {
    if (!storePath) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        const arr = Array.from(msgs.entries()).map(([id, msg]) => ({ id, msg }))
        fs.writeFileSync(storePath, JSON.stringify(arr, _REPLACER))
      } catch (e) {
        console.error(`[QR] Session ${sessionId}: msgstore save error:`, e.message)
      }
    }, 3000)
  }

  return {
    set(msg) {
      if (!msg.key?.id) return
      msgs.set(msg.key.id, msg)
      if (msgs.size > 5000) {
        const oldest = msgs.keys().next().value
        msgs.delete(oldest)
      }
      scheduleSave()
    },
    get(id) { return msgs.get(id) },
    values() { return msgs.values() },
    size() { return msgs.size },
  }
}

const logger = pino({ level: 'warn' })

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })
if (!fs.existsSync(MEDIA_DIR))    fs.mkdirSync(MEDIA_DIR,    { recursive: true })

function getSessionPath(sessionId) {
  return path.join(SESSIONS_DIR, String(sessionId))
}

app.use('/media', express.static(MEDIA_DIR))

function sessionExists(sessionId) {
  const p = getSessionPath(sessionId)
  return fs.existsSync(p) && fs.readdirSync(p).length > 0
}

async function notifyFastAPI(path, data) {
  try {
    await axios.post(`${FASTAPI_URL}${path}`, data, { timeout: 5000 })
  } catch (e) {
    console.error(`[QR] Failed to notify FastAPI at ${path}:`, e.message)
  }
}


// Fetch WhatsApp profile picture for a JID and push to CRM (fire-and-forget)
async function pushProfilePic(sock, jid) {
  if (!sock || !jid) return
  try {
    const url = await sock.profilePictureUrl(jid, 'image')
    if (!url) return
    const phone = jid.replace('@s.whatsapp.net', '')
    // Fire async, no await — never block message processing
    notifyFastAPI('/api/webhooks/qr-contact-pic', { phone, avatar_url: url })
  } catch {
    // Contact has no pic or has blocked profile visibility — ignore silently
  }
}

// Returns { mediaUrl, ext } or null if not a media message
async function saveMedia(msg, sock, sessionId) {
  const m = msg.message
  if (!m) return null

  let mediaMsg = null
  let ext = 'bin'

  if (m.imageMessage)    { mediaMsg = m.imageMessage;    ext = 'jpg' }
  else if (m.videoMessage)    { mediaMsg = m.videoMessage;    ext = 'mp4' }
  else if (m.audioMessage)    { mediaMsg = m.audioMessage;    ext = m.audioMessage.ptt ? 'ogg' : 'mp3' }
  else if (m.stickerMessage)  { mediaMsg = m.stickerMessage;  ext = 'webp' }
  else if (m.documentMessage) { mediaMsg = m.documentMessage; ext = (m.documentMessage.fileName || 'file').split('.').pop() || 'bin' }

  if (!mediaMsg) return null

  try {
    const buffer = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    )
    const sessionMediaDir = path.join(MEDIA_DIR, String(sessionId))
    if (!fs.existsSync(sessionMediaDir)) fs.mkdirSync(sessionMediaDir, { recursive: true })
    const filename = `${msg.key.id}.${ext}`
    fs.writeFileSync(path.join(sessionMediaDir, filename), buffer)
    return { mediaUrl: `${MEDIA_BASE_URL}/media/${sessionId}/${filename}`, ext }
  } catch (e) {
    console.error(`[QR] Session ${sessionId}: media download failed:`, e.message)
    return null
  }
}

async function startSession(sessionId) {
  const sessionPath = getSessionPath(sessionId)
  fs.mkdirSync(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const { version } = await fetchLatestBaileysVersion()

  const session = sessions.get(sessionId) || { status: 'connecting', qr: null, phone: null, reconnectTimer: null, chats: [], msgStore: createMsgStore(sessionId), retryCache: new NodeCache() }
  if (!session.msgStore) session.msgStore = createMsgStore(sessionId)
  if (!session.retryCache) session.retryCache = new NodeCache()
  sessions.set(sessionId, session)

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
    markOnlineOnConnect: true,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    msgRetryCounterCache: session.retryCache,
    retryRequestDelayMs: 250,
    defaultQueryTimeoutMs: 60000,
    getMessage: async (key) => {
      const stored = session.msgStore.get(key.id)
      return stored?.message || undefined
    },
  })

  session.sock = sock
  session.status = 'connecting'

  sock.ev.on('creds.update', saveCreds)

  // Debug: log key events (messages.update handled separately for ticks)
  const debugEvents = ['messages.upsert','messages.reaction','presence.update']
  for (const ev of debugEvents) {
    sock.ev.on(ev, (data) => console.log(`[QR] Session ${sessionId}: EVENT ${ev}`, JSON.stringify(data).slice(0,200)))
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      try {
        session.qr = await QRCode.toDataURL(qr)
        session.status = 'qr_ready'
        console.log(`[QR] Session ${sessionId}: QR ready`)
      } catch (e) {
        console.error(`[QR] QR generation error:`, e.message)
      }
    }

    // QR was scanned — no new QR, no open/close yet → show "scanning" state
    if (!qr && !connection && session.status === 'qr_ready') {
      session.status = 'scanning'
      session.qr = null
      console.log(`[QR] Session ${sessionId}: QR scanned, handshaking…`)
    }

    if (connection === 'open') {
      const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
      session.phone = phone
      session.status = 'connected'
      session.qr = null
      session.reconnectAttempts = 0
      console.log(`[QR] Session ${sessionId}: Connected as +${phone}`)
      await notifyFastAPI('/api/webhooks/qr-connected', {
        session_id: String(sessionId),
        phone,
      })
      // Signal availability so WhatsApp starts delivering messages to this linked device
      try { await sock.sendPresenceUpdate('available') } catch {}
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut
      // 440 = Connection Replaced (another web session took over)
      const connectionReplaced = statusCode === 440
      console.log(`[QR] Session ${sessionId}: Disconnected (loggedOut=${loggedOut}, code=${statusCode})`)

      if (loggedOut) {
        session.status = 'logged_out'
        session.qr = null
        session.phone = null
        // Remove credentials so next start generates a new QR
        try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}
        sessions.delete(sessionId)
        await notifyFastAPI('/api/webhooks/qr-disconnected', {
          session_id: String(sessionId),
          reason: 'logged_out',
        })
      } else if (connectionReplaced) {
        // Another session took over this number — back off for 60s before retrying
        // This prevents a fight loop when two sessions share the same phone
        session.status = 'disconnected'
        session.qr = null
        session.reconnectAttempts = (session.reconnectAttempts || 0) + 1
        const backoff = Math.min(60000 * session.reconnectAttempts, 300000) // 60s, 120s, 180s… max 5min
        console.log(`[QR] Session ${sessionId}: Connection replaced — backing off ${backoff / 1000}s`)
        if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
        session.reconnectTimer = setTimeout(async () => {
          if (sessions.has(sessionId)) {
            console.log(`[QR] Session ${sessionId}: Reconnecting after backoff...`)
            await startSession(sessionId)
          }
        }, backoff)
      } else {
        session.status = 'disconnected'
        session.qr = null
        session.reconnectAttempts = 0
        // Auto-reconnect after 5 seconds for normal disconnections
        if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
        session.reconnectTimer = setTimeout(async () => {
          if (sessions.has(sessionId)) {
            console.log(`[QR] Session ${sessionId}: Reconnecting...`)
            await startSession(sessionId)
          }
        }, 5000)
      }
    }
  })

  function _pushContactsToCRM(contacts) {
    const direct = contacts
      .filter(c => c.id && c.id.endsWith('@s.whatsapp.net'))
      .map(c => {
        const phone = c.id.replace('@s.whatsapp.net', '')
        const name = c.name || c.notify || c.verifiedName || null
        return { phone, name }
      })
      .filter(c => /^\d{7,}$/.test(c.phone))

    if (direct.length === 0) return

    // Cache in session (deduplicate)
    const existing = new Set((session.chats || []).map(c => c.phone))
    for (const c of direct) {
      if (!existing.has(c.phone)) {
        session.chats = session.chats || []
        session.chats.push(c)
        existing.add(c.phone)
      }
    }

    console.log(`[QR] Session ${sessionId}: pushing ${direct.length} contacts to CRM`)
    notifyFastAPI('/api/webhooks/qr-chats', {
      session_id: String(sessionId),
      chats: direct,
    }).catch(() => {})
  }

  sock.ev.on('chats.upsert', (chats) => {
    _pushContactsToCRM(chats.map(c => ({ id: c.id, name: c.name })))
  })

  sock.ev.on('contacts.upsert', (contacts) => {
    _pushContactsToCRM(contacts)
  })

  sock.ev.on('contacts.update', (updates) => {
    _pushContactsToCRM(updates)
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Cache ALL messages (incoming and outgoing) for getMessage() retries
    for (const msg of messages) {
      if (msg.key?.id && msg.message) session.msgStore.set(msg)
    }
    console.log(`[QR] Session ${sessionId}: messages.upsert type=${type} count=${messages.length}`)

    // Extract any @s.whatsapp.net JIDs and push them as known contacts to the CRM
    const jidContacts = messages
      .filter(m => m.key.remoteJid?.endsWith('@s.whatsapp.net'))
      .map(m => ({ id: m.key.remoteJid, name: m.pushName || null }))
    if (jidContacts.length > 0) _pushContactsToCRM(jidContacts)

    // 'notify' = real-time new message; 'append' = missed messages delivered after reconnection
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages) {
      // Skip groups, broadcast, newsletter — but allow @s.whatsapp.net AND @lid (newer WA format)
      if (!msg.key.remoteJid) continue
      if (msg.key.remoteJid.endsWith('@g.us')) continue
      if (msg.key.remoteJid.endsWith('@broadcast')) continue
      if (msg.key.remoteJid.endsWith('@newsletter')) continue

      // For our own outgoing messages (fromMe=true):
      //   - If the message is already in msgStore it was sent via this QR service (already saved by backend) → skip
      //   - Otherwise it was typed on the physical phone and the backend doesn't know about it → push it
      if (msg.key.fromMe) {
        const alreadySentByCRM = session.msgStore.get(msg.key.id)
        if (alreadySentByCRM) continue
        // Message sent from physical phone — push to backend as outgoing
        const remoteJid = msg.key.remoteJid
        const to = remoteJid.endsWith('@s.whatsapp.net')
          ? remoteJid.replace('@s.whatsapp.net', '')
          : null
        if (!to) continue
        const content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          msg.message?.documentMessage?.fileName ||
          ''
        const msgType = msg.message?.conversation || msg.message?.extendedTextMessage
          ? 'text'
          : msg.message?.imageMessage    ? 'image'
          : msg.message?.audioMessage    ? 'audio'
          : msg.message?.videoMessage    ? 'video'
          : msg.message?.stickerMessage  ? 'sticker'
          : msg.message?.documentMessage ? 'document'
          : 'text'
        console.log(`[QR] Session ${sessionId}: outgoing-from-phone to=${to} type=${msgType} id=${msg.key.id}`)
        notifyFastAPI('/api/webhooks/qr-incoming', {
          session_id: String(sessionId),
          from_phone: to,
          content: content || '',
          message_type: msgType,
          media_url: null,
          message_id: msg.key.id,
          timestamp: msg.messageTimestamp,
          is_from_me: true,
        }).then(() => {
          if (msgType !== 'text') {
            saveMedia(msg, sock, sessionId).then(saved => {
              if (saved) {
                notifyFastAPI('/api/webhooks/qr-update-media', {
                  session_id: String(sessionId),
                  message_id: msg.key.id,
                  media_url: saved.mediaUrl,
                }).catch(() => {})
              }
            }).catch(() => {})
          }
        }).catch(() => {})
        continue
      }

      // @lid JIDs carry the real phone in senderPn; @s.whatsapp.net carry it in remoteJid
      let from
      if (msg.key.remoteJid.endsWith('@lid')) {
        // senderPn looks like "56990699607@s.whatsapp.net"
        const senderPn = msg.key.senderPn || ''
        from = senderPn.replace('@s.whatsapp.net', '')
        if (!from) continue  // no phone info, skip
      } else {
        from = msg.key.remoteJid.replace('@s.whatsapp.net', '')
      }
      const content =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.fileName ||
        ''
      const msgType = msg.message?.conversation || msg.message?.extendedTextMessage
        ? 'text'
        : msg.message?.imageMessage    ? 'image'
        : msg.message?.audioMessage    ? 'audio'
        : msg.message?.videoMessage    ? 'video'
        : msg.message?.stickerMessage  ? 'sticker'
        : msg.message?.documentMessage ? 'document'
        : 'text'

      console.log(`[QR] Session ${sessionId}: incoming from=${from} type=${msgType} id=${msg.key.id}`)
      // Notify backend immediately so the message appears in the UI right away.
      // For media messages, we send media_url=null now and update it after download completes.
      notifyFastAPI('/api/webhooks/qr-incoming', {
        session_id: String(sessionId),
        from_phone: from,
        content: content || '',
        message_type: msgType,
        media_url: null,
        message_id: msg.key.id,
        timestamp: msg.messageTimestamp,
      }).then(() => {
        // After backend confirmed the message, download media and update URL
        if (msgType !== 'text') {
          saveMedia(msg, sock, sessionId).then(saved => {
            if (saved) {
              notifyFastAPI('/api/webhooks/qr-update-media', {
                session_id: String(sessionId),
                message_id: msg.key.id,
                media_url: saved.mediaUrl,
              }).catch(() => {})
            }
          }).catch(e => console.error(`[QR] Session ${sessionId}: media download failed:`, e.message))
        }
      }).catch(() => {})
      // Fetch and push profile picture async (non-blocking)
      pushProfilePic(sock, msg.key.remoteJid)
    }
  })

  // Incoming WhatsApp calls — notify backend so cobrador sees alert in browser
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      const from = (call.from || '').replace('@s.whatsapp.net', '').replace('@lid', '')
      console.log(`[QR] Session ${sessionId}: call event status=${call.status} from=${from} id=${call.id}`)
      if (call.status === 'offer') {
        notifyFastAPI('/api/webhooks/qr-incoming-call', {
          session_id: String(sessionId),
          from_phone: from,
          call_id: call.id,
          is_video: call.isVideo || false,
        }).catch(() => {})
      }
      if (call.status === 'timeout' || call.status === 'reject' || call.status === 'accept') {
        notifyFastAPI('/api/webhooks/qr-call-ended', {
          session_id: String(sessionId),
          call_id: call.id,
          status: call.status,
        }).catch(() => {})
      }
    }
  })

  // Update message status via message-receipt.update (Baileys receipt object has
  // receiptTimestamp/readTimestamp fields, NOT a .type integer)
  sock.ev.on('message-receipt.update', async (updates) => {
    console.log(`[QR] Session ${sessionId}: message-receipt.update`, JSON.stringify(updates).slice(0, 300))
    for (const { key, receipt } of updates) {
      if (!key.id || !key.fromMe) continue
      let status = null
      if (receipt.readTimestamp || receipt.playedTimestamp) {
        status = 'read'
      } else if (receipt.receiptTimestamp) {
        status = 'delivered'
      }
      if (!status) continue
      console.log(`[QR] Session ${sessionId}: status update via receipt — id=${key.id} status=${status}`)
      await notifyFastAPI('/api/webhooks/qr-status-update', {
        session_id: String(sessionId),
        message_id: key.id,
        status,
      })
    }
  })

  // Also update via messages.update (WAMessageStatus: 4=DELIVERY_ACK, 5=READ, 6=PLAYED)
  sock.ev.on('messages.update', async (updates) => {
    console.log(`[QR] Session ${sessionId}: messages.update`, JSON.stringify(updates).slice(0, 300))
    for (const { key, update } of updates) {
      if (!key.id || !key.fromMe) continue
      if (!update.status) continue
      const statusMap = { 2: 'sent', 3: 'delivered', 4: 'delivered', 5: 'read', 6: 'read' }
      const status = statusMap[update.status]
      if (!status) continue
      console.log(`[QR] Session ${sessionId}: status update via messages.update — id=${key.id} raw=${update.status} status=${status}`)
      await notifyFastAPI('/api/webhooks/qr-status-update', {
        session_id: String(sessionId),
        message_id: key.id,
        status,
      })
    }
  })

  sock.ev.on('messaging-history.set', async ({ messages }) => {
    if (!messages || messages.length === 0) return
    const SIX_MONTHS_AGO_S = Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 3600
    const toImport = []
    // Also collect unique contacts to push to CRM regardless of message content
    const historyContacts = []
    for (const msg of messages) {
      if (!msg.key?.remoteJid) continue
      if (msg.key.remoteJid.endsWith('@g.us')) continue
      if (msg.key.remoteJid.endsWith('@broadcast')) continue
      if (msg.key.remoteJid.endsWith('@newsletter')) continue
      if (!msg.key.remoteJid.endsWith('@s.whatsapp.net')) continue

      const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '')
      if (!/^\d{7,}$/.test(phone)) continue

      // messageTimestamp can be a Long (protobuf) or a plain number
      const ts = msg.messageTimestamp
      const timestamp = ts && typeof ts === 'object' && ts.low !== undefined
        ? ts.low + ts.high * 4294967296
        : Number(ts) || null

      // Skip messages older than 6 months
      if (timestamp && timestamp < SIX_MONTHS_AGO_S) continue

      // Cache in msgStore for delivery retry/confirmation
      if (msg.key?.id && msg.message) session.msgStore.set(msg)

      historyContacts.push({ phone, name: msg.pushName || null })

      let from = phone
      const isFromMe = !!msg.key.fromMe
      const content =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.fileName ||
        null
      if (!content) continue

      const msgType = msg.message?.conversation || msg.message?.extendedTextMessage
        ? 'text'
        : msg.message?.imageMessage ? 'image'
        : msg.message?.audioMessage ? 'audio'
        : msg.message?.videoMessage ? 'video'
        : msg.message?.documentMessage ? 'document'
        : null
      if (!msgType) continue

      toImport.push({
        from_phone: from,
        is_from_me: isFromMe,
        content,
        message_type: msgType,
        message_id: msg.key.id,
        timestamp,
      })
    }

    if (toImport.length > 0) {
      console.log(`[QR] Session ${sessionId}: Importing ${toImport.length} historical messages`)
      await notifyFastAPI('/api/webhooks/qr-history', {
        session_id: String(sessionId),
        messages: toImport,
      })
    }

    // Always push all contacts seen in history, even those with no text messages
    if (historyContacts.length > 0) {
      _pushContactsToCRM(historyContacts.map(c => ({ id: c.phone + '@s.whatsapp.net', name: c.name })))
    }
  })
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Start or restart a session (creates QR)
app.post('/sessions/:sessionId/start', async (req, res) => {
  const { sessionId } = req.params
  const existing = sessions.get(sessionId)

  // If already connected, return status
  if (existing?.status === 'connected') {
    return res.json({ status: 'connected', phone: existing.phone })
  }

  // If already trying to connect, return current state
  if (existing?.status === 'qr_ready') {
    return res.json({ status: 'qr_ready' })
  }

  try {
    await startSession(sessionId)
    res.json({ status: 'connecting' })
  } catch (e) {
    console.error(`[QR] Start session error:`, e)
    res.status(500).json({ error: e.message })
  }
})

// Get QR image (data URL)
app.get('/sessions/:sessionId/qr', (req, res) => {
  const { sessionId } = req.params
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (!session.qr) return res.status(202).json({ status: session.status, message: 'QR not ready yet' })
  res.json({ qr: session.qr, status: session.status })
})

// Get session status
app.get('/sessions/:sessionId/status', (req, res) => {
  const { sessionId } = req.params
  const session = sessions.get(sessionId)
  if (!session) {
    const exists = sessionExists(sessionId)
    return res.json({ status: exists ? 'disconnected' : 'not_started', phone: null })
  }
  res.json({ status: session.status, phone: session.phone || null })
})

// Send text message
app.post('/sessions/:sessionId/send', async (req, res) => {
  const { sessionId } = req.params
  const { to, message } = req.body
  const session = sessions.get(sessionId)

  if (!session || session.status !== 'connected') {
    return res.status(400).json({ error: 'Session not connected' })
  }
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing to or message' })
  }

  try {
    const jid = to.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
    const result = await session.sock.sendMessage(jid, { text: message })
    console.log('[QR] Send result:', JSON.stringify(result, null, 2))
    // Store the exact proto message Baileys sent so getMessage() can serve retries correctly
    if (result?.key?.id) {
      session.msgStore.set(result)
    }
    res.json({ status: 'sent', message_id: result?.key?.id || null })
  } catch (e) {
    console.error(`[QR] Send error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

// Send media (image/video/audio/document) — body: { to, mimeType, base64, filename, caption }
app.post('/sessions/:sessionId/send-file', async (req, res) => {
  const { sessionId } = req.params
  const { to, mimeType, base64, filename, caption } = req.body
  const session = sessions.get(sessionId)

  if (!session || session.status !== 'connected') {
    return res.status(400).json({ error: 'Session not connected' })
  }
  if (!to || !mimeType || !base64) {
    return res.status(400).json({ error: 'Missing to, mimeType or base64' })
  }

  try {
    const jid = to.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
    const buffer = Buffer.from(base64, 'base64')

    let msgPayload
    if (mimeType.startsWith('image/')) {
      msgPayload = { image: buffer, caption: caption || '' }
    } else if (mimeType.startsWith('video/')) {
      msgPayload = { video: buffer, caption: caption || '' }
    } else if (mimeType.startsWith('audio/')) {
      msgPayload = { audio: buffer, ptt: mimeType.includes('ogg') || mimeType.includes('opus') }
    } else {
      msgPayload = { document: buffer, mimetype: mimeType, fileName: filename || 'archivo', caption: caption || '' }
    }

    const result = await session.sock.sendMessage(jid, msgPayload)
    if (result?.key?.id) session.msgStore.set(result)
    res.json({ status: 'sent', message_id: result?.key?.id || null })
  } catch (e) {
    console.error(`[QR] Send-file error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

// Mark messages as read — sends blue ticks to the sender
// body: { to: "56912345678", message_ids: ["id1","id2",...] }
app.post('/sessions/:sessionId/mark-read', async (req, res) => {
  const { sessionId } = req.params
  const { to, message_ids } = req.body
  const session = sessions.get(sessionId)
  if (!session?.sock || session.status !== 'connected') {
    return res.status(400).json({ error: 'Session not connected' })
  }
  if (!to || !Array.isArray(message_ids) || message_ids.length === 0) {
    return res.status(400).json({ error: 'Missing to or message_ids' })
  }
  try {
    const jid = to.replace(/[^0-9]/g, '') + '@s.whatsapp.net'
    // Build keys array for readMessages
    const keys = message_ids.map(id => ({
      remoteJid: jid,
      id,
      fromMe: false,
    }))
    await session.sock.readMessages(keys)
    console.log(`[QR] Session ${sessionId}: marked ${keys.length} messages as read for ${to}`)
    res.json({ ok: true })
  } catch (e) {
    console.error(`[QR] mark-read error:`, e.message)
    res.status(500).json({ error: e.message })
  }
})

// Disconnect and remove session
app.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  const session = sessions.get(sessionId)

  if (session) {
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
    if (session.sock) {
      try { await session.sock.logout() } catch {}
      try { session.sock.end() } catch {}
    }
    sessions.delete(sessionId)
  }

  const sessionPath = getSessionPath(sessionId)
  try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}

  res.json({ ok: true })
})

// Return cached chat list
app.get('/sessions/:sessionId/chats', (req, res) => {
  const session = sessions.get(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json({ chats: session.chats || [] })
})

// Push all cached chats to the CRM again (manual sync trigger)
app.post('/sessions/:sessionId/sync-chats', async (req, res) => {
  const { sessionId } = req.params
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const chats = session.chats || []
  if (chats.length > 0) {
    await notifyFastAPI('/api/webhooks/qr-chats', { session_id: String(sessionId), chats })
  }
  res.json({ ok: true, pushed: chats.length })
})

// Re-import all messages from in-memory msgStore into the CRM (full 6-month history sync)
app.post('/sessions/:sessionId/sync-msgstore', async (req, res) => {
  const { sessionId } = req.params
  const session = sessions.get(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const SIX_MONTHS_AGO_S = Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 3600
  const toImport = []

  for (const msg of session.msgStore.values()) {
    if (!msg.key?.remoteJid) continue
    if (msg.key.remoteJid.endsWith('@g.us')) continue
    if (msg.key.remoteJid.endsWith('@broadcast')) continue
    if (!msg.key.remoteJid.endsWith('@s.whatsapp.net')) continue

    const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '')
    if (!/^\d{7,}$/.test(phone)) continue

    const ts = msg.messageTimestamp
    const timestamp = ts && typeof ts === 'object' && ts.low !== undefined
      ? ts.low + ts.high * 4294967296
      : Number(ts) || null

    if (timestamp && timestamp < SIX_MONTHS_AGO_S) continue

    const isFromMe = !!msg.key.fromMe
    const content =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.fileName ||
      null

    if (!content) continue

    const msgType = msg.message?.conversation || msg.message?.extendedTextMessage
      ? 'text'
      : msg.message?.imageMessage ? 'image'
      : msg.message?.audioMessage ? 'audio'
      : msg.message?.videoMessage ? 'video'
      : msg.message?.documentMessage ? 'document'
      : null

    if (!msgType) continue

    toImport.push({
      from_phone: phone,
      is_from_me: isFromMe,
      content,
      message_type: msgType,
      message_id: msg.key.id,
      timestamp,
    })
  }

  if (toImport.length > 0) {
    // Split into batches of 500 to avoid timeouts
    const BATCH = 500
    for (let i = 0; i < toImport.length; i += BATCH) {
      await notifyFastAPI('/api/webhooks/qr-history', {
        session_id: String(sessionId),
        messages: toImport.slice(i, i + BATCH),
      })
    }
  }

  // Fetch profile pictures for all unique contacts found (fire-and-forget, staggered)
  const uniquePhones = [...new Set(toImport.map(m => m.from_phone))]
  for (let i = 0; i < uniquePhones.length; i++) {
    const phone = uniquePhones[i]
    const jid = phone + '@s.whatsapp.net'
    // Stagger requests 300ms apart to avoid WA rate-limiting
    setTimeout(() => pushProfilePic(session.sock, jid), i * 300)
  }

  console.log(`[QR] Session ${sessionId}: sync-msgstore pushed ${toImport.length} messages, fetching pics for ${uniquePhones.length} contacts`)
  res.json({ ok: true, pushed: toImport.length })
})

// Reject an incoming call
app.post('/sessions/:sessionId/reject-call', async (req, res) => {
  const { sessionId } = req.params
  const { callId, from } = req.body
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'connected') return res.status(404).json({ error: 'not connected' })
  try {
    await session.sock.rejectCall(callId, from + '@s.whatsapp.net')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Send typing presence to a contact (composing / paused)
app.post('/sessions/:sessionId/presence', async (req, res) => {
  const { sessionId } = req.params
  const { jid, type } = req.body  // type: 'composing' | 'paused'
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'connected') return res.status(404).json({ error: 'Session not connected' })
  try {
    await session.sock.sendPresenceUpdate(type || 'composing', jid)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Health check
app.get('/health', (_, res) => res.json({ ok: true, sessions: sessions.size }))

// ── Startup ──────────────────────────────────────────────────────────────────

async function restorePersistedSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return
  let dirs
  try { dirs = fs.readdirSync(SESSIONS_DIR) } catch { return }

  for (const dir of dirs) {
    const p = path.join(SESSIONS_DIR, dir)
    if (!fs.statSync(p).isDirectory()) continue
    if (fs.readdirSync(p).length === 0) continue
    console.log(`[QR] Restoring session: ${dir}`)
    sessions.set(dir, { status: 'connecting', qr: null, phone: null, reconnectTimer: null, chats: [] })
    try {
      await startSession(dir)
    } catch (e) {
      console.error(`[QR] Failed to restore ${dir}:`, e.message)
      sessions.delete(dir)
    }
  }
}

app.listen(PORT, async () => {
  console.log(`[QR] WhatsApp QR Service running on port ${PORT}`)
  console.log(`[QR] FastAPI URL: ${FASTAPI_URL}`)
  await restorePersistedSessions()
})

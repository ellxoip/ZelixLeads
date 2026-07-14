#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LF_DIR="/home/re00vs/Descargas/legal-finance-mvp-main"

MODE="${1:-prod}"   # uso: ./start.sh prod | ./start.sh dev

echo "========================================"
echo " CRM Abogados Tributarios — modo: $MODE"
echo "========================================"

# ── CRM Frontend (build) ──────────────────────────────────────────────────
echo ""
echo "[1/4] Preparando CRM Frontend..."
cd "$DIR/frontend"

if [ ! -d node_modules ] || [ ! -d node_modules/recharts ]; then
  echo "  Instalando dependencias..."
  npm install --legacy-peer-deps --silent
fi

if [ "$MODE" = "prod" ]; then
  echo "  Compilando build de producción..."
  npm run build
  echo "  Build listo en frontend/dist — será servido por FastAPI en :8000"
else
  npm run dev -- --port 5173 --host &
  FRONTEND_PID=$!
  echo "  Dev server PID: $FRONTEND_PID  →  http://localhost:5173"
fi

# ── CRM Backend ──────────────────────────────────────────────────────────
echo ""
echo "[2/4] Iniciando CRM Backend (FastAPI)..."
cd "$DIR/backend"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "  AVISO: .env creado desde .env.example — revisa SECRET_KEY y OPENAI_API_KEY."
fi

if [ ! -f venv/bin/uvicorn ]; then
  echo "  Creando entorno virtual e instalando dependencias..."
  rm -rf venv
  python3 -m venv venv
  ./venv/bin/pip install --upgrade pip --quiet
  ./venv/bin/pip install -r requirements.txt --quiet
fi

# Número de workers: 2× CPUs (mínimo 2, máximo 8)
CPUS=$(nproc 2>/dev/null || echo 2)
WORKERS=$(( CPUS * 2 ))
[ "$WORKERS" -lt 2 ] && WORKERS=2
[ "$WORKERS" -gt 8 ] && WORKERS=8

fuser -k 8000/tcp 2>/dev/null || true

if [ "$MODE" = "prod" ]; then
  echo "  Modo PRODUCCIÓN — $WORKERS workers, sin --reload"
  echo "  CRM accesible en  →  http://localhost:8000"
  ./venv/bin/uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers "$WORKERS" \
    --loop uvloop \
    --http httptools \
    --access-log \
    --log-level warning &
else
  echo "  Modo DESARROLLO — 1 worker, con --reload"
  ./venv/bin/uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --reload \
    --log-level info &
fi

BACKEND_PID=$!
echo "  CRM Backend PID: $BACKEND_PID"

# ── WhatsApp QR Service ───────────────────────────────────────────────────
echo ""
echo "[3/4] Iniciando WhatsApp QR Service (Node.js)..."
cd "$DIR/whatsapp-qr-service"

if [ ! -d node_modules ]; then
  npm install --legacy-peer-deps --silent
fi

QR_STATUS=$(curl -s --max-time 2 http://localhost:3005/sessions/2/status 2>/dev/null | grep -o '"status":"connected"' || true)
if [ -n "$QR_STATUS" ]; then
  QR_PID=$(pgrep -f "whatsapp-qr-service/server.js" | head -1 || pgrep -f "node server.js" | head -1 || echo "")
  echo "  WhatsApp QR ya conectado — NO se reinicia (protege sesión WA)"
  echo "  WhatsApp QR PID: ${QR_PID:-?}  →  http://localhost:3005"
else
  fuser -k 3005/tcp 2>/dev/null || true
  QR_SERVICE_PORT=3005 \
  FASTAPI_URL=http://localhost:8000 \
  MEDIA_BASE_URL=http://localhost:3005 \
  node server.js &
  QR_PID=$!
  echo "  WhatsApp QR PID: $QR_PID  →  http://localhost:3005"
fi

# ── Legal Finance ─────────────────────────────────────────────────────────
echo ""
echo "[4/4] Iniciando Legal Finance MVP (Next.js, puerto 4000)..."
if [ -d "$LF_DIR" ]; then
  cd "$LF_DIR"
  if [ ! -d node_modules ]; then npm install --silent; fi
  if [ "$MODE" = "prod" ] && [ -f ".next/BUILD_ID" ]; then
    npm run start -- -p 4000 &
  else
    npm run dev -- -p 4000 &
  fi
  LF_PID=$!
  echo "  Legal Finance PID: $LF_PID  →  http://localhost:4000"
else
  echo "  AVISO: Directorio Legal Finance no encontrado en $LF_DIR"
  LF_PID=""
fi

echo ""
echo "========================================"
if [ "$MODE" = "prod" ]; then
  echo " PRODUCCIÓN ACTIVA"
  echo ""
  echo "  CRM (app + API) →  http://localhost:8000"
  echo "  WhatsApp QR     →  http://localhost:3005"
  echo "  Legal Finance   →  http://localhost:4000"
  echo "  API docs        →  http://localhost:8000/docs"
else
  echo " DESARROLLO ACTIVO"
  echo ""
  echo "  CRM Frontend    →  http://localhost:5173"
  echo "  CRM API         →  http://localhost:8000/docs"
  echo "  WhatsApp QR     →  http://localhost:3005"
  echo "  Legal Finance   →  http://localhost:4000"
fi
echo ""
echo "  Para detener: kill $BACKEND_PID $QR_PID ${FRONTEND_PID:-} ${LF_PID:-}"
echo "========================================"
echo ""

wait

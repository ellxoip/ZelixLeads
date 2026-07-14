# CRM Abogados Tributarios

## Inicio rápido

```bash
# Opción 1: Script todo-en-uno
bash /home/re00vs/crm/start.sh

# Opción 2: Manual
# Terminal 1 — Backend
cd /home/re00vs/crm/backend
./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Frontend
cd /home/re00vs/crm/frontend
npm run dev
```

## URLs
- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000
- **API Docs:** http://localhost:8000/docs

## Credenciales
| Usuario | Email | Contraseña | Rol |
|---------|-------|-----------|-----|
| Jorge Castillo | jorge@abogadostributarios.cl | Admin2024! | SuperAdmin |
| Nicolás Jiménez | nicolas@abogadostributarios.cl | Sub2024! | SubAdmin |
| Dante Seura | dante@abogadostributarios.cl | Pass2024! | Verificador Pagos |
| Jonathan | jonathan@abogadostributarios.cl | Pass2024! | Vendedor G1 |
| Marcela | marcela@abogadostributarios.cl | Pass2024! | Agendadora G1 |
| Aizel | aizel@abogadostributarios.cl | Pass2024! | Agendadora G2 |

## Flujo de Pipeline

```
Lead → Reunión → Cierre → Pagado (notifica a Dante)
  ↓        ↓        ↓
 Rec.     Rec.     Rec.    (si no exitoso → Recuperación)

Dante confirma pago → Pagado Confirmado
  → Notifica a Agendadora + Cliente (WhatsApp)
```

## Migración a PostgreSQL

Cambiar en `backend/.env`:
```
DATABASE_URL=postgresql://usuario:password@localhost/crm_abogados
```

Y reemplazar SQLite connect_args en `database.py`.

## Deploy

El **frontend** (app React/Vite) se construye y sirve como estático:

- Build command: `npm run build`
- Output directory: `frontend/dist`
- Variable de entorno: `VITE_API_BASE_URL=https://tu-backend-publico.com`

El backend FastAPI y el servicio `whatsapp-qr-service` necesitan un host con procesos persistentes
(VPS, Render, Railway, Fly.io, DigitalOcean, etc.). El frontend llamará al backend configurado en
`VITE_API_BASE_URL`.

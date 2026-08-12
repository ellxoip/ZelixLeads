"""
LADRILLO 2 — agendar reuniones desde WhatsApp.

Zelix atiende la conversación; el calendario y la asignación de vendedores viven
acá. Este router es la puerta entre ambos: Zelix pregunta cuándo hay hueco y
reserva, sin conocer las reglas de disponibilidad. Si esas reglas viven en dos
lados, tarde o temprano discrepan y alguien llega a una reunión que no existe.

── Por qué no se reusa `/calendar/slots` ──
Aquél devuelve los bloques OCUPADOS y exige sesión de usuario del CRM. Zelix no
es un usuario: es otro sistema. Calcular los huecos libres restando ocupados en
el lado de Zelix habría puesto el horario comercial y la duración de la reunión
en un segundo lugar — el patrón que ya costó caro dos veces (decisiones 49 y 60).
Acá se devuelve directamente lo que se le puede ofrecer a una persona.

── Autenticación ──
El mismo secreto compartido del puente (`x-crm-callback-secret`). Un token de
usuario habría obligado a guardar la contraseña de alguien dentro de Zelix.
"""
import os
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..security import log_event

router = APIRouter(prefix="/api/agenda-wa", tags=["agenda-whatsapp"])

TZ = ZoneInfo("America/Santiago")
SECRETO = os.getenv("ZELIX_CRM_SECRET", "")

# Horario en que se ofrece reunión, hora de Chile. Fuera de esto no se propone
# nada: agendar a las 3 de la mañana es peor que no tener hueco.
HORA_DESDE = 9
HORA_HASTA = 18
DURACION_MIN = 60
# Cuánto antes debe estar la reunión para poder ofrecerla. Sin este margen se
# ofrecería un bloque que empieza en dos minutos.
ANTICIPACION_MIN = 60


def _exige_secreto(x_crm_callback_secret: str = Header(None, alias="x-crm-callback-secret")):
    if not SECRETO:
        raise HTTPException(status_code=404, detail="No disponible")
    if not x_crm_callback_secret or not _secrets.compare_digest(x_crm_callback_secret, SECRETO):
        raise HTTPException(status_code=401, detail="Secret inválido")


def _normalizar_tel(tel: str) -> str:
    return "+" + "".join(c for c in (tel or "") if c.isdigit())


def _lead_o_404(db: Session, lead_id: int | None = None, telefono: str | None = None) -> models.Lead:
    """Ubica el lead por id o por TELÉFONO.

    Zelix conoce el número de WhatsApp de quien escribe, no los ids del CRM.
    Obligarlo a manejar ids habría significado guardar acá una tabla de
    equivalencias o allá un dato que no le pertenece; el teléfono ya es la
    identidad compartida entre ambos sistemas.
    """
    if lead_id:
        lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    elif telefono:
        contacto = db.query(models.Contact).filter(models.Contact.phone == _normalizar_tel(telefono)).first()
        lead = (
            db.query(models.Lead)
            .filter(models.Lead.contact_id == contacto.id,
                    models.Lead.current_stage.notin_(["pagado_confirmado"]))
            .order_by(models.Lead.created_at.desc())
            .first()
            if contacto else None
        )
    else:
        raise HTTPException(status_code=400, detail="Falta lead_id o telefono")
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return lead


def _utc(dt: datetime) -> datetime:
    """Fecha SIEMPRE con zona. Postgres devuelve estas columnas con `tzinfo` y
    SQLite —el motor de las pruebas— sin él; comparar una con otra revienta.
    Se asume UTC en el caso desnudo, que es como se guardan."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ocupados(db: Session, user_id: int, desde_utc: datetime, hasta_utc: datetime):
    return db.query(models.CalendarEvent).filter(
        or_(models.CalendarEvent.assigned_to == user_id, models.CalendarEvent.created_by == user_id),
        models.CalendarEvent.start_time < hasta_utc,
        models.CalendarEvent.end_time > desde_utc,
    ).all()


@router.get("/disponibilidad", dependencies=[Depends(_exige_secreto)])
def disponibilidad(lead_id: int | None = None, telefono: str | None = None, dias: int = 3, limite: int = 3, db: Session = Depends(get_db)):
    """Huecos que se le pueden OFRECER a este lead, ya listos para mostrar.

    `limite` nace de WhatsApp: sus mensajes interactivos admiten como máximo
    **tres botones**. Ofrecer más obliga a paginar y a que la persona elija dos
    veces, que es donde se pierden las reuniones.
    """
    lead = _lead_o_404(db, lead_id, telefono)
    vendedor_id = lead.vendedor_id
    ahora = datetime.now(timezone.utc)
    minimo = ahora + timedelta(minutes=ANTICIPACION_MIN)

    dias = max(1, min(14, dias))
    limite = max(1, min(3, limite))

    hoy_local = ahora.astimezone(TZ).date()
    fin_utc = (datetime.combine(hoy_local + timedelta(days=dias), datetime.min.time(), TZ)).astimezone(timezone.utc)
    ocupados = _ocupados(db, vendedor_id, ahora, fin_utc)

    libres = []
    for d in range(dias + 1):
        dia = hoy_local + timedelta(days=d)
        if dia.weekday() >= 5:  # sábado y domingo no se ofrecen
            continue
        for hora in range(HORA_DESDE, HORA_HASTA):
            inicio = datetime(dia.year, dia.month, dia.day, hora, 0, tzinfo=TZ).astimezone(timezone.utc)
            fin = inicio + timedelta(minutes=DURACION_MIN)
            if inicio < minimo:
                continue
            if any(_utc(o.start_time) < fin and _utc(o.end_time) > inicio for o in ocupados):
                continue
            local = inicio.astimezone(TZ)
            libres.append({
                "inicio": inicio.isoformat(),
                "etiqueta": _etiqueta(local, hoy_local),
                "fecha": local.strftime("%Y-%m-%d"),
                "hora": local.strftime("%H:%M"),
            })
            if len(libres) >= limite:
                return {"vendedor_id": vendedor_id, "slots": libres}
    return {"vendedor_id": vendedor_id, "slots": libres}


_DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def _etiqueta(local: datetime, hoy) -> str:
    """Texto del botón. WhatsApp corta en 20 caracteres, así que se hace corto acá
    y no se confía en que alguien lo recorte después."""
    if local.date() == hoy:
        return f"Hoy {local.strftime('%H:%M')}"
    if local.date() == hoy + timedelta(days=1):
        return f"Mañana {local.strftime('%H:%M')}"
    return f"{_DIAS[local.weekday()]} {local.day} · {local.strftime('%H:%M')}"[:20]


@router.post("/reservar", dependencies=[Depends(_exige_secreto)])
def reservar(payload: dict, db: Session = Depends(get_db)):
    """Toma un hueco. Rechaza si alguien se le adelantó.

    La comprobación de choque y el insert van en la MISMA transacción, con la
    fila del vendedor bloqueada: dos personas eligiendo el mismo bloque a la vez
    es el caso normal cuando se ofrecen tres opciones a varios leads, y "leer,
    decidir, escribir" deja pasar a las dos. Descubrirlo el día de la reunión lo
    paga el vendedor con su tiempo y el cliente con su confianza.
    """
    lead_id = payload.get("lead_id")
    telefono = payload.get("telefono")
    inicio_raw = payload.get("inicio")
    if not (lead_id or telefono) or not inicio_raw:
        raise HTTPException(status_code=400, detail="Faltan lead_id/telefono e inicio")
    try:
        inicio = datetime.fromisoformat(str(inicio_raw))
    except ValueError:
        raise HTTPException(status_code=400, detail="inicio debe ser una fecha ISO")
    if inicio.tzinfo is None:
        inicio = inicio.replace(tzinfo=timezone.utc)
    inicio = inicio.astimezone(timezone.utc)

    lead = _lead_o_404(db, lead_id, telefono)
    if inicio < datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Ese horario ya pasó")
    fin = inicio + timedelta(minutes=DURACION_MIN)

    # Bloquea al vendedor mientras se decide: quien llegue segundo espera y
    # después ve el choque, en vez de escribir encima.
    db.query(models.User).filter(models.User.id == lead.vendedor_id).with_for_update().first()

    if _ocupados(db, lead.vendedor_id, inicio, fin):
        raise HTTPException(status_code=409, detail="Ese horario acaba de ocuparse")

    contacto = db.query(models.Contact).filter(models.Contact.id == lead.contact_id).first()
    ev = models.CalendarEvent(
        title=f"Reunión — {contacto.name if contacto else 'Lead'}",
        lead_id=lead.id,
        contact_id=lead.contact_id,
        created_by=lead.agendadora_id,
        assigned_to=lead.vendedor_id,
        start_time=inicio,
        end_time=fin,
        event_type="reunion",
        notes="Agendada por el cliente desde WhatsApp (Zelix).",
    )
    db.add(ev)

    # El lead avanza de etapa acá y no en Zelix: el pipeline es del CRM, y
    # tenerlo en dos sitios es tener dos verdades sobre en qué va cada venta.
    if lead.current_stage == "lead":
        lead.current_stage = "reunion"
    lead.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ev)

    log_event(db, "reunion_agendada_whatsapp", user_id=lead.vendedor_id,
              resource_type="calendar_event", resource_id=ev.id,
              details=f"lead={lead.id}")

    local = inicio.astimezone(TZ)
    return {
        "evento_id": ev.id,
        "inicio": inicio.isoformat(),
        "etiqueta": _etiqueta(local, datetime.now(timezone.utc).astimezone(TZ).date()),
        "etapa_lead": lead.current_stage,
    }

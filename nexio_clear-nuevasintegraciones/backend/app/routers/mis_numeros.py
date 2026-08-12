"""
MIS NÚMEROS — cada usuario vincula su propio WhatsApp, por la API OFICIAL.

Reemplaza la pantalla de sesiones por QR. Aquélla usaba Baileys, que se conecta
haciéndose pasar por WhatsApp Web: es la vía que hace que Meta banee el número,
y con él la atención a los clientes que ya están escribiendo.

── Lo que hace multi-inquilino a esto, y no es el `owner_user_id` ──

El webhook empareja los mensajes entrantes **por `phone_number_id`**. Si dos
usuarios de negocios distintos registraran el mismo, `.first()` elegiría uno
cualquiera y las conversaciones de un negocio aparecerían en el CRM del otro.
Por eso hay dos cerrojos, y hacen falta LOS DOS:

 1. **Un `phone_number_id` se reclama UNA vez.** Segundo intento, rechazado.
 2. **Meta confirma que el token controla ese número.** Sin esto, el cerrojo 1
    protegería al primero que llegue, no al dueño legítimo: bastaría con
    adivinar el `phone_number_id` de otro —son visibles en muchos sitios— para
    quedarse con sus mensajes antes que él. Preguntarle a Meta convierte
    "reclamar" en "demostrar".

Y lo que se ve también está acotado: cada quien lee, edita y borra SOLO lo suyo.
"""
import os
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user
from ..security import log_event

router = APIRouter(prefix="/api/whatsapp/mis-numeros", tags=["mis-numeros"])

GRAPH = os.getenv("META_GRAPH_VERSION", "v21.0")


def _normalizar(tel: str) -> str:
    return "+" + "".join(c for c in (tel or "") if c.isdigit())


async def _verificar_en_meta(phone_number_id: str, token: str) -> dict:
    """Le pregunta a Meta si ese token manda sobre ese número. Lanza si no."""
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.get(
                f"https://graph.facebook.com/{GRAPH}/{phone_number_id}",
                params={"fields": "display_phone_number,verified_name"},
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="No se pudo comprobar el número con Meta. Reintenta en un momento.")

    if r.status_code != 200:
        # No se filtra el cuerpo del error de Meta: puede traer detalles de la
        # cuenta ajena si alguien está probando ids que no son suyos.
        raise HTTPException(
            status_code=400,
            detail="Meta rechazó estos datos: revisa que el phone_number_id y el token sean del mismo número y estén vigentes.",
        )
    return r.json()


@router.get("", response_model=list[schemas.WhatsAppConfigOut])
def mis_numeros(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Solo los del usuario. Nunca los de otro, ni los del negocio entero."""
    return (
        db.query(models.WhatsAppConfig)
        .filter(models.WhatsAppConfig.owner_user_id == current_user.id)
        .order_by(models.WhatsAppConfig.id)
        .all()
    )


@router.post("", response_model=schemas.WhatsAppConfigOut, status_code=201)
async def vincular(
    data: schemas.MiNumeroCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    pnid = (data.phone_number_id or "").strip()
    token = (data.api_token or "").strip()
    if not pnid or not token:
        raise HTTPException(status_code=400, detail="Faltan el phone_number_id y el token.")

    # Cerrojo 1 — ¿ya está tomado? Se comprueba ANTES de hablar con Meta para no
    # convertir este endpoint en una forma de sondear qué ids existen.
    tomado = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.phone_number_id == pnid).first()
    if tomado:
        if tomado.owner_user_id == current_user.id:
            raise HTTPException(status_code=409, detail="Ya tienes este número vinculado.")
        log_event(db, "wa_numero_ya_reclamado", user_id=current_user.id, details=f"pnid={pnid}", severity="warning")
        raise HTTPException(status_code=409, detail="Ese número ya está vinculado en el sistema.")

    # Cerrojo 2 — que Meta confirme que este token manda sobre ese número.
    info = await _verificar_en_meta(pnid, token)

    cfg = models.WhatsAppConfig(
        name=(data.name or info.get("verified_name") or "Mi WhatsApp").strip()[:100],
        phone_number=_normalizar(info.get("display_phone_number", "")),
        phone_number_id=pnid,
        api_token=token,
        api_provider="meta",
        owner_user_id=current_user.id,
        group_id=current_user.group_id,
        is_active=True,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    log_event(db, "wa_numero_vinculado", user_id=current_user.id, resource_type="whatsapp_config", resource_id=cfg.id)
    return cfg


@router.delete("/{config_id}")
def desvincular(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    cfg = (
        db.query(models.WhatsAppConfig)
        .filter(
            models.WhatsAppConfig.id == config_id,
            # El dueño va en el MISMO filtro, no en un `if` posterior: así no
            # existe una versión de este código que lea la fila ajena antes de
            # decidir. Para quien no es dueño, la fila sencillamente no existe.
            models.WhatsAppConfig.owner_user_id == current_user.id,
        )
        .first()
    )
    if not cfg:
        raise HTTPException(status_code=404, detail="No encontrado")
    db.delete(cfg)
    db.commit()
    log_event(db, "wa_numero_desvinculado", user_id=current_user.id, resource_type="whatsapp_config", resource_id=config_id)
    return {"ok": True}

"""
EMBUDO — conteo de leads por etapa, para el tablero de Zelix (fase 2, §12.9.2).

Zelix mide su propio embudo con la metodología de las peceras
(Público → Audiencia → Contacto → Lead → Cliente). Las dos primeras peceras no
viven en la base de Zelix: viven acá, porque el CRM ya tiene etapas de pipeline
configurables por negocio (`pipeline_stages`, cuya `key` es el `current_stage`
del lead). O sea las etapas del pipeline PUEDEN SER las peceras, y el embudo deja
de ser un dibujo y pasa a ser una consulta.

── Por qué no se reusa un endpoint con sesión de usuario ──
Zelix no es un usuario del CRM: es otro sistema. Obligarlo a autenticarse como
persona significaría guardar la contraseña de alguien dentro de Zelix. Se usa el
MISMO secreto compartido del puente (`x-crm-callback-secret`), igual que
`agenda_whatsapp`.

── La regla que ordena todo lo de acá ──
**Cero medido y "no lo estoy midiendo" no son lo mismo.** Si el número de
teléfono no tiene configuración en el CRM, este endpoint responde 404 con el
motivo, y NO devuelve un embudo en cero: un cero inventado le diría a Zelix "medí
y no hay nadie" cuando la verdad es "no hay de dónde leer". Es la misma
distinción que tumbó la purga que devolvía 0 sin borrar nada (decisión 91 del
maestro de Zelix).

Por eso también se devuelven DOS listas: las etapas declaradas en
`pipeline_stages` y las etapas que de verdad aparecen en los leads. Si un lead
está en una etapa que nadie declaró, sale igual en `sin_declarar` en vez de
desaparecer del conteo.
"""
import os
import secrets as _secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models

router = APIRouter(prefix="/api/embudo", tags=["embudo-zelix"])

SECRETO = os.getenv("ZELIX_CRM_SECRET", "")


def _exige_secreto(x_crm_callback_secret: str = Header(None, alias="x-crm-callback-secret")):
    if not SECRETO:
        # Sin secreto configurado la ruta no existe. Dejarla abierta expondría el
        # tamaño del embudo de cualquier negocio a quien pase por ahí.
        raise HTTPException(status_code=404, detail="No disponible")
    if not x_crm_callback_secret or not _secrets.compare_digest(x_crm_callback_secret, SECRETO):
        raise HTTPException(status_code=401, detail="Secret inválido")


def _negocio_de_config(db: Session, phone_number_id: str) -> models.Group:
    """Resuelve el negocio por `phone_number_id`, igual que el webhook.

    El emparejamiento por `phone_number_id` contra `whatsapp_configs` es la misma
    identidad que usa `webhooks.py` para decidir a qué grupo pertenece un lead.
    Usar otra acá haría que el conteo hablara de un negocio distinto del que
    recibe los mensajes: el peor tipo de error, porque el número igual cuadra.
    """
    config = (
        db.query(models.WhatsAppConfig)
        .filter(models.WhatsAppConfig.phone_number_id == phone_number_id)
        .first()
    )
    if not config or not config.group_id:
        raise HTTPException(
            status_code=404,
            detail=f"Sin configuración de WhatsApp para phone_number_id={phone_number_id}: no hay de dónde leer el embudo",
        )
    grupo = db.query(models.Group).filter(models.Group.id == config.group_id).first()
    if not grupo:
        raise HTTPException(status_code=404, detail="La configuración apunta a un grupo que no existe")
    raiz_id = grupo.negocio_id if grupo.negocio_id else grupo.id
    raiz = db.query(models.Group).filter(models.Group.id == raiz_id).first()
    return raiz or grupo


@router.get("/conteo", dependencies=[Depends(_exige_secreto)])
def conteo_por_etapa(
    phone_number_id: str = Query(..., description="El número de WhatsApp del negocio, tal como llega en el webhook de Meta"),
    db: Session = Depends(get_db),
):
    negocio = _negocio_de_config(db, phone_number_id)

    # Todos los grupos que cuelgan del negocio, más el negocio mismo: un lead
    # puede vivir en un subgrupo y sigue siendo del mismo embudo.
    grupos = [negocio.id] + [
        g.id for g in db.query(models.Group).filter(models.Group.negocio_id == negocio.id).all()
    ]

    filas = (
        db.query(models.Lead.current_stage, func.count(models.Lead.id))
        .filter(models.Lead.group_id.in_(grupos))
        .group_by(models.Lead.current_stage)
        .all()
    )
    conteo = {(etapa or "sin_etapa"): int(n) for etapa, n in filas}

    declaradas = (
        db.query(models.PipelineStage)
        .filter(models.PipelineStage.negocio_id == negocio.id)
        .order_by(models.PipelineStage.order)
        .all()
    )

    etapas = [
        {"key": e.key, "name": e.name, "orden": e.order, "leads": conteo.get(e.key, 0)}
        for e in declaradas
    ]
    claves_declaradas = {e.key for e in declaradas}
    sin_declarar = [
        {"key": k, "leads": v} for k, v in sorted(conteo.items()) if k not in claves_declaradas
    ]

    return {
        "negocio_id": negocio.id,
        "negocio": negocio.name,
        "tipo": negocio.tipo,
        # Vacío significa que este negocio NO tiene etapas configuradas. Es un
        # dato, no un error: quien consulta debe poder distinguir "no hay nadie
        # en la etapa" de "la etapa no existe todavía".
        "etapas": etapas,
        "sin_declarar": sin_declarar,
        "total_leads": sum(conteo.values()),
    }

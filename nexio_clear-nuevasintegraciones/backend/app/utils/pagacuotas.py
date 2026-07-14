"""
CRM → PagaCuotas integration.
Primary: calls pagaCuotas-main API (port 4000) via POST /api/integrations/crm/payment-commitments.

Fallback policy:
- En entornos local/dev se PERMITE el espejo en DB local SOLO si
  PAGACUOTAS_ALLOW_LOCAL_FALLBACK == "true".
- En producción (ENVIRONMENT == "production") la creación de un espejo local
  está PROHIBIDA: PagaCuotas es la fuente de verdad del cliente de cobro.
  Si la API no responde, la operación falla con PagaCuotasUnavailable.
"""
import os
import re
import secrets
import logging
import unicodedata
import httpx
from .pagacuotas_links import normalize_pagacuotas_portal_link

logger = logging.getLogger(__name__)

PAGACUOTAS_URL     = os.getenv("PAGACUOTAS_URL",     "http://localhost:4000")

ENVIRONMENT = os.getenv("ENVIRONMENT", "local").lower()
ALLOW_LOCAL_FALLBACK = (
    os.getenv("PAGACUOTAS_ALLOW_LOCAL_FALLBACK", "false").lower() == "true"
    and ENVIRONMENT != "production"
)


class PagaCuotasUnavailable(RuntimeError):
    """Se levanta cuando la API de PagaCuotas no responde y no hay fallback permitido."""
PAGACUOTAS_API_KEY = os.getenv("PAGACUOTAS_API_KEY", "")
PAGACUOTAS_PORTAL_URL = os.getenv("PAGACUOTAS_PORTAL_URL", "http://localhost:5000")


# ── Diccionario de mapeo Nexio (área de servicio) → categoría PagaCuotas ──────
# Encapsula la traducción para ser robusto ante cambios de nombres de áreas en
# Nexio: se busca por slug normalizado del área; si no está mapeada, se usa el
# slug en MAYÚSCULAS como código estable (fallback) para no romper el envío.
MAPPING_CATEGORIAS_PAGACUOTAS = {
    "contabilidad":         "CONTABILIDAD",
    "tributario":           "TRIBUTARIO",
    "familia":              "FAMILIA",
    "laboral":              "LABORAL",
    "civil":                "CIVIL",
    "penal":                "PENAL",
    "corporativo":          "CORPORATIVO",
    "liquidacion juridica": "LIQUIDACION_JURIDICA",
    "reorganizacion":       "REORGANIZACION",
}


def _slug_area(name: str | None) -> str:
    s = unicodedata.normalize("NFKD", (name or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.lower()).strip()


def categoria_pagacuotas(area_name: str | None) -> str:
    """Traduce el área de Nexio al código de categoría que exige PagaCuotas.
    Fallback estable (slug en mayúsculas) si el área no está en el mapa."""
    slug = _slug_area(area_name)
    return MAPPING_CATEGORIAS_PAGACUOTAS.get(slug) or (slug.upper().replace(" ", "_") or "GENERAL")


def _local_token() -> str:
    return secrets.token_urlsafe(40)


def _local_fallback(
    *,
    db,
    crm_lead_id: int,
    rut: str,
    nombre: str,
    razon_social: str | None,
    email: str | None,
    phone: str | None,
    honorarios: float,
    cuota_inicial: float,
    num_cuotas: int,
    monto_cuota: float,
    tipo_servicio: str,
    area_name: str | None,
    vendedor_name: str | None,
) -> dict:
    """Create client in local DB when pagaCuotas API is unreachable."""
    from .. import models

    existing = db.query(models.PagaCuotasCliente).filter(
        models.PagaCuotasCliente.crm_lead_id == crm_lead_id
    ).first()
    if existing:
        link = normalize_pagacuotas_portal_link(f"{PAGACUOTAS_PORTAL_URL}/client/access/{existing.access_token}")
        return {"id": existing.id, "payment_link": link, "whatsapp": {}}

    token = _local_token()
    monto_calc = monto_cuota if monto_cuota > 0 else round(
        cuota_inicial if cuota_inicial > 0 else (honorarios / max(num_cuotas, 1))
    )
    cliente = models.PagaCuotasCliente(
        crm_lead_id=crm_lead_id,
        nombre=nombre,
        rut=rut,
        razon_social=razon_social,
        email=email,
        phone=phone,
        honorarios=honorarios,
        cuota_inicial=cuota_inicial,
        num_cuotas=num_cuotas,
        monto_cuota=monto_calc,
        tipo_servicio=tipo_servicio,
        area_name=area_name,
        vendedor_name=vendedor_name,
        access_token=token,
    )
    db.add(cliente)
    db.flush()

    link = normalize_pagacuotas_portal_link(f"{PAGACUOTAS_PORTAL_URL}/client/access/{token}")
    nombre_first = nombre.split()[0] if nombre else "estimado cliente"
    wa_msg = (
        f"Hola {nombre_first}, ya puedes pagar tus cuotas en PagaCuotas.\n"
        f"Ingresa directamente aquí: {link}\n"
        f"Este enlace es personal y seguro."
    )
    wa_msg = (
        f"Hola {nombre_first}, ya puedes entrar a tu Portal PagaCuotas.\n"
        f"Revisa tu caso y paga tus cuotas aqui: {link}\n"
        f"Este enlace es personal y seguro."
    )
    return {"id": cliente.id, "payment_link": link, "whatsapp": {"to": phone, "message": wa_msg}}


async def crear_cliente(
    *,
    db,
    crm_lead_id: int,
    rut: str,
    nombre: str,
    razon_social: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    honorarios: float,
    cuota_inicial: float,
    num_cuotas: int,
    monto_cuota: float = 0,
    tipo_servicio: str,
    area_name: str | None = None,
    vendedor_name: str | None = None,
) -> dict:
    """
    Push lead payment commitment to pagaCuotas-main API.
    Falls back to local DB if the API is unreachable.
    Returns: {id, payment_link, whatsapp: {to, message}}
    """
    # Monto REAL de la cuota pactada (de la OT sincronizada al lead): prioriza el
    # monto de cuota explícito → cuota inicial → derivado. Nunca queda vacío/0
    # cuando hay financieros (la guarda del backend ya los exige antes de llegar).
    if monto_cuota and monto_cuota > 0:
        monto_calc = round(monto_cuota)
    elif cuota_inicial and cuota_inicial > 0:
        monto_calc = round(cuota_inicial)
    else:
        monto_calc = round(honorarios / max(num_cuotas, 1))
        logger.warning(
            "PagaCuotas lead %s: sin monto_cuota ni cuota_inicial — monto derivado de honorarios/num_cuotas (%s)",
            crm_lead_id, monto_calc,
        )

    # ── Categoría aislada para clientes RECURRENTES ──────────────────────────
    # Si el RUT ya tuvo contratos de pago en otros leads, este es una NUEVA línea
    # de crédito → categoría correlativa + external_ref único (LEAD_ID-N). PagaCuotas
    # lo interpreta como un contrato aislado, sin sobreescribir ni sumar deuda.
    recurrencia_idx = 1
    try:
        if db and rut and not str(rut).startswith("SIN-RUT"):
            from .. import models as _m
            from sqlalchemy import or_ as _or
            prior = db.query(_m.Lead.id).join(
                _m.Contact, _m.Lead.contact_id == _m.Contact.id
            ).filter(
                _or(_m.Contact.rut_persona == rut, _m.Contact.rut_empresa == rut),
                _m.Lead.pagacuotas_cliente_id.isnot(None),
                _m.Lead.id != crm_lead_id,
            ).count()
            recurrencia_idx = prior + 1
    except Exception as _exc:
        logger.warning("PagaCuotas recurrencia no calculable para lead %s: %s", crm_lead_id, _exc)
        recurrencia_idx = 1

    # categoria_id = categoría real del servicio (área traducida por el diccionario);
    # la recurrencia (líneas de crédito repetidas del mismo RUT) va en external_ref.
    categoria_id = categoria_pagacuotas(area_name)

    payload = {
        "crm_lead_id": str(crm_lead_id),
        "external_ref": f"{crm_lead_id}-{recurrencia_idx}",
        "categoria_id": categoria_id,
        "recurrencia": recurrencia_idx,
        "cliente_recurrente": recurrencia_idx > 1,
        "rut": rut,
        "nombre": nombre,
        "telefono": phone or "",
        "email": email or "",
        "empresa": razon_social or "",
        "area": area_name or tipo_servicio,
        "vendedor": vendedor_name or "",
        "total": honorarios,
        "cuota_inicial": cuota_inicial,
        "num_cuotas": num_cuotas,
        "monto_cuota": monto_calc,
        "descripcion": tipo_servicio,
    }

    headers = {"Content-Type": "application/json"}
    if PAGACUOTAS_API_KEY:
        headers["x-crm-api-key"] = PAGACUOTAS_API_KEY

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.post(
                f"{PAGACUOTAS_URL}/api/integration/clients/from-crm",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        # autoLoginUrl is the portal link for the client
        raw_link = data.get("autoLoginUrl") or data.get("payment_link", "")
        payment_link = normalize_pagacuotas_portal_link(raw_link)
        profile_id = data.get("profile", {}).get("id", crm_lead_id)
        logger.info(
            "PagaCuotas API: cliente creado para lead %s → %s",
            crm_lead_id, payment_link,
        )
        return {
            "id": profile_id,
            "payment_link": payment_link,
            "whatsapp": {"to": phone, "message": f"Hola {nombre.split()[0]}, ya puedes acceder a tu Portal PagaCuotas: {payment_link}"},
        }

    except Exception as exc:
        if not ALLOW_LOCAL_FALLBACK:
            logger.error(
                "PagaCuotas API no disponible para lead %s (%s). Fallback local DESHABILITADO "
                "(ENVIRONMENT=%s, ALLOW_LOCAL_FALLBACK=%s). El compromiso de pago NO se persiste; "
                "encolar para retry o intervención manual.",
                crm_lead_id, exc, ENVIRONMENT, ALLOW_LOCAL_FALLBACK,
            )
            raise PagaCuotasUnavailable(
                f"PagaCuotas API no disponible para lead {crm_lead_id}: {exc}"
            ) from exc

        logger.warning(
            "PagaCuotas API no disponible para lead %s (%s). Usando DB local "
            "(SOLO permitido en %s con ALLOW_LOCAL_FALLBACK=true).",
            crm_lead_id, exc, ENVIRONMENT,
        )
        return _local_fallback(
            db=db,
            crm_lead_id=crm_lead_id,
            rut=rut,
            nombre=nombre,
            razon_social=razon_social,
            email=email,
            phone=phone,
            honorarios=honorarios,
            cuota_inicial=cuota_inicial,
            num_cuotas=num_cuotas,
            monto_cuota=monto_calc,
            tipo_servicio=tipo_servicio,
            area_name=area_name,
            vendedor_name=vendedor_name,
        )

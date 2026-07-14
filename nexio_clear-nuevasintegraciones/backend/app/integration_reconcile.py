"""
Reconciliación de datos por RUT — el "solucionador" del panel de integraciones.

A diferencia del semáforo (que mide TRANSPORTE: ¿conectan los sistemas?), esto
mide INTEGRIDAD DE DATOS: trae los datos REALES de cada sistema para un RUT y los
compara lado a lado, marcando dónde divergen (🟢 consistente / 🟡 alerta / 🔴
inconsistente). No inventa: cada valor es leído en vivo del sistema fuente. No
modifica nada (solo identifica y diagnostica).

Fuentes que Nexio lee directo:
  · Nexio     → su propia DB (leads).
  · Contable  → CONTABLE_DATABASE_URL (Cliente/Contrato/Cuota).
  · PagaCuota → PAGACUOTAS_DATABASE_URL (CrmClientProfile).
  · Control   → Nexio no tiene key de lectura de casos; se reporta lo que Nexio
                registró (at_informa_case_id) marcado como NO verificado en vivo.
"""
import os
import re
import logging

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from . import models

logger = logging.getLogger(__name__)


def _norm(rut: str | None) -> str:
    return re.sub(r"[.\-\s]", "", rut or "").upper()


def _norm_txt(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _finding(level: str, title: str, detail: str) -> dict:
    return {"level": level, "title": title, "detail": detail}


def _read_contable(rut_norm: str) -> tuple[list[dict], str | None]:
    url = os.getenv("CONTABLE_DATABASE_URL", "")
    if not url or "CHANGE_ME" in url:
        return [], "CONTABLE_DATABASE_URL no configurada"
    try:
        engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})
        try:
            with engine.connect() as conn:
                rows = conn.execute(text("""
                    SELECT ct.id AS contrato_id, ct.tipo_servicio, ct.monto_ccto,
                           (SELECT cu.monto_original FROM "Cuota" cu
                             WHERE cu.contrato_id = ct.id AND cu.numero_cuota = 2 LIMIT 1) AS cuota_2,
                           cl.nombre
                    FROM "Cliente" cl JOIN "Contrato" ct ON ct.cliente_id = cl.id
                    WHERE replace(replace(replace(coalesce(cl.rut,''),'.',''),'-',''),' ','') = :rut
                    ORDER BY ct.id
                """), {"rut": rut_norm}).mappings().all()
        finally:
            engine.dispose()
        return [dict(r) for r in rows], None
    except Exception as exc:
        return [], f"error leyendo contable: {str(exc)[:100]}"


def _read_pagacuota(rut_norm: str) -> tuple[list[dict], str | None]:
    url = os.getenv("PAGACUOTAS_DATABASE_URL", "")
    if not url or "CHANGE_ME" in url:
        return [], "PAGACUOTAS_DATABASE_URL no configurada"
    try:
        engine = create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})
        try:
            with engine.connect() as conn:
                rows = conn.execute(text("""
                    SELECT id, identifier, nombre, rut
                    FROM "CrmClientProfile"
                    WHERE replace(replace(replace(coalesce(identifier,''),'.',''),'-',''),' ','') = :rut
                       OR replace(replace(replace(coalesce(rut,''),'.',''),'-',''),' ','') = :rut
                """), {"rut": rut_norm}).mappings().all()
        finally:
            engine.dispose()
        return [dict(r) for r in rows], None
    except Exception as exc:
        return [], f"error leyendo pagacuota: {str(exc)[:100]}"


def _read_control(rut_norm: str) -> tuple[list[dict], str | None]:
    """Casos reales de Control vía su endpoint interno (auth con HIVE_SERVICE_API_KEY)."""
    url = os.getenv("HIVE_SERVICE_URL", "")
    key = os.getenv("HIVE_SERVICE_API_KEY") or os.getenv("INTEGRATION_INTERNAL_API_KEY", "")
    if not url or not key:
        return [], "HIVE_SERVICE_URL / HIVE_SERVICE_API_KEY no configurada"
    try:
        with httpx.Client(timeout=6, follow_redirects=True) as client:
            resp = client.get(
                f"{url.rstrip('/')}/api/internal/integration/cases-by-rut/{rut_norm}",
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            )
        if resp.status_code == 200:
            return (resp.json().get("cases") or []), None
        return [], f"Control respondió HTTP {resp.status_code}"
    except Exception as exc:
        return [], f"error consultando Control: {str(exc)[:100]}"


def reconcile_rut(rut: str, db: Session) -> dict:
    rut_norm = _norm(rut)
    findings: list[dict] = []

    # ── NEXIO (fuente de verdad de los leads) ──
    leads = db.query(models.Lead).join(
        models.Contact, models.Lead.contact_id == models.Contact.id
    ).outerjoin(models.Area, models.Lead.area_id == models.Area.id).filter(
        (models.Contact.rut_persona.isnot(None)) | (models.Contact.rut_empresa.isnot(None))
    ).all()
    nexio = []
    for l in leads:
        c = l.contact
        if _norm(c.rut_persona) != rut_norm and _norm(c.rut_empresa) != rut_norm:
            continue
        nexio.append({
            "lead_id": l.id,
            "categoria": (l.area.name if l.area else None),
            "current_stage": l.current_stage,
            "monto_cuota": float(l.monto_cuota or 0),
            "honorarios": float(l.honorarios or 0),
            "at_informa_lead_id": l.at_informa_case_id,          # OJO: es el leadId de Control, no el case id
            "hive_service_case_id": l.hive_service_case_id,      # el case id REAL (null = caso no sembrado)
            "pagacuotas_cliente_id": l.pagacuotas_cliente_id,
        })

    contable, contable_err = _read_contable(rut_norm)
    pagacuota, pagacuota_err = _read_pagacuota(rut_norm)
    control, control_err = _read_control(rut_norm)

    # Solo los leads que YA pagaron generan contrato/caso en los demás sistemas.
    # Un lead en etapa previa (lead/reunión/agendado) legítimamente aún NO tiene
    # contrato ni caso: contarlo como inconsistencia es un falso positivo. Las
    # comparaciones de integridad se hacen contra los leads PAGADOS; `nexio`
    # completo se sigue devolviendo para el detalle del panel.
    _paid = {"pago_comprometido", "pagado_confirmado", "pagado_reunion"}
    paid_nexio = [x for x in nexio if x["current_stage"] in _paid]

    # ── Comparaciones (integridad de datos) ──
    n_leads, n_contratos = len(paid_nexio), len(contable)
    if n_leads != n_contratos and not contable_err:
        findings.append(_finding(
            "error", "Cantidad de casos no coincide",
            f"Nexio tiene {n_leads} lead(s) pagado(s) pero el Contable tiene {n_contratos} contrato(s) para este RUT.",
        ))

    # Categorías por sistema (normalizadas). Solo categorías de leads pagados.
    nexio_cats = {_norm_txt(x["categoria"]): x for x in paid_nexio if x["categoria"]}
    cont_cats = {_norm_txt(x["tipo_servicio"]): x for x in contable if x.get("tipo_servicio")}

    for cat, lx in nexio_cats.items():
        if cat not in cont_cats:
            findings.append(_finding(
                "error", "Categoría sin contrato en el Contable",
                f"«{lx['categoria']}» existe en Nexio pero NO tiene contrato en el Contable.",
            ))
        else:
            cx = cont_cats[cat]
            nexio_m = round(lx["monto_cuota"])
            cont_m = round(float(cx.get("cuota_2") or 0))
            if cont_m and nexio_m and cont_m != nexio_m:
                findings.append(_finding(
                    "error", "Monto de cuota divergente",
                    f"«{lx['categoria']}»: Nexio ${nexio_m:,} vs Contable ${cont_m:,} (cuota 2).".replace(",", "."),
                ))
    for cat, cx in cont_cats.items():
        if cat not in nexio_cats:
            findings.append(_finding(
                "warn", "Contrato en el Contable sin lead en Nexio",
                f"«{cx['tipo_servicio']}» existe en el Contable pero no hay lead en Nexio.",
            ))

    # Nota: que varios leads compartan un mismo perfil de PagaCuota (mismo RUT)
    # es CORRECTO — PagaCuota retiene un snapshot POR-CASO/categoría aparte, así
    # que no se mezclan. No se reporta como inconsistencia.

    # Control: comparación REAL contra los casos que devuelve Control.
    ctrl_cats = {_norm_txt(x.get("categoria")) for x in control if x.get("categoria")}
    if not control_err:
        n_casos = len(control)
        if n_leads != n_casos:
            findings.append(_finding(
                "error", "Cantidad de casos en Control no coincide",
                f"Nexio tiene {n_leads} lead(s) pagado(s) pero Control tiene {n_casos} caso(s) para este RUT.",
            ))
        for cat, lx in nexio_cats.items():
            if cat not in ctrl_cats:
                findings.append(_finding(
                    "error", "Categoría sin caso en Control",
                    f"«{lx['categoria']}» existe en Nexio pero NO tiene caso en Control (no se sembró).",
                ))
    # hive_service_case_id vacío significa que el push de /cases no confirmó su id
    # DESDE Nexio, pero eso NO implica que el caso falte: pudo sembrarse por otra
    # vía (AT-Informa/fc con el mismo case_code SIS-{contrato}). Si Control es
    # legible, su existencia ya se validó arriba por conteo/categoría, así que un
    # id no trackeado internamente no es una inconsistencia del ecosistema y no se
    # reporta. Solo advierte cuando Control NO responde: ahí el id interno es la
    # única señal de que el caso llegó a sembrarse.
    if control_err:
        no_track = [x for x in paid_nexio if not x["hive_service_case_id"]]
        if no_track:
            findings.append(_finding(
                "warn", "No se pudo confirmar el caso en Control",
                f"{len(no_track)} lead(s) pagado(s) sin hive_service_case_id y Control no respondió "
                f"({control_err}): no se pudo verificar que el caso exista. Reintentar cuando Control "
                f"esté disponible.",
            ))

    if not findings:
        findings.append(_finding("ok", "Sin inconsistencias detectadas",
                                 "Los datos de los sistemas legibles coinciden para este RUT."))

    worst = "ok"
    if any(f["level"] == "error" for f in findings):
        worst = "error"
    elif any(f["level"] == "warn" for f in findings):
        worst = "warn"

    return {
        "rut": rut,
        "rut_norm": rut_norm,
        "overall": worst,
        "systems": {
            "nexio": {"leads": nexio},
            "contable": {"contratos": contable, "error": contable_err},
            "pagacuota": {"profiles": pagacuota, "error": pagacuota_err},
            "control": {"cases": control, "error": control_err},
        },
        "findings": findings,
    }

"""
Panel del Analista — dashboard "Distribución de cartera de cobranza".

Solo lectura. Los datos (cuotas, recaudación diaria, gestiones, promesas, aging
por ejecutivo) viven en systemFinance (hive-financial-control), que los agrega y
expone en un endpoint interno. NEXIO actúa como proxy autenticado: el analista
consulta aquí y NEXIO reenvía a financial con el secreto compartido (secreto D).
"""
import os
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session
from .. import models
from ..auth import get_current_user
from ..database import get_db
from ..utils.resilient_http import resilient_request, CircuitOpenError, TIMEOUT_HEAVY

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analista", tags=["analista"])

ALLOWED_ROLES = ("analista", "superadmin", "subadmin", "tecnico")

LEGAL_FINANCE_URL = os.getenv("LEGAL_FINANCE_URL", "http://localhost:4000").rstrip("/")
LEGAL_FINANCE_API_KEY = os.getenv("LEGAL_FINANCE_API_KEY", "")


@router.get("/dashboard")
async def dashboard(
    period: str | None = Query(default=None, description="Mes YYYY-MM"),
    from_date: str | None = Query(default=None, description="Fecha inicio YYYY-MM-DD"),
    to_date: str | None = Query(default=None, description="Fecha fin YYYY-MM-DD"),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Sin acceso al panel de analista")
    if not LEGAL_FINANCE_API_KEY:
        raise HTTPException(status_code=503, detail="Integración financiera no configurada (LEGAL_FINANCE_API_KEY)")

    params: dict = {}
    if from_date and to_date:
        params["from_date"] = from_date
        params["to_date"] = to_date
    elif period:
        params["period"] = period
    url = f"{LEGAL_FINANCE_URL}/api/internal/integration/analista-dashboard"
    if params:
        url = f"{url}?{urlencode(params)}"

    try:
        resp = await resilient_request(
            "GET",
            url,
            headers={"Authorization": f"Bearer {LEGAL_FINANCE_API_KEY}"},
            hop="legal_finance.analista-dashboard",
            timeout=TIMEOUT_HEAVY,
        )
    except CircuitOpenError:
        raise HTTPException(status_code=503, detail="Sistema financiero temporalmente no disponible")
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("Analista dashboard: fallo de red a financial: %s", exc)
        raise HTTPException(status_code=502, detail="No se pudo contactar el sistema financiero")

    if resp.status_code == 401:
        raise HTTPException(status_code=502, detail="Secreto de integración financiero inválido")
    if resp.status_code >= 400:
        logger.warning("Analista dashboard: financial respondió %s", resp.status_code)
        raise HTTPException(status_code=502, detail="Error del sistema financiero")

    body = resp.json()
    return body.get("data", body)


# ── Carteras reales de cobradores ─────────────────────────────────────────────
# Calcula TODO desde datos reales: cobrador_leads (NEXIO) + Cuota/Contrato
# (sistema contable). Nombres = usuarios reales con rol cobrador.

def _month_bounds(period: str | None, from_date: str | None, to_date: str | None) -> tuple[date, date]:
    if from_date and to_date:
        return date.fromisoformat(from_date), date.fromisoformat(to_date)
    if period:
        y, m = (int(x) for x in period.split("-"))
    else:
        today = date.today()
        y, m = today.year, today.month
    start = date(y, m, 1)
    end = (date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)) - timedelta(days=1)
    return start, end


@router.get("/carteras")
def carteras_cobradores(
    period: str | None = Query(default=None, description="Mes YYYY-MM"),
    from_date: str | None = Query(default=None, description="Fecha inicio YYYY-MM-DD"),
    to_date: str | None = Query(default=None, description="Fecha fin YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Dashboard del analista con datos reales de las carteras de los cobradores."""
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Sin acceso al panel de analista")

    d_from, d_to = _month_bounds(period, from_date, to_date)
    today = date.today()

    cobradores = db.query(models.User).filter(
        models.User.role == "cobrador", models.User.is_active == True
    ).order_by(models.User.name).all()

    # Mismo filtro que el panel del cobrador: solo leads de sus áreas asignadas,
    # para que los números del analista calcen exactamente con cada panel.
    areas_by_cobrador = {
        u.id: {a.strip().upper() for a in (u.cobrador_area or "").split(",") if a.strip()}
        for u in cobradores
    }
    leads = db.query(models.CobradorLead).all()
    leads_by_cobrador: dict[int, list] = defaultdict(list)
    contrato_to_cobrador: dict[int, int] = {}
    for l in leads:
        assigned = areas_by_cobrador.get(l.cobrador_id)
        if assigned and (l.empresa or "").strip().upper() not in assigned:
            continue
        leads_by_cobrador[l.cobrador_id].append(l)
        if l.lf_contrato_id:
            contrato_to_cobrador[l.lf_contrato_id] = l.cobrador_id

    contrato_ids = list(contrato_to_cobrador.keys())

    # ── Datos del sistema contable (cuotas reales por contrato) ──────────────
    cuotas_periodo: dict[int, dict] = {}        # contrato -> {cuotas, monto, vencidas, liquidadas, monto_liquidado}
    pagos_dia: dict[tuple, float] = {}          # (contrato, dia) -> monto pagado
    aging_rows: list[dict] = []                 # {contrato, dias, saldo}
    if contrato_ids:
        from .cobrador import _get_contable_engine
        id_list = ",".join(str(int(i)) for i in contrato_ids)
        try:
            engine = _get_contable_engine()
            with engine.connect() as conn:
                rows = conn.execute(sa_text(f"""
                    SELECT contrato_id,
                           COUNT(*) AS cuotas,
                           COALESCE(SUM(monto_actual), 0) AS monto,
                           COUNT(*) FILTER (WHERE estado = 'PENDIENTE' AND fecha_vencimiento < CURRENT_DATE) AS vencidas,
                           COUNT(*) FILTER (WHERE estado = 'PAGADA') AS liquidadas,
                           COALESCE(SUM(monto_pagado) FILTER (WHERE estado = 'PAGADA'), 0) AS monto_liquidado
                    FROM "Cuota"
                    WHERE contrato_id IN ({id_list})
                      AND fecha_vencimiento BETWEEN :dfrom AND :dto
                    GROUP BY contrato_id
                """), {"dfrom": d_from, "dto": d_to})
                cuotas_periodo = {r[0]: dict(r._mapping) for r in rows}

                rows = conn.execute(sa_text(f"""
                    SELECT contrato_id, fecha_pago, COALESCE(SUM(monto_pagado), 0) AS monto
                    FROM "Cuota"
                    WHERE contrato_id IN ({id_list})
                      AND estado = 'PAGADA' AND fecha_pago BETWEEN :dfrom AND :dto
                    GROUP BY contrato_id, fecha_pago
                """), {"dfrom": d_from, "dto": d_to})
                for r in rows:
                    pagos_dia[(r[0], r[1])] = float(r[2])

                rows = conn.execute(sa_text(f"""
                    SELECT contrato_id,
                           (CURRENT_DATE - fecha_vencimiento) AS dias,
                           COALESCE(SUM(monto_actual - monto_pagado), 0) AS saldo
                    FROM "Cuota"
                    WHERE contrato_id IN ({id_list})
                      AND estado = 'PENDIENTE' AND fecha_vencimiento < CURRENT_DATE
                    GROUP BY contrato_id, fecha_vencimiento
                """))
                aging_rows = [dict(r._mapping) for r in rows]
            engine.dispose()
        except Exception as e:
            logger.warning("[analista] contable query failed: %s", e)

    # ── Por cobrador ──────────────────────────────────────────────────────────
    num_days = (d_to - d_from).days + 1
    dias = [(d_from + timedelta(days=i)) for i in range(num_days)]
    comparativo, series, monto_por_ejec = [], [], []
    recaudacion_total = {d: 0.0 for d in dias}

    for u in cobradores:
        ls = leads_by_cobrador.get(u.id, [])
        cartera = sum(l.monto_deuda or 0 for l in ls)
        cobrado = sum(l.monto_pagado or 0 for l in ls)
        contratos_u = [l.lf_contrato_id for l in ls if l.lf_contrato_id]
        cp = [cuotas_periodo.get(c, {}) for c in contratos_u]
        cuotas = sum(int(c.get("cuotas") or 0) for c in cp)
        monto_esperado = sum(float(c.get("monto") or 0) for c in cp)
        vencidas = sum(int(c.get("vencidas") or 0) for c in cp)
        liquidadas = sum(int(c.get("liquidadas") or 0) for c in cp)
        monto_liquidado = sum(float(c.get("monto_liquidado") or 0) for c in cp)

        data_dias = []
        dias_con_cobro = 0
        for d in dias:
            m = sum(pagos_dia.get((c, d), 0.0) for c in contratos_u)
            data_dias.append(round(m))
            recaudacion_total[d] += m
            if m > 0:
                dias_con_cobro += 1

        asignados = len(ls)
        contactados = sum(1 for l in ls if l.is_contactado)
        comprometidos = sum(1 for l in ls if l.stage == "pago_comprometido")
        pagados = sum(1 for l in ls if l.stage in ("pagado", "historial"))

        comparativo.append({
            "cobradorId": u.id,
            "nombre": u.name,
            "areas": u.cobrador_area or "—",
            "clientes": asignados,
            "cartera": round(cartera),
            "cobrado": round(cobrado),
            "pendiente": round(max(cartera - cobrado, 0)),
            "pctRecuperacion": round(cobrado / cartera * 100, 1) if cartera else 0,
            "cuotas": cuotas,
            "montoEsperado": round(monto_esperado),
            "vencidas": vencidas,
            "liquidadas": liquidadas,
            "montoLiquidado": round(monto_liquidado),
            "diasConCobro": dias_con_cobro,
            "contactados": contactados,
            "contactabilidad": round(contactados / asignados * 100, 1) if asignados else 0,
            "comprometidos": comprometidos,
            "pagados": pagados,
            "efectividad": round(pagados / asignados * 100, 1) if asignados else 0,
        })
        series.append({"nombre": u.name, "data": data_dias})
        if cartera > 0:
            monto_por_ejec.append({"nombre": u.name, "monto": round(cartera)})

    # ── KPIs globales ─────────────────────────────────────────────────────────
    tot_cuotas = sum(r["cuotas"] for r in comparativo)
    tot_esperado = sum(r["montoEsperado"] for r in comparativo)
    tot_vencidas = sum(r["vencidas"] for r in comparativo)
    tot_liquidadas = sum(r["liquidadas"] for r in comparativo)
    tot_liquidado = sum(r["montoLiquidado"] for r in comparativo)
    tot_cartera = sum(r["cartera"] for r in comparativo)
    tot_cobrado = sum(r["cobrado"] for r in comparativo)

    # ── Aging real (saldo vencido por antigüedad) ─────────────────────────────
    buckets = [("1 a 30 días", 1, 30), ("31 a 60 días", 31, 60), ("61 a 90 días", 61, 90), ("+ de 90 días", 91, 10**6)]
    aging = []
    for label, lo, hi in buckets:
        monto = sum(float(r["saldo"] or 0) for r in aging_rows if lo <= int(r["dias"]) <= hi)
        aging.append({"rango": label, "monto": round(monto)})

    # ── Promesas (compromisos de pago reales del panel cobrador) ─────────────
    comprometidos_tot = sum(r["comprometidos"] for r in comparativo)
    pagados_tot = sum(r["pagados"] for r in comparativo)
    promesas = {
        "total": comprometidos_tot + pagados_tot,
        "cumplidas": pagados_tot,
        "incumplidas": comprometidos_tot,
    }

    ranking = sorted(
        [{"cobradorId": r["cobradorId"], "nombre": r["nombre"],
          "pctRecuperacion": r["pctRecuperacion"], "montoLiquidado": r["montoLiquidado"]}
         for r in comparativo],
        key=lambda x: (x["pctRecuperacion"], x["montoLiquidado"]), reverse=True,
    )

    meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
    period_label = f"{meses[d_from.month-1].capitalize()} {d_from.year}" if (d_from.day == 1 and d_from.month == d_to.month) \
        else f"{d_from.isoformat()} al {d_to.isoformat()}"

    return {
        "periodLabel": period_label,
        "rangeStart": d_from.isoformat(),
        "rangeEnd": d_to.isoformat(),
        "generatedAt": datetime.utcnow().isoformat(),
        "kpis": {
            "totalCuotas": tot_cuotas,
            "montoEsperado": tot_esperado,
            "cuotasVencidas": tot_vencidas,
            "pctVencidas": round(tot_vencidas / tot_cuotas * 100, 1) if tot_cuotas else 0,
            "cuotasLiquidadas": tot_liquidadas,
            "pctLiquidadas": round(tot_liquidadas / tot_cuotas * 100, 1) if tot_cuotas else 0,
            "pctRecuperacion": round(tot_liquidado / tot_esperado * 100, 1) if tot_esperado else 0,
            "totalCartera": tot_cartera,
            "totalCobrado": tot_cobrado,
            "totalRecuperado": tot_liquidado,
        },
        "comparativo": comparativo,
        "montoPorEjecutivo": sorted(monto_por_ejec, key=lambda x: x["monto"], reverse=True),
        "recaudacionDiaria": [{"dia": d.day, "fecha": d.isoformat(), "monto": round(m)} for d, m in recaudacion_total.items()],
        "recaudacionDiariaPorEjecutivo": {"dias": [d.day for d in dias], "series": series},
        "aging": aging,
        "promesas": promesas,
        "ranking": ranking,
        "totalRecuperado": tot_liquidado,
    }


@router.get("/carteras/detalle")
def carteras_detalle(
    period: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Registros fila a fila que componen cada número del dashboard del analista.

    Devuelve los clientes de cada cartera y sus cuotas (las del período, las
    pagadas en el período y todas las vencidas pendientes) para que el panel
    pueda mostrar el porqué de cada métrica.
    """
    if current_user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Sin acceso al panel de analista")

    d_from, d_to = _month_bounds(period, from_date, to_date)

    cobradores = db.query(models.User).filter(
        models.User.role == "cobrador", models.User.is_active == True
    ).order_by(models.User.name).all()
    nombre_cobrador = {u.id: u.name for u in cobradores}
    areas_by_cobrador = {
        u.id: {a.strip().upper() for a in (u.cobrador_area or "").split(",") if a.strip()}
        for u in cobradores
    }

    clientes, contrato_info = [], {}
    for l in db.query(models.CobradorLead).all():
        if l.cobrador_id not in nombre_cobrador:
            continue
        assigned = areas_by_cobrador.get(l.cobrador_id)
        if assigned and (l.empresa or "").strip().upper() not in assigned:
            continue
        clientes.append({
            "leadId": l.id,
            "cobradorId": l.cobrador_id,
            "cobrador": nombre_cobrador[l.cobrador_id],
            "nombre": l.nombre,
            "rut": l.rut,
            "empresa": l.empresa,
            "stage": l.stage,
            "isContactado": bool(l.is_contactado),
            "contactadoAt": l.contactado_at.isoformat() if l.contactado_at else None,
            "montoDeuda": round(l.monto_deuda or 0),
            "montoPagado": round(l.monto_pagado or 0),
            "pendiente": round(max((l.monto_deuda or 0) - (l.monto_pagado or 0), 0)),
            "cuotasVencidas": l.lf_cuotas_vencidas or 0,
            "proximaCuotaFecha": l.proxima_cuota_fecha,
            "lfContratoId": l.lf_contrato_id,
        })
        if l.lf_contrato_id:
            contrato_info[l.lf_contrato_id] = (l.id, l.nombre, l.cobrador_id)

    cuotas = []
    if contrato_info:
        from .cobrador import _get_contable_engine
        id_list = ",".join(str(int(i)) for i in contrato_info)
        try:
            engine = _get_contable_engine()
            with engine.connect() as conn:
                rows = conn.execute(sa_text(f"""
                    SELECT contrato_id, numero_cuota, fecha_vencimiento, estado,
                           monto_actual, monto_pagado, fecha_pago,
                           GREATEST(CURRENT_DATE - fecha_vencimiento, 0) AS dias_vencida
                    FROM "Cuota"
                    WHERE contrato_id IN ({id_list})
                      AND (
                        fecha_vencimiento BETWEEN :dfrom AND :dto
                        OR (estado = 'PENDIENTE' AND fecha_vencimiento < CURRENT_DATE)
                        OR (estado = 'PAGADA' AND fecha_pago BETWEEN :dfrom AND :dto)
                      )
                    ORDER BY fecha_vencimiento
                """), {"dfrom": d_from, "dto": d_to})
                for r in rows:
                    m = r._mapping
                    lead_id, cliente_nombre, cobrador_id = contrato_info[m["contrato_id"]]
                    cuotas.append({
                        "contratoId": m["contrato_id"],
                        "leadId": lead_id,
                        "cliente": cliente_nombre,
                        "cobradorId": cobrador_id,
                        "cobrador": nombre_cobrador.get(cobrador_id),
                        "numeroCuota": m["numero_cuota"],
                        "fechaVencimiento": m["fecha_vencimiento"].isoformat() if m["fecha_vencimiento"] else None,
                        "estado": m["estado"],
                        "montoCuota": round(float(m["monto_actual"] or 0)),
                        "montoPagado": round(float(m["monto_pagado"] or 0)),
                        "fechaPago": m["fecha_pago"].isoformat() if m["fecha_pago"] else None,
                        "diasVencida": int(m["dias_vencida"] or 0),
                        "enPeriodo": bool(m["fecha_vencimiento"] and d_from <= m["fecha_vencimiento"] <= d_to),
                    })
            engine.dispose()
        except Exception as e:
            logger.warning("[analista] detalle contable query failed: %s", e)

    return {
        "rangeStart": d_from.isoformat(),
        "rangeEnd": d_to.isoformat(),
        "clientes": clientes,
        "cuotas": cuotas,
    }

"""
PagaCuotas — sistema interno de gestión de cuotas.
Rutas admin (autenticadas) + rutas públicas para clientes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user
from ..utils.pagacuotas import crear_cliente, PAGACUOTAS_PORTAL_URL

router = APIRouter(prefix="/api/pagacuotas", tags=["pagacuotas"])
public_router = APIRouter(prefix="/api/pagar", tags=["pagacuotas-publico"])


# ── Admin endpoints ──────────────────────────────────────────────────────────

@router.get("/clientes", response_model=List[schemas.PagaCuotasClienteOut])
def list_clientes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("superadmin", "subadmin", "verificador", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    return (
        db.query(models.PagaCuotasCliente)
        .order_by(models.PagaCuotasCliente.created_at.desc())
        .all()
    )


@router.get("/clientes/{cliente_id}", response_model=schemas.PagaCuotasClienteOut)
def get_cliente(
    cliente_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("superadmin", "subadmin", "verificador", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    c = db.query(models.PagaCuotasCliente).filter(models.PagaCuotasCliente.id == cliente_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return c


@router.post("/clientes", response_model=schemas.PagaCuotasClienteOut)
def create_cliente_admin(
    data: schemas.PagaCuotasClienteCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Create or return existing PagaCuotas client (admin use)."""
    if current_user.role not in ("superadmin", "subadmin", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    result = crear_cliente(
        db=db,
        crm_lead_id=data.crm_lead_id or 0,
        rut=data.rut or "",
        nombre=data.nombre,
        razon_social=data.razon_social,
        email=data.email,
        phone=data.phone,
        honorarios=data.honorarios,
        cuota_inicial=data.cuota_inicial,
        num_cuotas=data.num_cuotas,
        monto_cuota=data.monto_cuota,
        tipo_servicio=data.tipo_servicio or "Tributario",
        area_name=data.area_name,
        vendedor_name=data.vendedor_name,
    )
    db.commit()
    return db.query(models.PagaCuotasCliente).filter(
        models.PagaCuotasCliente.id == result["id"]
    ).first()


@router.patch("/pagos/{pago_id}/confirmar")
def confirmar_pago(
    pago_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin confirms a pending payment."""
    if current_user.role not in ("superadmin", "subadmin", "verificador", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    pago = db.query(models.PagaCuotasPago).filter(models.PagaCuotasPago.id == pago_id).first()
    if not pago:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    pago.status = "confirmado"
    cliente = db.query(models.PagaCuotasCliente).filter(
        models.PagaCuotasCliente.id == pago.cliente_id
    ).first()
    if cliente:
        cliente.cuotas_pagadas = (cliente.cuotas_pagadas or 0) + 1
    db.commit()
    return {"ok": True}


@router.patch("/pagos/{pago_id}/rechazar")
def rechazar_pago(
    pago_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("superadmin", "subadmin", "verificador", "tecnico"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    pago = db.query(models.PagaCuotasPago).filter(models.PagaCuotasPago.id == pago_id).first()
    if not pago:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    pago.status = "rechazado"
    db.commit()
    return {"ok": True}


# ── Public endpoints (no auth — client uses token from WhatsApp link) ────────

@public_router.get("/{token}")
def get_portal_cliente(token: str, db: Session = Depends(get_db)):
    """Public: client loads their payment portal using the token from their WhatsApp link."""
    cliente = db.query(models.PagaCuotasCliente).filter(
        models.PagaCuotasCliente.access_token == token,
        models.PagaCuotasCliente.is_active == True,
    ).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Enlace no válido o expirado")

    pagos = (
        db.query(models.PagaCuotasPago)
        .filter(models.PagaCuotasPago.cliente_id == cliente.id)
        .order_by(models.PagaCuotasPago.created_at.desc())
        .all()
    )
    total_pagado = sum(p.monto for p in pagos if p.status == "confirmado")
    saldo_pendiente = max(0.0, (cliente.honorarios or 0) - total_pagado)
    cuotas_restantes = max(0, (cliente.num_cuotas or 1) - (cliente.cuotas_pagadas or 0))

    return {
        "id": cliente.id,
        "nombre": cliente.nombre,
        "rut": cliente.rut,
        "razon_social": cliente.razon_social,
        "email": cliente.email,
        "phone": cliente.phone,
        "tipo_servicio": cliente.tipo_servicio,
        "area_name": cliente.area_name,
        "vendedor_name": cliente.vendedor_name,
        "honorarios": cliente.honorarios,
        "cuota_inicial": cliente.cuota_inicial,
        "num_cuotas": cliente.num_cuotas,
        "monto_cuota": cliente.monto_cuota,
        "cuotas_pagadas": cliente.cuotas_pagadas,
        "cuotas_restantes": cuotas_restantes,
        "total_pagado": total_pagado,
        "saldo_pendiente": saldo_pendiente,
        "created_at": cliente.created_at.isoformat() if cliente.created_at else None,
        "pagos": [
            {
                "id": p.id,
                "monto": p.monto,
                "metodo": p.metodo,
                "referencia": p.referencia,
                "notas": p.notas,
                "status": p.status,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in pagos
        ],
    }


@public_router.post("/{token}/pagar")
def registrar_pago_cliente(token: str, body: dict, db: Session = Depends(get_db)):
    """Public: client submits payment info for admin verification."""
    cliente = db.query(models.PagaCuotasCliente).filter(
        models.PagaCuotasCliente.access_token == token,
        models.PagaCuotasCliente.is_active == True,
    ).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Enlace no válido o expirado")

    monto = float(body.get("monto", 0) or 0)
    if monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")

    pago = models.PagaCuotasPago(
        cliente_id=cliente.id,
        monto=monto,
        metodo=body.get("metodo"),
        referencia=body.get("referencia"),
        notas=body.get("notas"),
        status="pendiente",
    )
    db.add(pago)
    db.commit()
    db.refresh(pago)
    return {
        "ok": True,
        "pago_id": pago.id,
        "mensaje": "Tu pago fue registrado y está en revisión. Te contactaremos a la brevedad.",
    }

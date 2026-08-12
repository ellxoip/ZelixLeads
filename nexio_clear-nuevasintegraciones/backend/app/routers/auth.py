import os
import json
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models, schemas
from ..auth import verify_password, create_access_token, get_current_user
from ..plans import get_limits
from ..security import log_event

router = APIRouter(prefix="/api/auth", tags=["auth"])

_MAX_FAILED = 5
_LOCKOUT_MINUTES = 30


def _enrich_user(user: models.User, db: Session) -> dict:
    """Attach negocio plan info to the user dict."""
    data = schemas.UserOut.model_validate(user).model_dump()
    plan = "basico"
    if user.group_id:
        group = db.query(models.Group).filter(models.Group.id == user.group_id).first()
        if group:
            negocio = group if group.negocio_id is None else db.query(models.Group).filter(models.Group.id == group.negocio_id).first()
            if negocio and negocio.plan:
                plan = negocio.plan
    elif user.role == "cobrador":
        # Cobrador users have no group_id; inherit plan from the abogados negocio
        negocio = db.query(models.Group).filter(
            models.Group.tipo == "abogados",
            models.Group.negocio_id.is_(None),
        ).first()
        if negocio and negocio.plan:
            plan = negocio.plan
    data["negocio_plan"] = plan
    data["negocio_plan_limits"] = get_limits(plan)
    return data


@router.post("/login")
def login(request: Request, credentials: schemas.LoginRequest, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")

    user = db.query(models.User).filter(models.User.email == credentials.email).first()

    if not user:
        log_event(db, "login_failed", actor_email=credentials.email, ip=ip, ua=ua,
                  severity="warning", details="Email no registrado")
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    # ISO 27001 A.9.4.2 — account lockout check
    now = datetime.now(timezone.utc)
    if user.locked_until and user.locked_until > now:
        remaining = max(1, int((user.locked_until - now).total_seconds() // 60))
        log_event(db, "login_blocked", user_id=user.id, actor_email=user.email, ip=ip, ua=ua,
                  severity="critical", details=f"Cuenta bloqueada, {remaining} min restantes")
        raise HTTPException(
            status_code=429,
            detail=f"Cuenta bloqueada por intentos fallidos. Intenta en {remaining} minutos."
        )

    if not verify_password(credentials.password, user.password_hash):
        attempts = (user.failed_login_attempts or 0) + 1
        user.failed_login_attempts = attempts
        if attempts >= _MAX_FAILED:
            user.locked_until = now + timedelta(minutes=_LOCKOUT_MINUTES)
            db.commit()
            log_event(db, "login_locked", user_id=user.id, actor_email=user.email, ip=ip, ua=ua,
                      severity="critical",
                      details=f"Cuenta bloqueada {_LOCKOUT_MINUTES} min tras {_MAX_FAILED} intentos")
        else:
            db.commit()
            log_event(db, "login_failed", user_id=user.id, actor_email=user.email, ip=ip, ua=ua,
                      severity="warning", details=f"Intento {attempts}/{_MAX_FAILED}")
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    if not user.is_active:
        log_event(db, "login_blocked", user_id=user.id, actor_email=user.email, ip=ip, ua=ua,
                  severity="warning", details="Usuario desactivado")
        raise HTTPException(status_code=403, detail="Usuario desactivado")

    # Successful login — reset lockout state
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()
    log_event(db, "login_success", user_id=user.id, actor_email=user.email, ip=ip, ua=ua,
              severity="info")

    token = create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": _enrich_user(user, db)}


@router.get("/me")
def me(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _enrich_user(current_user, db)


# ── Panel de credenciales del equipo ────────────────────────────────────────
#
# Antes, el login mostraba las cuentas del CRM con su contraseña EN TEXTO PLANO
# dentro del bundle de JavaScript: cualquiera que abriera leads.zelix.cl podía
# leerlas y entrar como SuperAdmin. Ponerlas detrás de una clave en el frontend
# no habría cambiado nada — el bundle es público, y la clave habría viajado
# junto a lo que protege.
#
# Por eso la comprobación vive ACÁ: la clave se compara en el servidor y las
# credenciales solo cruzan la red cuando ya acertó. El navegador nunca recibe
# nada que no se haya ganado.
_PANEL_CLAVE = os.getenv("PANEL_CREDENCIALES_CLAVE", "")
_PANEL_CUENTAS = os.getenv("PANEL_CREDENCIALES", "")

# Freno de fuerza bruta. El login se bloquea por usuario con `locked_until` en la
# base; acá no hay usuario que bloquear, así que se cuenta por IP.
#
# Vive en MEMORIA del proceso, y eso es una limitación real, no un descuido: se
# reinicia con cada despliegue y no se comparte entre instancias. Hoy el servicio
# corre con una sola, así que frena lo que tiene que frenar; el día que haya
# varias, esto necesita Redis o una tabla. Aun así vale la pena: sin nada, una
# clave se prueba miles de veces por minuto; con esto, quince por hora.
_PANEL_MAX_FALLOS = 5
_PANEL_BLOQUEO_MIN = 15
_panel_fallos: dict[str, tuple[int, datetime]] = {}


def _panel_bloqueado(ip: str) -> int:
    """Minutos que faltan para poder reintentar. 0 = puede pasar."""
    fallos, hasta = _panel_fallos.get(ip, (0, datetime.now(timezone.utc)))
    if fallos < _PANEL_MAX_FALLOS:
        return 0
    restante = (hasta - datetime.now(timezone.utc)).total_seconds()
    if restante <= 0:
        _panel_fallos.pop(ip, None)
        return 0
    return max(1, int(restante // 60) + 1)


@router.post("/panel-credenciales")
def panel_credenciales(payload: dict, request: Request, db: Session = Depends(get_db)):
    """Devuelve las credenciales del equipo si la clave es correcta."""
    # Sin configurar = la función no existe. Así un despliegue que olvide las
    # variables no deja un endpoint abierto devolviendo listas vacías.
    if not _PANEL_CLAVE or not _PANEL_CUENTAS:
        raise HTTPException(status_code=404, detail="No disponible")

    ip = request.client.host if request.client else "desconocida"
    espera = _panel_bloqueado(ip)
    if espera:
        raise HTTPException(status_code=429, detail=f"Demasiados intentos. Reintenta en {espera} minutos.")

    clave = (payload or {}).get("clave") or ""
    # compare_digest: el tiempo de comparación no depende de cuántos caracteres
    # acertó, así que no se puede adivinar la clave letra por letra midiendo.
    if not secrets.compare_digest(str(clave), _PANEL_CLAVE):
        fallos = _panel_fallos.get(ip, (0, None))[0] + 1
        _panel_fallos[ip] = (fallos, datetime.now(timezone.utc) + timedelta(minutes=_PANEL_BLOQUEO_MIN))
        log_event(
            db, "panel_credenciales_clave_incorrecta",
            ip=request.client.host if request.client else None,
            ua=request.headers.get("user-agent"),
            severity="warning" if fallos < _PANEL_MAX_FALLOS else "critical",
            details=f"intento {fallos}",
        )
        raise HTTPException(status_code=401, detail="Clave incorrecta")

    _panel_fallos.pop(ip, None)  # acertó: se limpia la cuenta

    try:
        cuentas = json.loads(_PANEL_CUENTAS)
    except ValueError:
        raise HTTPException(status_code=500, detail="Credenciales mal configuradas")
    return {"cuentas": cuentas}

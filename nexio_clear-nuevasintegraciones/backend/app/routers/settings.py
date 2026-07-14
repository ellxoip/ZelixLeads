import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from ..auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULT_STAGE_LABELS = {
    "lead":                  "Lead",
    "reunion":               "Reunión",
    "espera_cliente":        "En proceso de reunión",
    "sin_exito":             "Sin Éxito / No Conectó",
    "altamente_interesado":  "Altamente Interesado",
    "cierre":                "Cierre",
    "pago_pendiente":        "Pago Pendiente",
    "pago_comprometido":     "Pago Comprometido",
    "pagado_reunion":        "Validando Pago Reunión",
    "pagado_confirmado":     "Pago Confirmado",
    "recuperacion_lead":     "Recuperación Lead",
    "recuperacion_reunion":  "Recuperación Reunión",
    "recuperacion_cierre":   "Recuperación Cierre",
    "recuperacion_pago":     "Recuperación Pago",
    "papelera":              "Papelera",
}

DEFAULT_COBRADOR_STAGE_LABELS = {
    "pendiente_moroso":  "Pendiente Moroso",
    "lead_moroso":       "Lead Moroso",
    "pago_comprometido": "Pago Comprometido",
    "pagado":            "Pagado",
}


def _get_setting(db: Session, key: str):
    return db.query(models.AppSetting).filter(models.AppSetting.key == key).first()


def _upsert_setting(db: Session, key: str, value: str):
    s = _get_setting(db, key)
    if s:
        s.value = value
    else:
        db.add(models.AppSetting(key=key, value=value))
    db.commit()


@router.get("/stage-labels")
def get_stage_labels(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    setting = _get_setting(db, "stage_labels")
    if not setting:
        return DEFAULT_STAGE_LABELS
    stored = json.loads(setting.value)
    return {**DEFAULT_STAGE_LABELS, **stored}


@router.put("/stage-labels")
def update_stage_labels(
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    allowed = set(DEFAULT_STAGE_LABELS.keys())
    filtered = {k: v for k, v in data.items() if k in allowed and isinstance(v, str) and v.strip()}
    _upsert_setting(db, "stage_labels", json.dumps(filtered))
    return {**DEFAULT_STAGE_LABELS, **filtered}


# ── Cobrador pipeline stage labels ───────────────────────────────────────────

@router.get("/cobrador-stage-labels")
def get_cobrador_stage_labels(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    setting = _get_setting(db, "cobrador_stage_labels")
    if not setting:
        return DEFAULT_COBRADOR_STAGE_LABELS
    stored = json.loads(setting.value)
    return {**DEFAULT_COBRADOR_STAGE_LABELS, **stored}


@router.put("/cobrador-stage-labels")
def update_cobrador_stage_labels(
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    allowed = set(DEFAULT_COBRADOR_STAGE_LABELS.keys())
    filtered = {k: v for k, v in data.items() if k in allowed and isinstance(v, str) and v.strip()}
    _upsert_setting(db, "cobrador_stage_labels", json.dumps(filtered))
    return {**DEFAULT_COBRADOR_STAGE_LABELS, **filtered}


# ── Seguimiento días gracia ───────────────────────────────────────────────────

@router.get("/seguimiento-dias")
def get_seguimiento_dias(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    setting = _get_setting(db, "seguimiento_dias_gracia")
    return {"dias": int(setting.value) if setting else 5}


@router.put("/seguimiento-dias")
def update_seguimiento_dias(
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    dias = max(1, min(365, int(data.get("dias", 5))))
    _upsert_setting(db, "seguimiento_dias_gracia", str(dias))
    return {"dias": dias}


# ── OT Templates ─────────────────────────────────────────────────────────────

def _extract_editable_sections(ot_type: str) -> list:
    from ..utils.ot_templates import OT_CONTENT
    catalog = OT_CONTENT.get(ot_type, [])
    result = []
    for sec_idx, entry in enumerate(catalog):
        if entry.get("kind") != "section":
            continue
        body_blocks = []
        for blk_idx, block in enumerate(entry.get("blocks", [])):
            if block.get("kind") == "body":
                body_blocks.append({"blk_idx": blk_idx, "paragraphs": block.get("paragraphs", [])})
        if body_blocks:
            result.append({"sec_idx": sec_idx, "title": entry["title"], "body_blocks": body_blocks})
    return result


@router.get("/ot-templates")
def list_ot_templates(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    from ..routers.work_orders import OT_TYPES
    result = []
    for key, cfg in OT_TYPES.items():
        setting = _get_setting(db, f"ot_template__{key}")
        result.append({
            "key": key,
            "label": cfg.get("label", key),
            "is_customized": setting is not None,
        })
    return result


@router.get("/ot-templates/{ot_type}")
def get_ot_template(
    ot_type: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    from ..routers.work_orders import OT_TYPES
    if ot_type not in OT_TYPES:
        raise HTTPException(status_code=404, detail="Tipo OT no encontrado")
    sections = _extract_editable_sections(ot_type)
    setting = _get_setting(db, f"ot_template__{ot_type}")
    overrides = json.loads(setting.value) if setting else {}
    for sec in sections:
        for blk in sec["body_blocks"]:
            key = f"sec_{sec['sec_idx']}_blk_{blk['blk_idx']}"
            if key in overrides:
                blk["paragraphs"] = overrides[key]
                blk["is_overridden"] = True
            else:
                blk["is_overridden"] = False
    return {
        "ot_type": ot_type,
        "label": OT_TYPES[ot_type].get("label", ot_type),
        "sections": sections,
    }


@router.put("/ot-templates/{ot_type}")
def update_ot_template(
    ot_type: str,
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    from ..routers.work_orders import OT_TYPES
    if ot_type not in OT_TYPES:
        raise HTTPException(status_code=404, detail="Tipo OT no encontrado")
    overrides = data.get("overrides", {})
    _upsert_setting(db, f"ot_template__{ot_type}", json.dumps(overrides))
    return {"ok": True}


@router.delete("/ot-templates/{ot_type}")
def reset_ot_template(
    ot_type: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if current_user.role not in ("superadmin", "subadmin"):
        raise HTTPException(status_code=403, detail="Sin permiso")
    setting = _get_setting(db, f"ot_template__{ot_type}")
    if setting:
        db.delete(setting)
        db.commit()
    return {"ok": True}

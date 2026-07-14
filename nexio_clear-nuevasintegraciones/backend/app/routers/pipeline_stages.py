from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_roles, get_visible_group_ids

router = APIRouter(prefix="/api/pipeline-stages", tags=["pipeline_stages"])


def _get_negocio_root(db: Session, user: models.User) -> models.Group | None:
    if not user.group_id:
        return None
    g = db.query(models.Group).filter(models.Group.id == user.group_id).first()
    if not g:
        return None
    root_id = g.negocio_id if g.negocio_id else g.id
    return db.query(models.Group).filter(models.Group.id == root_id).first()


@router.get("", response_model=List[schemas.PipelineStageOut])
def list_stages(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role == "tecnico":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    root = _get_negocio_root(db, current_user)
    if not root:
        return []
    return (
        db.query(models.PipelineStage)
        .filter(models.PipelineStage.negocio_id == root.id)
        .order_by(models.PipelineStage.order)
        .all()
    )


@router.post("", response_model=schemas.PipelineStageOut, status_code=201)
def create_stage(
    data: schemas.PipelineStageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
):
    root = _get_negocio_root(db, current_user)
    if not root:
        raise HTTPException(status_code=400, detail="Sin negocio asociado")
    if root.tipo == "abogados":
        raise HTTPException(status_code=400, detail="Los negocios de tipo abogados usan el pipeline fijo")
    existing = db.query(models.PipelineStage).filter(
        models.PipelineStage.negocio_id == root.id,
        models.PipelineStage.key == data.key,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe una etapa con esa clave")
    stage = models.PipelineStage(negocio_id=root.id, **data.model_dump())
    db.add(stage)
    db.commit()
    db.refresh(stage)
    return stage


@router.put("/{stage_id}", response_model=schemas.PipelineStageOut)
def update_stage(
    stage_id: int,
    data: schemas.PipelineStageUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
):
    root = _get_negocio_root(db, current_user)
    stage = db.query(models.PipelineStage).filter(models.PipelineStage.id == stage_id).first()
    if not stage or (root and stage.negocio_id != root.id):
        raise HTTPException(status_code=404, detail="Etapa no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(stage, field, value)
    db.commit()
    db.refresh(stage)
    return stage


@router.delete("/{stage_id}")
def delete_stage(
    stage_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("superadmin", "subadmin")),
):
    root = _get_negocio_root(db, current_user)
    stage = db.query(models.PipelineStage).filter(models.PipelineStage.id == stage_id).first()
    if not stage or (root and stage.negocio_id != root.id):
        raise HTTPException(status_code=404, detail="Etapa no encontrada")
    db.delete(stage)
    db.commit()
    return {"ok": True}

from datetime import datetime, timedelta, timezone
from typing import Optional
import re
import jwt
import bcrypt as _bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
import os
from dotenv import load_dotenv
from .database import get_db
from . import models

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    import secrets as _secrets
    import warnings
    SECRET_KEY = _secrets.token_urlsafe(32)
    warnings.warn(
        "⚠️  SECRET_KEY no configurada en .env — usando clave temporal aleatoria. "
        "Los JWT serán inválidos después de reiniciar. Configura SECRET_KEY en producción.",
        stacklevel=2,
    )
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8h default (ISO 27001 A.9.4.2)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def validate_password_strength(password: str) -> None:
    """ISO 27001 A.9.4.3 — enforce minimum password complexity."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
    if not re.search(r'[A-Z]', password):
        raise HTTPException(status_code=400, detail="La contraseña debe incluir al menos una letra mayúscula")
    if not re.search(r'[a-z]', password):
        raise HTTPException(status_code=400, detail="La contraseña debe incluir al menos una letra minúscula")
    if not re.search(r'\d', password):
        raise HTTPException(status_code=400, detail="La contraseña debe incluir al menos un número")


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)  # type: ignore[arg-type]


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise credentials_exception
    return user


def require_roles(*roles):
    def checker(current_user: models.User = Depends(get_current_user)):
        # tecnico is the root role — can do anything any other role can do
        if current_user.role != "tecnico" and current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Acceso denegado")
        return current_user
    return checker


def require_tecnico(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "tecnico":
        raise HTTPException(status_code=403, detail="Acceso restringido a Técnico")
    return current_user


def get_visible_group_ids(db, user) -> "Optional[list[int]]":
    """
    Returns the list of group IDs the user can access for data queries.
    None means no filter (tecnico or legacy admin without a group assigned).
    superadmin/subadmin are scoped to their negocio: the root group + all sub-groups.
    """
    if user.role == "tecnico":
        return None
    if user.group_id is None:
        return None  # legacy admin without group assigned — keep backward compat
    if user.role in ("superadmin", "subadmin"):
        user_group = db.query(models.Group).filter(models.Group.id == user.group_id).first()
        if not user_group:
            return [user.group_id]
        root_id = user_group.negocio_id if user_group.negocio_id else user_group.id
        sub_ids = [sg.id for sg in db.query(models.Group).filter(models.Group.negocio_id == root_id).all()]
        return [root_id] + sub_ids
    return [user.group_id]

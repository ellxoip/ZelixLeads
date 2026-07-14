"""Web Push Notifications (VAPID) endpoint."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json

from ..database import get_db
from .. import models
from ..auth import get_current_user

router = APIRouter(prefix="/api/push", tags=["push"])


def _get_setting(db: Session, key: str) -> Optional[str]:
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    return s.value if s else None


def _set_setting(db: Session, key: str, value: str):
    s = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if s:
        s.value = value
    else:
        db.add(models.AppSetting(key=key, value=value))
    db.commit()


def _ensure_vapid_keys(db: Session) -> tuple[str, str]:
    """Generate VAPID keys on first call, return (private, public)."""
    priv = _get_setting(db, "vapid_private_key")
    pub = _get_setting(db, "vapid_public_key")
    if priv and pub:
        return priv, pub
    try:
        from py_vapid import Vapid
        vapid = Vapid()
        vapid.generate_keys()
        priv_key = vapid.private_pem().decode()
        pub_key = vapid.public_key.public_bytes(
            __import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding", "PublicFormat"]).Encoding.X962,
            __import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding", "PublicFormat"]).PublicFormat.UncompressedPoint,
        )
        import base64
        pub_b64 = base64.urlsafe_b64encode(pub_key).rstrip(b"=").decode()
        _set_setting(db, "vapid_private_key", priv_key)
        _set_setting(db, "vapid_public_key", pub_b64)
        return priv_key, pub_b64
    except Exception as e:
        print(f"⚠️  VAPID key generation failed: {e}")
        return "", ""


@router.get("/vapid-key")
def get_vapid_public_key(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _, pub = _ensure_vapid_keys(db)
    return {"public_key": pub}


class PushSubscribeIn(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.post("/subscribe")
def subscribe(
    data: PushSubscribeIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    existing = db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == data.endpoint
    ).first()
    if existing:
        existing.user_id = current_user.id
        existing.p256dh = data.p256dh
        existing.auth = data.auth
    else:
        db.add(models.PushSubscription(
            user_id=current_user.id,
            endpoint=data.endpoint,
            p256dh=data.p256dh,
            auth=data.auth,
        ))
    db.commit()
    return {"ok": True}


@router.delete("/unsubscribe")
def unsubscribe(
    endpoint: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == endpoint,
        models.PushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
    return {"ok": True}


def send_push_to_user(db: Session, user_id: int, title: str, body: str, url: str = "/"):
    """Fire-and-forget push to all of a user's subscriptions."""
    subs = db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == user_id
    ).all()
    if not subs:
        return

    priv, pub = _ensure_vapid_keys(db)
    if not priv:
        return

    # Load VAPID key as a Vapid instance (PEM stored in DB) so pywebpush
    # doesn't try to parse it as base64url/DER and fail.
    try:
        from py_vapid import Vapid
        vapid_obj = Vapid.from_pem(priv.encode())
    except Exception as e:
        print(f"⚠️  VAPID key load failed: {e}")
        return

    payload = json.dumps({"title": title, "body": body, "url": url})

    dead = []
    for sub in subs:
        try:
            from pywebpush import webpush, WebPushException
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=vapid_obj,
                vapid_claims={"sub": "mailto:raul@hashtagcl.com"},
            )
        except Exception as e:
            err = str(e)
            print(f"⚠️  Push send failed for sub {sub.id}: {err[:120]}")
            if "410" in err or "404" in err or "400" in err:
                dead.append(sub.id)

    if dead:
        db.query(models.PushSubscription).filter(
            models.PushSubscription.id.in_(dead)
        ).delete()
        db.commit()

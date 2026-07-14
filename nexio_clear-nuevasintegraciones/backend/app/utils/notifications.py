from sqlalchemy.orm import Session
from .. import models


def create_notification(
    db: Session,
    user_id: int,
    title: str,
    message: str,
    lead_id: int = None,
    event_id: int = None,
    notification_type: str = "general"
):
    notif = models.Notification(
        user_id=user_id,
        title=title,
        message=message,
        lead_id=lead_id,
        event_id=event_id,
        notification_type=notification_type,
    )
    db.add(notif)
    db.flush()

    # Real-time: tell the target user's frontend to refresh notification count
    try:
        from ..broadcaster import wa_broadcaster
        wa_broadcaster.broadcast_sync("notification_update", {"user_id": user_id})
    except Exception:
        pass

    # Fire web push (best-effort, non-blocking)
    try:
        from ..routers.push import send_push_to_user
        url = f"/leads?chat={lead_id}" if lead_id else ("/" if not event_id else "/calendario")
        send_push_to_user(db, user_id, title, message, url)
    except Exception:
        pass

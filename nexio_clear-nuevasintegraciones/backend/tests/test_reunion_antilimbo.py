"""Regresión anti-limbo de la etapa Reunión.

Cubre las dos salidas que evitan que un lead quede atascado en 'reunion':
  1. La agendadora puede descartar (papelera) un lead que está en Reunión.
  2. Borrar la reunión agendada devuelve el lead a 'lead' (no lo deja huérfano).
"""
from datetime import datetime

from app import models


def _prep_reunion_lead(db, test_lead, test_contact, test_vendedor):
    """Deja el lead en 'reunion' con un evento de reunión y datos completos."""
    test_contact.rut_persona = "12.345.678-9"
    test_contact.name = "Juan Pérez"
    test_contact.email = "juan@test.com"
    ev = models.CalendarEvent(
        title="Reunión inicial",
        start_time=datetime(2026, 7, 10, 10, 0, 0),
        end_time=datetime(2026, 7, 10, 10, 30, 0),
        event_type="reunion",
        lead_id=test_lead.id,
        assigned_to=test_vendedor.id,
        created_by=test_vendedor.id,
    )
    test_lead.current_stage = "reunion"
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


def test_agendadora_puede_descartar_lead_en_reunion(
    client, db, auth_headers_agendadora, test_lead, test_contact, test_vendedor
):
    """Antes daba 403; ahora la agendadora puede mandar a papelera desde Reunión."""
    _prep_reunion_lead(db, test_lead, test_contact, test_vendedor)
    resp = client.post(
        f"/api/leads/{test_lead.id}/move-stage",
        json={"stage": "papelera", "notes": "descartado"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["current_stage"] == "papelera"


def test_borrar_reunion_devuelve_lead_a_lead(
    client, db, auth_headers_admin, test_lead, test_contact, test_vendedor
):
    """Borrar la última reunión de un lead en 'reunion' lo regresa a 'lead'."""
    ev = _prep_reunion_lead(db, test_lead, test_contact, test_vendedor)
    resp = client.delete(f"/api/calendar/{ev.id}", headers=auth_headers_admin)
    assert resp.status_code == 200, resp.text
    assert resp.json().get("lead_reverted") is True
    db.refresh(test_lead)
    assert test_lead.current_stage == "lead"

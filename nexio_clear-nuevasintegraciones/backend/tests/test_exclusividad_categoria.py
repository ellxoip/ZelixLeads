"""Exclusividad de categoría por RUT — el duplicado se bloquea al AGENDAR.

Un mismo cliente (RUT) no puede tener dos casos de la misma categoría (área)
avanzando en paralelo. La validación debe dispararse ya en el agendamiento
(crear reunión / mover a 'reunion'), no recién en la etapa de pago.
"""
from datetime import datetime

from app import models


def _make_rival(db, test_contact, test_area, test_group, test_superadmin,
                test_agendadora, test_vendedor, stage):
    """Crea un segundo lead del MISMO contacto/área ya activo en `stage`."""
    test_contact.rut_persona = "12.345.678-9"
    test_contact.name = "Juan Pérez"
    test_contact.email = "juan@test.com"
    rival = models.Lead(
        contact_id=test_contact.id,
        area_id=test_area.id,
        current_stage=stage,
        group_id=test_group.id,
        agendadora_id=test_agendadora.id,
        vendedor_id=test_vendedor.id,
        honorarios=500000,
    )
    db.add(rival)
    db.commit()
    db.refresh(rival)
    return rival


def test_agendar_reunion_bloqueado_si_categoria_ocupada(
    client, db, auth_headers_admin, test_lead, test_contact, test_area,
    test_group, test_superadmin, test_agendadora, test_vendedor
):
    """Crear una reunión para un lead cuya categoría ya está ocupada → 400."""
    _make_rival(db, test_contact, test_area, test_group, test_superadmin, test_agendadora,
                test_vendedor, stage="reunion")
    resp = client.post("/api/calendar", json={
        "title": "Reunión duplicada",
        "start_time": "2026-07-10T10:00:00",
        "end_time": "2026-07-10T10:30:00",
        "event_type": "reunion",
        "lead_id": test_lead.id,
        "assigned_to": test_vendedor.id,
    }, headers=auth_headers_admin)
    assert resp.status_code == 400, resp.text
    assert "categoría" in resp.json()["detail"].lower()


def test_mover_a_reunion_bloqueado_si_categoria_ocupada(
    client, db, auth_headers_admin, test_lead, test_contact, test_area,
    test_group, test_superadmin, test_agendadora, test_vendedor
):
    """Mover el lead a 'reunion' cuando la categoría ya está ocupada → 400."""
    _make_rival(db, test_contact, test_area, test_group, test_superadmin, test_agendadora,
                test_vendedor, stage="cierre")
    resp = client.post(
        f"/api/leads/{test_lead.id}/move-stage",
        json={"stage": "reunion"},
        headers=auth_headers_admin,
    )
    assert resp.status_code == 400, resp.text
    assert "categoría" in resp.json()["detail"].lower()


def test_agendar_permitido_sin_duplicado(
    client, db, auth_headers_admin, test_lead, test_contact, test_vendedor
):
    """Sin caso rival en la categoría, agendar funciona normalmente."""
    test_contact.rut_persona = "12.345.678-9"
    test_contact.name = "Juan Pérez"
    test_contact.email = "juan@test.com"
    db.commit()
    resp = client.post("/api/calendar", json={
        "title": "Reunión OK",
        "start_time": "2026-07-10T10:00:00",
        "end_time": "2026-07-10T10:30:00",
        "event_type": "reunion",
        "lead_id": test_lead.id,
        "assigned_to": test_vendedor.id,
    }, headers=auth_headers_admin)
    assert resp.status_code == 200, resp.text

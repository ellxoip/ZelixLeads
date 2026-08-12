"""
Ladrillo 2 — agendar desde WhatsApp.

Se prueba lo que cuesta dinero cuando falla: que no se ofrezca un horario ya
tomado, que dos personas no se queden con el mismo bloque, y que la puerta no
esté abierta a cualquiera. El camino feliz es el caso fácil.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from app import models
from app.routers import agenda_whatsapp as ag

TZ = ZoneInfo("America/Santiago")
SECRETO = "secreto-de-prueba"
H = {"x-crm-callback-secret": SECRETO}


@pytest.fixture(autouse=True)
def con_secreto(monkeypatch):
    monkeypatch.setattr(ag, "SECRETO", SECRETO)


@pytest.fixture()
def lead(db, test_group, test_contact, test_area, test_agendadora, test_vendedor):
    l = models.Lead(contact_id=test_contact.id, area_id=test_area.id, group_id=test_group.id,
                    agendadora_id=test_agendadora.id, vendedor_id=test_vendedor.id,
                    current_stage="lead", source="whatsapp")
    db.add(l); db.commit(); db.refresh(l)
    return l


def _slots(client, lead_id, **kw):
    r = client.get("/api/agenda-wa/disponibilidad", params={"lead_id": lead_id, **kw}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["slots"]


# ── La puerta ───────────────────────────────────────────────────────────────

def test_sin_secreto_no_se_entra(client, lead):
    assert client.get("/api/agenda-wa/disponibilidad", params={"lead_id": lead.id}).status_code == 401
    assert client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": "2027-01-01T12:00:00Z"}).status_code == 401


def test_secreto_equivocado_tampoco(client, lead):
    r = client.get("/api/agenda-wa/disponibilidad", params={"lead_id": lead.id},
                   headers={"x-crm-callback-secret": "otro"})
    assert r.status_code == 401


# ── Lo que se ofrece ────────────────────────────────────────────────────────

def test_ofrece_como_mucho_tres(client, lead):
    """WhatsApp admite tres botones. Un cuarto no se puede mostrar."""
    assert len(_slots(client, lead.id, dias=7, limite=10)) <= 3


def test_solo_en_horario_habil_y_dias_de_semana(client, lead):
    for s in _slots(client, lead.id, dias=7):
        local = datetime.fromisoformat(s["inicio"]).astimezone(TZ)
        assert ag.HORA_DESDE <= local.hour < ag.HORA_HASTA, f"ofreció {local}"
        assert local.weekday() < 5, f"ofreció un fin de semana: {local}"


def test_nunca_ofrece_algo_inmediato_ni_pasado(client, lead):
    minimo = datetime.now(timezone.utc) + timedelta(minutes=ag.ANTICIPACION_MIN)
    for s in _slots(client, lead.id, dias=7):
        assert datetime.fromisoformat(s["inicio"]) >= minimo


def test_no_ofrece_un_bloque_ya_ocupado(client, db, lead):
    libres = _slots(client, lead.id, dias=7)
    assert libres, "no hay huecos para la prueba"
    tomado = datetime.fromisoformat(libres[0]["inicio"])
    db.add(models.CalendarEvent(
        title="Ocupado", created_by=lead.agendadora_id, assigned_to=lead.vendedor_id,
        start_time=tomado, end_time=tomado + timedelta(minutes=ag.DURACION_MIN), event_type="reunion"))
    db.commit()

    de_nuevo = [s["inicio"] for s in _slots(client, lead.id, dias=7)]
    assert libres[0]["inicio"] not in de_nuevo, "sigue ofreciendo un horario que ya está tomado"


def test_la_etiqueta_cabe_en_un_boton(client, lead):
    for s in _slots(client, lead.id, dias=7):
        assert len(s["etiqueta"]) <= 20, f"WhatsApp corta esto: {s['etiqueta']!r}"


# ── La reserva ──────────────────────────────────────────────────────────────

def test_reservar_crea_el_evento_y_mueve_el_lead(client, db, lead):
    s = _slots(client, lead.id, dias=7)[0]
    r = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    assert r.status_code == 200, r.text

    ev = db.query(models.CalendarEvent).filter(models.CalendarEvent.lead_id == lead.id).first()
    assert ev is not None and ev.assigned_to == lead.vendedor_id
    db.refresh(lead)
    assert lead.current_stage == "reunion", "el lead no avanzó de etapa"


def test_dos_personas_no_se_quedan_con_el_mismo_bloque(client, db, lead):
    """El caso normal al ofrecer las mismas tres opciones a varios leads."""
    s = _slots(client, lead.id, dias=7)[0]
    primero = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    assert primero.status_code == 200
    segundo = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    assert segundo.status_code == 409, "el mismo bloque se entregó dos veces"
    assert db.query(models.CalendarEvent).filter(models.CalendarEvent.start_time == datetime.fromisoformat(s["inicio"])).count() == 1


def test_no_se_reserva_en_el_pasado(client, lead):
    ayer = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": ayer}, headers=H)
    assert r.status_code == 409


def test_lead_inexistente(client):
    assert client.get("/api/agenda-wa/disponibilidad", params={"lead_id": 999999}, headers=H).status_code == 404

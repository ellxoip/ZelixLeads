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


def test_dos_clientes_distintos_no_se_quedan_con_el_mismo_bloque(client, db, lead, test_group, test_area, test_agendadora, test_vendedor):
    """Dos personas distintas compartiendo vendedor: el empate es el caso normal
    cuando se ofrecen las mismas tres opciones a varios leads."""
    otro_contacto = models.Contact(name="Otro", phone="+56922222222",
                                   group_id=test_group.id, created_by=test_agendadora.id)
    db.add(otro_contacto); db.commit(); db.refresh(otro_contacto)
    otro = models.Lead(contact_id=otro_contacto.id, area_id=test_area.id, group_id=test_group.id,
                       agendadora_id=test_agendadora.id, vendedor_id=test_vendedor.id,
                       current_stage="lead", source="whatsapp")
    db.add(otro); db.commit(); db.refresh(otro)

    s = _slots(client, lead.id, dias=7)[0]
    assert client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H).status_code == 200
    segundo = client.post("/api/agenda-wa/reservar", json={"lead_id": otro.id, "inicio": s["inicio"]}, headers=H)
    assert segundo.status_code == 409, "el mismo bloque se entregó a dos clientes"
    assert db.query(models.CalendarEvent).filter(
        models.CalendarEvent.start_time == datetime.fromisoformat(s["inicio"])).count() == 1


def test_tocar_dos_veces_el_mismo_boton_no_asusta_al_cliente(client, db, lead):
    """Su propia reunión NO es un choque: decirle 'ese horario lo acaban de
    tomar' cuando lo tomó él mismo es mentirle."""
    s = _slots(client, lead.id, dias=7)[0]
    primero = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    segundo = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    assert segundo.status_code == 200, segundo.text
    assert segundo.json()["ya_estaba"] is True
    assert segundo.json()["evento_id"] == primero.json()["evento_id"]
    assert db.query(models.CalendarEvent).filter(models.CalendarEvent.lead_id == lead.id).count() == 1


def test_pedir_otra_hora_REAGENDA_en_vez_de_duplicar(client, db, lead):
    """Dos reuniones para el mismo cliente le bloquean al vendedor una hora que
    nadie va a usar, y el cliente cree que cambió la suya."""
    libres = _slots(client, lead.id, dias=7, limite=3)
    assert len(libres) >= 2, "hacen falta dos huecos para la prueba"
    client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": libres[0]["inicio"]}, headers=H)
    r = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": libres[1]["inicio"]}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["reagendada"] is True
    assert db.query(models.CalendarEvent).filter(models.CalendarEvent.lead_id == lead.id).count() == 1, "quedaron dos reuniones"
    ev = db.query(models.CalendarEvent).filter(models.CalendarEvent.lead_id == lead.id).first()
    assert ev.start_time.replace(tzinfo=timezone.utc) == datetime.fromisoformat(libres[1]["inicio"])


def test_mi_reunion_dice_si_ya_tiene_hora(client, db, lead):
    assert client.get("/api/agenda-wa/mi-reunion", params={"lead_id": lead.id}, headers=H).json()["reunion"] is None
    s = _slots(client, lead.id, dias=7)[0]
    client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    r = client.get("/api/agenda-wa/mi-reunion", params={"lead_id": lead.id}, headers=H).json()
    assert r["reunion"]["etiqueta"] == s["etiqueta"]


def test_cancelar_libera_el_bloque(client, db, lead):
    """Sin salida, el cliente que no puede asistir se queda callado y el
    vendedor viaja igual."""
    s = _slots(client, lead.id, dias=7)[0]
    client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": s["inicio"]}, headers=H)
    r = client.post("/api/agenda-wa/cancelar", json={"lead_id": lead.id}, headers=H)
    assert r.status_code == 200 and r.json()["cancelada"] is True
    assert db.query(models.CalendarEvent).filter(models.CalendarEvent.lead_id == lead.id).count() == 0
    # Y el hueco vuelve a ofrecerse: si no, cancelar dejaría la hora muerta.
    assert s["inicio"] in [x["inicio"] for x in _slots(client, lead.id, dias=7)]


def test_cancelar_sin_reunion_no_revienta(client, lead):
    r = client.post("/api/agenda-wa/cancelar", json={"lead_id": lead.id}, headers=H)
    assert r.status_code == 200 and r.json()["cancelada"] is False


def test_no_se_reserva_en_el_pasado(client, lead):
    ayer = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = client.post("/api/agenda-wa/reservar", json={"lead_id": lead.id, "inicio": ayer}, headers=H)
    assert r.status_code == 409


def test_lead_inexistente(client):
    assert client.get("/api/agenda-wa/disponibilidad", params={"lead_id": 999999}, headers=H).status_code == 404

"""
Puente Zelix → CRM (ladrillo 1 de la fusión).

Meta entrega el webhook a UNA sola URL por app, y esa URL es la de Zelix. Desde
la fusión, este endpoint ya no recibe de Meta: recibe de Zelix. Estas pruebas
cubren las dos formas en que eso se rompe en silencio y nadie se entera:

 1. **El endpoint queda abierto.** Acá nunca se validó la firma de Meta, así que
    el secreto compartido es lo único que impide que cualquiera inyecte
    conversaciones falsas y ensucie el pipeline.

 2. **El mensaje entra pero no nace el lead.** La creación automática de leads
    vivía solo en el receptor de Baileys; al retirarlo, el mensaje quedaba en el
    inbox y fuera del tablero. Es el peor de los fallos porque no da error: el
    prospecto simplemente no existe para el equipo.
"""
import pytest
from app import models
from app.routers import webhooks

SECRETO = "secreto-de-prueba"
PHONE_ID = "111222333"


def _payload(texto="hola", wamid="wamid.UNO", de="56911111111", nombre="Prospecto"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "0", "changes": [{"field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "+56 9 9412 4779", "phone_number_id": PHONE_ID},
            "contacts": [{"profile": {"name": nombre}, "wa_id": de}],
            "messages": [{"from": de, "id": wamid, "timestamp": "1", "type": "text", "text": {"body": texto}}],
        }}]}],
    }


@pytest.fixture()
def con_secreto(monkeypatch):
    monkeypatch.setattr(webhooks, "ZELIX_FORWARD_SECRET", SECRETO)


@pytest.fixture()
def entorno(db, test_group, test_agendadora):
    """Config de WhatsApp con área, agendadora y vendedor: todo lo que un lead exige."""
    vendedor = models.User(
        name="Vendedor Test", email="vendedor@test.com",
        password_hash="x", role="vendedor", group_id=test_group.id, is_active=True,
    )
    db.add(vendedor)
    cfg = models.WhatsAppConfig(
        name="Zelix oficial", phone_number="+56994124779", phone_number_id=PHONE_ID,
        api_provider="meta", group_id=test_group.id, owner_user_id=test_agendadora.id,
        is_active=True,
    )
    db.add(cfg)
    db.commit()
    area = models.Area(name="Zelix — Ventas", group_id=test_group.id, whatsapp_config_id=cfg.id)
    db.add(area)
    db.commit()
    return {"cfg": cfg, "area": area, "vendedor": vendedor, "agendadora": test_agendadora}


# ── El secreto ──────────────────────────────────────────────────────────────

def test_sin_secreto_se_rechaza(client, con_secreto):
    r = client.post("/api/webhook/whatsapp", json=_payload())
    assert r.status_code == 401


def test_secreto_equivocado_se_rechaza(client, con_secreto):
    r = client.post("/api/webhook/whatsapp", json=_payload(), headers={"x-crm-callback-secret": "otro"})
    assert r.status_code == 401


def test_sin_secreto_configurado_queda_abierto(client, db, entorno):
    """Retrocompatible a propósito: sin la variable seteada se comporta como antes."""
    r = client.post("/api/webhook/whatsapp", json=_payload())
    assert r.status_code == 200


# ── El lead ─────────────────────────────────────────────────────────────────

def test_una_conversacion_nueva_crea_lead(client, db, entorno, con_secreto):
    r = client.post("/api/webhook/whatsapp", json=_payload(texto="quiero información"),
                    headers={"x-crm-callback-secret": SECRETO})
    assert r.status_code == 200

    contacto = db.query(models.Contact).filter(models.Contact.phone == "+56911111111").first()
    assert contacto is not None, "el contacto no se creó"

    lead = db.query(models.Lead).filter(models.Lead.contact_id == contacto.id).first()
    assert lead is not None, "entró el mensaje pero NO nació el lead: queda fuera del pipeline"
    assert lead.current_stage == "lead"
    assert lead.source == "whatsapp"
    assert lead.area_id == entorno["area"].id
    assert lead.agendadora_id == entorno["agendadora"].id
    assert lead.vendedor_id == entorno["vendedor"].id

    msg = db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.contact_id == contacto.id).first()
    assert msg is not None and msg.lead_id == lead.id, "el mensaje quedó suelto, sin colgar del lead"


def test_segundo_mensaje_no_duplica_el_lead(client, db, entorno, con_secreto):
    h = {"x-crm-callback-secret": SECRETO}
    client.post("/api/webhook/whatsapp", json=_payload(wamid="wamid.UNO"), headers=h)
    client.post("/api/webhook/whatsapp", json=_payload(texto="sigo ahí", wamid="wamid.DOS"), headers=h)

    contacto = db.query(models.Contact).filter(models.Contact.phone == "+56911111111").first()
    leads = db.query(models.Lead).filter(models.Lead.contact_id == contacto.id).all()
    assert len(leads) == 1, "cada mensaje estaría abriendo un lead nuevo: el tablero se llena de duplicados"
    assert db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.contact_id == contacto.id).count() == 2


def test_wamid_repetido_no_se_procesa_dos_veces(client, db, entorno, con_secreto):
    """Reintentar es seguro: es lo que permite que la cola durable de Zelix exista."""
    h = {"x-crm-callback-secret": SECRETO}
    client.post("/api/webhook/whatsapp", json=_payload(wamid="wamid.MISMO"), headers=h)
    client.post("/api/webhook/whatsapp", json=_payload(wamid="wamid.MISMO"), headers=h)

    contacto = db.query(models.Contact).filter(models.Contact.phone == "+56911111111").first()
    assert db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.contact_id == contacto.id).count() == 1


def test_sin_area_no_se_pierde_el_mensaje(client, db, test_group, test_agendadora, con_secreto):
    """Falta contexto para el lead: no se inventa un área, pero el mensaje se guarda igual."""
    cfg = models.WhatsAppConfig(
        name="Sin área", phone_number="+56994124779", phone_number_id=PHONE_ID,
        api_provider="meta", group_id=test_group.id, owner_user_id=test_agendadora.id, is_active=True,
    )
    db.add(cfg)
    db.commit()

    r = client.post("/api/webhook/whatsapp", json=_payload(), headers={"x-crm-callback-secret": SECRETO})
    assert r.status_code == 200

    contacto = db.query(models.Contact).filter(models.Contact.phone == "+56911111111").first()
    assert contacto is not None
    assert db.query(models.Lead).filter(models.Lead.contact_id == contacto.id).count() == 0
    msg = db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.contact_id == contacto.id).first()
    assert msg is not None, "sin lead se perdió también el mensaje: eso sí es perder al prospecto"


def test_numero_desconocido_no_crea_nada(client, db, entorno, con_secreto):
    """Un phone_number_id que no es nuestro se ignora: no se adopta tráfico ajeno."""
    p = _payload()
    p["entry"][0]["changes"][0]["value"]["metadata"] = {
        "display_phone_number": "+56 9 0000 0000", "phone_number_id": "999999999"
    }
    r = client.post("/api/webhook/whatsapp", json=p, headers={"x-crm-callback-secret": SECRETO})
    assert r.status_code == 200
    assert db.query(models.Lead).count() == 0
    assert db.query(models.WhatsAppMessage).count() == 0

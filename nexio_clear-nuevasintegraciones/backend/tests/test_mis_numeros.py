"""
Mis números — cada usuario vincula SU WhatsApp, sin poder tocar el de otro.

Lo que se protege acá no es la comodidad de una pantalla: el webhook empareja
los mensajes entrantes por `phone_number_id`. Si dos usuarios de negocios
distintos registraran el mismo, las conversaciones de un negocio aparecerían en
el CRM del otro. Por eso se prueban los dos cerrojos y el aislamiento, no el
camino feliz.
"""
import pytest
from app import models
from app.routers import mis_numeros
from app.auth import hash_password

RUTA = "/api/whatsapp/mis-numeros"


@pytest.fixture(autouse=True)
def meta_dice_que_si(monkeypatch):
    """Por defecto Meta confirma. Los tests que prueban el rechazo lo cambian."""
    async def ok(pnid, token):
        return {"display_phone_number": "+56 9 1111 1111", "verified_name": "Negocio"}
    monkeypatch.setattr(mis_numeros, "_verificar_en_meta", ok)


def _usuario(db, email, group_id, role="agendadora"):
    u = models.User(name=email, email=email, password_hash=hash_password("Test1234"),
                    role=role, group_id=group_id, is_active=True)
    db.add(u); db.commit(); db.refresh(u)
    return u


def _token(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "Test1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def dos_inquilinos(db, test_group):
    otro = models.Group(name="Otro Negocio", tipo="pyme", plan="basico")
    db.add(otro); db.commit(); db.refresh(otro)
    return _usuario(db, "ana@uno.cl", test_group.id), _usuario(db, "beto@dos.cl", otro.id)


def test_vincula_y_el_servidor_pone_el_dueno(client, db, dos_inquilinos):
    ana, _ = dos_inquilinos
    r = client.post(RUTA, json={"phone_number_id": "111", "api_token": "T"}, headers=_token(client, ana.email))
    assert r.status_code == 201, r.text

    cfg = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.phone_number_id == "111").first()
    assert cfg.owner_user_id == ana.id, "el dueño debe salir de la sesión"
    assert cfg.group_id == ana.group_id, "el negocio debe salir de la sesión"
    assert cfg.api_provider == "meta"
    assert cfg.phone_number == "+56911111111", "el teléfono lo dicta Meta, no quien lo escribe"


def test_cada_uno_ve_solo_lo_suyo(client, db, dos_inquilinos):
    ana, beto = dos_inquilinos
    client.post(RUTA, json={"phone_number_id": "111", "api_token": "T"}, headers=_token(client, ana.email))
    client.post(RUTA, json={"phone_number_id": "222", "api_token": "T"}, headers=_token(client, beto.email))

    de_ana = client.get(RUTA, headers=_token(client, ana.email)).json()
    assert [c["phone_number_id"] for c in de_ana] == ["111"], "Ana está viendo números ajenos"
    de_beto = client.get(RUTA, headers=_token(client, beto.email)).json()
    assert [c["phone_number_id"] for c in de_beto] == ["222"]


def test_no_se_puede_desvincular_el_de_otro(client, db, dos_inquilinos):
    ana, beto = dos_inquilinos
    client.post(RUTA, json={"phone_number_id": "111", "api_token": "T"}, headers=_token(client, ana.email))
    cfg = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.phone_number_id == "111").first()

    r = client.delete(f"{RUTA}/{cfg.id}", headers=_token(client, beto.email))
    assert r.status_code == 404, "para quien no es dueño, la fila no debe ni existir"
    assert db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.id == cfg.id).first() is not None


def test_un_numero_ya_reclamado_no_se_roba(client, db, dos_inquilinos):
    """El agujero grave: quedarse con el phone_number_id de otro desvía SUS mensajes."""
    ana, beto = dos_inquilinos
    client.post(RUTA, json={"phone_number_id": "111", "api_token": "T"}, headers=_token(client, ana.email))

    r = client.post(RUTA, json={"phone_number_id": "111", "api_token": "OTRO"}, headers=_token(client, beto.email))
    assert r.status_code == 409
    cfg = db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.phone_number_id == "111").first()
    assert cfg.owner_user_id == ana.id, "el número cambió de dueño: los mensajes de Ana irían a Beto"


def test_si_meta_no_confirma_no_se_guarda(client, db, dos_inquilinos, monkeypatch):
    """Sin esto, el cerrojo anterior protegería al primero que llegue, no al dueño."""
    from fastapi import HTTPException
    async def rechaza(pnid, token):
        raise HTTPException(status_code=400, detail="Meta rechazó estos datos")
    monkeypatch.setattr(mis_numeros, "_verificar_en_meta", rechaza)

    ana, _ = dos_inquilinos
    r = client.post(RUTA, json={"phone_number_id": "999", "api_token": "robado"}, headers=_token(client, ana.email))
    assert r.status_code == 400
    assert db.query(models.WhatsAppConfig).filter(models.WhatsAppConfig.phone_number_id == "999").first() is None


def test_sin_sesion_no_se_entra(client):
    assert client.get(RUTA).status_code == 401
    assert client.post(RUTA, json={"phone_number_id": "1", "api_token": "T"}).status_code == 401

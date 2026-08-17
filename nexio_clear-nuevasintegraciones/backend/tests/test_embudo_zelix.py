"""
Embudo por etapa — la fuente de las peceras de Zelix (fase 2, §12.9.2).

Lo que se prueba no es el camino feliz: es que este endpoint **no pueda mentir**.
Un conteo que devuelve 0 cuando en realidad no tiene de dónde leer es peor que no
tenerlo, porque le diría a Zelix "medí y no hay nadie" cuando la verdad es "el
número no está configurado". Esa confusión es exactamente la que tumbó la purga
que devolvía 0 sin borrar nada.
"""
import pytest
from app import models
from app.routers import embudo_zelix as ez

SECRETO = "secreto-de-prueba"
H = {"x-crm-callback-secret": SECRETO}
PNI = "1164312330107171"


@pytest.fixture(autouse=True)
def con_secreto(monkeypatch):
    monkeypatch.setattr(ez, "SECRETO", SECRETO)


@pytest.fixture()
def config_wa(db, test_group):
    c = models.WhatsAppConfig(group_id=test_group.id, phone_number_id=PNI, name="Zelix",
                              phone_number="+56900000000", is_active=True)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _lead(db, grupo, contacto, area, agendadora, vendedor, etapa):
    l = models.Lead(contact_id=contacto.id, area_id=area.id, group_id=grupo.id,
                    agendadora_id=agendadora.id, vendedor_id=vendedor.id,
                    current_stage=etapa, source="whatsapp")
    db.add(l)
    db.commit()
    return l


# ── La puerta ───────────────────────────────────────────────────────────────

def test_sin_secreto_no_se_entra(client, config_wa):
    assert client.get("/api/embudo/conteo", params={"phone_number_id": PNI}).status_code == 401


def test_secreto_equivocado_tampoco(client, config_wa):
    r = client.get("/api/embudo/conteo", params={"phone_number_id": PNI},
                   headers={"x-crm-callback-secret": "otro"})
    assert r.status_code == 401


def test_sin_secreto_configurado_la_ruta_no_existe(client, config_wa, monkeypatch):
    """Dejarla abierta expondría el tamaño del embudo de cualquier negocio."""
    monkeypatch.setattr(ez, "SECRETO", "")
    assert client.get("/api/embudo/conteo", params={"phone_number_id": PNI}, headers=H).status_code == 404


# ── Lo que NO puede hacer: inventar un cero ─────────────────────────────────

def test_numero_sin_configuracion_responde_404_y_NO_un_embudo_en_cero(client, db):
    r = client.get("/api/embudo/conteo", params={"phone_number_id": "999-no-existe"}, headers=H)
    assert r.status_code == 404
    assert "no hay de dónde leer" in r.json()["detail"]


# ── Lo que sí cuenta ────────────────────────────────────────────────────────

def test_cuenta_por_etapa_declarada(client, db, config_wa, test_group, test_contact, test_area,
                                    test_agendadora, test_vendedor):
    for clave, nombre, orden in [("audiencia", "Audiencia", 1), ("contacto", "Contacto", 2)]:
        db.add(models.PipelineStage(negocio_id=test_group.id, key=clave, name=nombre, order=orden))
    db.commit()
    _lead(db, test_group, test_contact, test_area, test_agendadora, test_vendedor, "audiencia")
    _lead(db, test_group, test_contact, test_area, test_agendadora, test_vendedor, "audiencia")
    _lead(db, test_group, test_contact, test_area, test_agendadora, test_vendedor, "contacto")

    d = client.get("/api/embudo/conteo", params={"phone_number_id": PNI}, headers=H).json()
    porClave = {e["key"]: e["leads"] for e in d["etapas"]}
    assert porClave == {"audiencia": 2, "contacto": 1}
    assert d["total_leads"] == 3


def test_una_etapa_declarada_y_vacia_vale_CERO_no_desaparece(client, db, config_wa, test_group):
    """Cero medido es información. Que la etapa no aparezca sería otra cosa."""
    db.add(models.PipelineStage(negocio_id=test_group.id, key="audiencia", name="Audiencia", order=1))
    db.commit()
    d = client.get("/api/embudo/conteo", params={"phone_number_id": PNI}, headers=H).json()
    assert d["etapas"] == [{"key": "audiencia", "name": "Audiencia", "orden": 1, "leads": 0}]


def test_un_lead_en_etapa_no_declarada_no_se_pierde(client, db, config_wa, test_group, test_contact,
                                                    test_area, test_agendadora, test_vendedor):
    """Si desapareciera del conteo, el total no cuadraría y nadie sabría por qué."""
    _lead(db, test_group, test_contact, test_area, test_agendadora, test_vendedor, "reunion")
    d = client.get("/api/embudo/conteo", params={"phone_number_id": PNI}, headers=H).json()
    assert d["etapas"] == []
    assert d["sin_declarar"] == [{"key": "reunion", "leads": 1}]
    assert d["total_leads"] == 1


def test_negocio_sin_etapas_lo_dice_con_una_lista_vacia(client, db, config_wa):
    """Lista vacía = el negocio no tiene pipeline configurado. Es un dato, no un error."""
    d = client.get("/api/embudo/conteo", params={"phone_number_id": PNI}, headers=H).json()
    assert d["etapas"] == []
    assert d["total_leads"] == 0

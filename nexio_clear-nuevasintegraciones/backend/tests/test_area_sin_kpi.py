"""
Un área creada FUERA del ORM no puede tumbar la API.

Esto ocurrió de verdad: al sembrar el área "Zelix — Ventas" con un INSERT
directo, `kpi_leads` quedó en NULL —su valor por defecto vivía en SQLAlchemy,
no en la base— y el esquema de salida lo exige entero. Resultado: **todos** los
endpoints que serializan un lead con su área devolvían 500, y el navegador lo
reportaba como un bloqueo de CORS porque una excepción sin manejar no lleva esas
cabeceras. El CRM entero se veía caído por una columna nula.
"""
from sqlalchemy import text
from app import models


def test_el_area_nace_con_kpi_aunque_se_inserte_a_mano(db, test_group):
    """La base pone el valor, no el ORM: por eso se inserta con SQL crudo."""
    db.execute(text("INSERT INTO areas (name, group_id) VALUES ('Sin KPI', :g)"), {"g": test_group.id})
    db.commit()
    area = db.query(models.Area).filter(models.Area.name == "Sin KPI").first()
    assert area is not None
    assert area.kpi_leads is not None, "kpi_leads quedó NULL: la serialización de leads se cae con 500"
    assert area.is_active is not None


def test_un_lead_de_esa_area_se_puede_serializar(client, db, test_group, test_contact,
                                                 test_superadmin, test_agendadora, test_vendedor):
    """La prueba de fondo: que el endpoint responda, no que la columna exista."""
    db.execute(text("INSERT INTO areas (name, group_id) VALUES ('Área cruda', :g)"), {"g": test_group.id})
    db.commit()
    area = db.query(models.Area).filter(models.Area.name == "Área cruda").first()
    lead = models.Lead(contact_id=test_contact.id, area_id=area.id, group_id=test_group.id,
                       agendadora_id=test_agendadora.id, vendedor_id=test_vendedor.id,
                       current_stage="lead", source="whatsapp")
    db.add(lead); db.commit(); db.refresh(lead)

    r = client.post("/api/auth/login", json={"email": test_superadmin.email, "password": "Test1234"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    resp = client.get(f"/api/leads/{lead.id}", headers=h)
    assert resp.status_code == 200, f"500 aquí = el CRM entero caído: {resp.text[:200]}"

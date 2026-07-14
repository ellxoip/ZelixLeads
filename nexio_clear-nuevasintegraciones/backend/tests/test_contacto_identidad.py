"""Protección de identidad del contacto (RUT + nombre) y RUT único.

El RUT es la llave que une Nexio ↔ Control ↔ Finanzas. Editar el nombre o el RUT
de un contacto que ya tiene RUT desincroniza la identidad aguas abajo. Reglas:
  · Con RUT asignado, nombre/razón social/RUT quedan bloqueados salvo superadmin.
  · Un RUT no puede pertenecer a dos contactos distintos.
"""


def _set_rut(db, contact, rut="12.345.678-9"):
    contact.rut_persona = rut
    db.commit()


def test_agendadora_no_puede_cambiar_nombre_con_rut(
    client, db, auth_headers_agendadora, test_contact
):
    _set_rut(db, test_contact)
    resp = client.put(
        f"/api/contacts/{test_contact.id}",
        json={"name": "Otro Nombre"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 400, resp.text
    assert "identidad" in resp.json()["detail"].lower()


def test_agendadora_no_puede_cambiar_rut(
    client, db, auth_headers_agendadora, test_contact
):
    _set_rut(db, test_contact)
    resp = client.put(
        f"/api/contacts/{test_contact.id}",
        json={"rut_persona": "99.999.999-9"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 400, resp.text


def test_agendadora_si_puede_editar_campos_no_identidad(
    client, db, auth_headers_agendadora, test_contact
):
    _set_rut(db, test_contact)
    resp = client.put(
        f"/api/contacts/{test_contact.id}",
        json={"phone": "+56999999999", "email": "nuevo@test.com", "notes": "ok"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 200, resp.text


def test_superadmin_puede_corregir_identidad(
    client, db, auth_headers_admin, test_contact
):
    """auth_headers_admin es superadmin → puede corregir un error real."""
    _set_rut(db, test_contact)
    resp = client.put(
        f"/api/contacts/{test_contact.id}",
        json={"name": "Nombre Corregido"},
        headers=auth_headers_admin,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Nombre Corregido"


def test_rut_duplicado_bloqueado_al_crear(
    client, db, auth_headers_agendadora, test_contact
):
    _set_rut(db, test_contact, "11.111.111-1")
    resp = client.post(
        "/api/contacts",
        json={"name": "Otro Cliente", "phone": "+56911111111", "rut_persona": "11.111.111-1"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 400, resp.text
    assert "ya pertenece" in resp.json()["detail"].lower()


def test_rut_duplicado_distinto_formato_tambien_bloqueado(
    client, db, auth_headers_agendadora, test_contact
):
    """'11.111.111-1' ≡ '111111111' — la comparación es normalizada."""
    _set_rut(db, test_contact, "11.111.111-1")
    resp = client.post(
        "/api/contacts",
        json={"name": "Otro Cliente", "phone": "+56911111111", "rut_persona": "111111111"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 400, resp.text


def test_crear_contacto_con_rut_nuevo_funciona(
    client, db, auth_headers_agendadora
):
    resp = client.post(
        "/api/contacts",
        json={"name": "Cliente Nuevo", "phone": "+56922222222", "rut_persona": "22.222.222-2"},
        headers=auth_headers_agendadora,
    )
    assert resp.status_code == 200, resp.text

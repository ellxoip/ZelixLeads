"""
Gestión de cuentas y panel de credenciales.

Estas pruebas nacen de un error propio: al reordenar las cuentas del CRM invertí
dos parámetros de un UPDATE y el `WHERE id` recibió el número de grupo, así que
todas las escrituras cayeron sobre el mismo usuario. Lo atajó la restricción
única de la base — no una prueba. Esto cubre ese hueco: quién puede crear y
editar cuentas, y que la puerta de las credenciales no se abra a la fuerza.
"""
import pytest
from app import models
from app.routers import auth as auth_router
from app.auth import hash_password


def _usuario(db, email, group_id, role):
    u = models.User(name=email, email=email, password_hash=hash_password("Test1234"),
                    role=role, group_id=group_id, is_active=True)
    db.add(u); db.commit(); db.refresh(u)
    return u


def _headers(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "Test1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── Quién puede tocar las cuentas ───────────────────────────────────────────

def test_una_agendadora_no_puede_crear_usuarios(client, db, test_group, test_superadmin):
    ana = _usuario(db, "ana@uno.cl", test_group.id, "agendadora")
    r = client.post("/api/users", headers=_headers(client, ana.email), json={
        "name": "Colada", "email": "colada@uno.cl", "password": "Test1234",
        "role": "superadmin", "group_id": test_group.id,
    })
    assert r.status_code in (401, 403), "una agendadora se está creando un superadmin"
    assert db.query(models.User).filter(models.User.email == "colada@uno.cl").first() is None


def test_el_admin_crea_y_la_contrasena_queda_cifrada(client, db, test_group, test_superadmin):
    r = client.post("/api/users", headers=_headers(client, test_superadmin.email), json={
        "name": "Nuevo Vendedor", "email": "nuevo@uno.cl", "password": "Secreta1234",
        "role": "vendedor", "group_id": test_group.id,
    })
    assert r.status_code in (200, 201), r.text
    u = db.query(models.User).filter(models.User.email == "nuevo@uno.cl").first()
    assert u is not None
    assert u.password_hash != "Secreta1234", "la contraseña quedó guardada en texto plano"
    assert client.post("/api/auth/login", json={"email": "nuevo@uno.cl", "password": "Secreta1234"}).status_code == 200


def test_no_se_pueden_repetir_correos(client, db, test_group, test_superadmin):
    """El correo es la llave de entrada: dos cuentas con el mismo son un lío de identidad."""
    cuerpo = {"name": "Duplicado", "email": test_superadmin.email, "password": "Test1234",
              "role": "vendedor", "group_id": test_group.id}
    r = client.post("/api/users", headers=_headers(client, test_superadmin.email), json=cuerpo)
    assert r.status_code >= 400, "aceptó un correo ya registrado"


def test_editar_no_cambia_de_dueno_la_fila(client, db, test_group, test_superadmin):
    """El error que motivó estas pruebas: escribir sobre el usuario equivocado."""
    a = _usuario(db, "a@uno.cl", test_group.id, "vendedor")
    b = _usuario(db, "b@uno.cl", test_group.id, "vendedor")
    r = client.put(f"/api/users/{a.id}", headers=_headers(client, test_superadmin.email),
                   json={"name": "Cambiado"})
    assert r.status_code in (200, 201), r.text
    db.refresh(a); db.refresh(b)
    assert a.name == "Cambiado"
    assert b.name == "b@uno.cl", "la edición tocó a OTRO usuario"
    assert a.email == "a@uno.cl", "la edición le cambió el correo sin pedirlo"


# ── Panel de credenciales ───────────────────────────────────────────────────

@pytest.fixture()
def panel(monkeypatch):
    monkeypatch.setattr(auth_router, "_PANEL_CLAVE", "clave-buena")
    monkeypatch.setattr(auth_router, "_PANEL_CUENTAS", '[{"email":"a@z.cl","rol":"vendedor","pw":"x"}]')
    auth_router._panel_fallos.clear()
    yield
    auth_router._panel_fallos.clear()


def test_sin_configurar_el_panel_no_existe(client, monkeypatch):
    monkeypatch.setattr(auth_router, "_PANEL_CLAVE", "")
    r = client.post("/api/auth/panel-credenciales", json={"clave": "loquesea"})
    assert r.status_code == 404, "un despliegue sin las variables no puede dejar el panel abierto"


def test_la_clave_correcta_entrega_las_cuentas(client, panel):
    r = client.post("/api/auth/panel-credenciales", json={"clave": "clave-buena"})
    assert r.status_code == 200
    assert r.json()["cuentas"][0]["email"] == "a@z.cl"


def test_la_clave_equivocada_no_entrega_nada(client, panel):
    r = client.post("/api/auth/panel-credenciales", json={"clave": "no"})
    assert r.status_code == 401
    assert "cuentas" not in r.json()


def test_tras_varios_intentos_se_bloquea(client, panel):
    """Sin freno, una clave se prueba miles de veces por minuto."""
    for _ in range(auth_router._PANEL_MAX_FALLOS):
        assert client.post("/api/auth/panel-credenciales", json={"clave": "no"}).status_code == 401
    r = client.post("/api/auth/panel-credenciales", json={"clave": "no"})
    assert r.status_code == 429, "sigue aceptando intentos sin límite"
    # Y el bloqueo NO se esquiva acertando: mientras dure, ni la buena pasa.
    assert client.post("/api/auth/panel-credenciales", json={"clave": "clave-buena"}).status_code == 429


def test_acertar_limpia_los_fallos_previos(client, panel):
    for _ in range(auth_router._PANEL_MAX_FALLOS - 1):
        client.post("/api/auth/panel-credenciales", json={"clave": "no"})
    assert client.post("/api/auth/panel-credenciales", json={"clave": "clave-buena"}).status_code == 200
    # Ya limpio: vuelve a haber margen completo, no queda uno a punto de bloquear.
    for _ in range(auth_router._PANEL_MAX_FALLOS - 1):
        assert client.post("/api/auth/panel-credenciales", json={"clave": "no"}).status_code == 401

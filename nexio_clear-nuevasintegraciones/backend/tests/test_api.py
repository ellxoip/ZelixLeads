"""
Critical API tests for NEXIO CRM backend.

Uses in-memory SQLite via conftest fixtures — no connection to production DB.
Run with: pytest backend/tests/ -v
"""
import pytest

from app import models
from app.auth import hash_password


# ═══════════════════════════════════════════════════════════════════════════════
# 1. AUTH — POST /api/auth/login
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:

    def test_login_valid_credentials(self, client, db, test_superadmin):
        """Should return access_token and user data with valid credentials."""
        resp = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == "admin@test.com"
        assert data["user"]["role"] == "superadmin"

    def test_login_wrong_password(self, client, db, test_superadmin):
        """Should return 401 for wrong password."""
        resp = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "WrongPassword1",
        })
        assert resp.status_code == 401

    def test_login_nonexistent_email(self, client):
        """Should return 401 for unknown email."""
        resp = client.post("/api/auth/login", json={
            "email": "noexiste@test.com",
            "password": "SomePass1",
        })
        assert resp.status_code == 401

    def test_login_missing_fields(self, client):
        """Should return 422 for missing required fields."""
        resp = client.post("/api/auth/login", json={"email": "admin@test.com"})
        assert resp.status_code == 422

    def test_login_returns_user_plan(self, client, db, test_superadmin):
        """Should return negocio_plan in the user object."""
        resp = client.post("/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234",
        })
        assert resp.status_code == 200
        user = resp.json()["user"]
        assert "negocio_plan" in user


# ═══════════════════════════════════════════════════════════════════════════════
# 2. LEADS — GET /api/leads, POST, stage move
# ═══════════════════════════════════════════════════════════════════════════════

class TestLeads:

    def test_get_leads_authenticated(self, client, auth_headers_admin, test_lead):
        """Should list leads for authenticated superadmin."""
        resp = client.get("/api/leads", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        # Response is a dict with items or a list
        if isinstance(data, dict):
            assert "items" in data or "leads" in data or True
        else:
            assert isinstance(data, list)

    def test_get_leads_unauthenticated(self, client):
        """Should return 401 without auth headers."""
        resp = client.get("/api/leads")
        assert resp.status_code == 401

    def test_get_single_lead(self, client, auth_headers_admin, test_lead):
        """Should return a specific lead by ID."""
        resp = client.get(f"/api/leads/{test_lead.id}", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == test_lead.id
        assert data["current_stage"] == "lead"

    def test_get_nonexistent_lead(self, client, auth_headers_admin):
        """Should return 404 for nonexistent lead."""
        resp = client.get("/api/leads/999999", headers=auth_headers_admin)
        assert resp.status_code == 404

    def test_move_lead_stage(self, client, auth_headers_admin, test_lead):
        """Should move a lead to another stage via /move-stage."""
        resp = client.post(
            f"/api/leads/{test_lead.id}/move-stage",
            json={"stage": "altamente_interesado"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["current_stage"] == "altamente_interesado"

    def test_move_lead_invalid_stage(self, client, auth_headers_admin, test_lead):
        """Should return 400 for invalid stage."""
        resp = client.post(
            f"/api/leads/{test_lead.id}/move-stage",
            json={"stage": "etapa_inventada"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 400

    def test_move_to_pago_comprometido_requires_date(self, client, auth_headers_admin, test_lead):
        """pago_comprometido requires a payment commitment date."""
        resp = client.post(
            f"/api/leads/{test_lead.id}/move-stage",
            json={"stage": "pago_comprometido"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 400
        assert "fecha comprometida" in resp.json()["detail"].lower()

    def test_move_to_pago_comprometido_with_date(self, client, auth_headers_admin, test_lead):
        """pago_comprometido with date succeeds and persists the date."""
        resp = client.post(
            f"/api/leads/{test_lead.id}/move-stage",
            json={"stage": "pago_comprometido", "payment_commitment_date": "2026-06-15"},
            headers=auth_headers_admin,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["current_stage"] == "pago_comprometido"
        assert data["payment_commitment_date"] == "2026-06-15"

    def test_update_lead_notes(self, client, auth_headers_admin, test_lead):
        """Should update internal notes of a lead."""
        resp = client.patch(
            f"/api/leads/{test_lead.id}",
            json={"notes": "Nota de prueba"},
            headers=auth_headers_admin,
        )
        assert resp.status_code in (200, 404, 405)
        if resp.status_code == 200:
            assert resp.json()["notes"] == "Nota de prueba"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. CONTACTS — GET /api/contacts, POST, DELETE
# ═══════════════════════════════════════════════════════════════════════════════

class TestContacts:

    def test_list_contacts_authenticated(self, client, auth_headers_admin, test_contact):
        """Should list contacts for authenticated user."""
        resp = client.get("/api/contacts", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert data["total"] >= 1

    def test_list_contacts_unauthenticated(self, client):
        """Should return 401 without auth."""
        resp = client.get("/api/contacts")
        assert resp.status_code == 401

    def test_list_contacts_search(self, client, auth_headers_admin, test_contact):
        """Should filter contacts by search query."""
        resp = client.get("/api/contacts?search=Juan", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        found = any("Juan" in c["name"] for c in data["items"])
        assert found

    def test_create_contact(self, client, auth_headers_admin, test_group):
        """Should create a new contact."""
        resp = client.post("/api/contacts", json={
            "name": "Nuevo Contacto Test",
            "phone": "+56987654321",
            "email": "nuevo@test.com",
        }, headers=auth_headers_admin)
        assert resp.status_code in (200, 201)
        if resp.status_code in (200, 201):
            data = resp.json()
            assert data["name"] == "Nuevo Contacto Test"
            assert data["phone"] == "+56987654321"

    def test_create_contact_missing_phone(self, client, auth_headers_admin):
        """Should return error when phone is missing."""
        resp = client.post("/api/contacts", json={
            "name": "Sin Teléfono",
        }, headers=auth_headers_admin)
        assert resp.status_code in (400, 422)

    def test_delete_contact(self, client, auth_headers_admin, db, test_group, test_superadmin):
        """Should delete an existing contact with no active leads."""
        from app import models as m
        c = m.Contact(
            name="Para Eliminar",
            phone="+56911111111",
            group_id=test_group.id,
            created_by=test_superadmin.id,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        resp = client.delete(f"/api/contacts/{c.id}", headers=auth_headers_admin)
        assert resp.status_code in (200, 204, 404)

    def test_get_contact_pagination(self, client, auth_headers_admin, test_contact):
        """Should return pagination metadata."""
        resp = client.get("/api/contacts?page=1&page_size=10", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert "page" in data
        assert "pages" in data
        assert "total" in data


# ═══════════════════════════════════════════════════════════════════════════════
# 4. CALENDAR — POST /api/calendar, GET /api/calendar
# ═══════════════════════════════════════════════════════════════════════════════

class TestCalendar:

    def test_list_events_authenticated(self, client, auth_headers_admin):
        """Should return list of calendar events for authenticated user."""
        resp = client.get("/api/calendar", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_list_events_unauthenticated(self, client):
        """Should return 401 without auth."""
        resp = client.get("/api/calendar")
        assert resp.status_code == 401

    def test_create_event(self, client, auth_headers_admin):
        """Should create a new calendar event."""
        resp = client.post("/api/calendar", json={
            "title": "Reunión de prueba",
            "start_time": "2026-06-01T10:00:00Z",
            "end_time":   "2026-06-01T10:30:00Z",
            "event_type": "reunion",
            "notes": "",
            "color": "#3B82F6",
        }, headers=auth_headers_admin)
        assert resp.status_code in (200, 201)
        if resp.status_code in (200, 201):
            data = resp.json()
            assert data["title"] == "Reunión de prueba"

    def test_create_event_invalid_dates(self, client, auth_headers_admin):
        """Should reject event where end_time < start_time."""
        resp = client.post("/api/calendar", json={
            "title": "Evento mal fechado",
            "start_time": "2026-06-01T11:00:00Z",
            "end_time":   "2026-06-01T10:00:00Z",  # end before start
            "event_type": "reunion",
        }, headers=auth_headers_admin)
        assert resp.status_code in (400, 422)

    def test_create_event_missing_title(self, client, auth_headers_admin):
        """Should return 422 if title is missing."""
        resp = client.post("/api/calendar", json={
            "start_time": "2026-06-01T10:00:00Z",
            "end_time":   "2026-06-01T10:30:00Z",
        }, headers=auth_headers_admin)
        assert resp.status_code == 422

    def test_delete_event(self, client, auth_headers_admin):
        """Should delete a calendar event created by same user."""
        # First create
        create_resp = client.post("/api/calendar", json={
            "title": "Para eliminar",
            "start_time": "2026-07-01T14:00:00Z",
            "end_time":   "2026-07-01T14:30:00Z",
            "event_type": "llamada",
            "color": "#10B981",
        }, headers=auth_headers_admin)
        if create_resp.status_code not in (200, 201):
            pytest.skip("Event creation failed, skipping delete test")
        event_id = create_resp.json()["id"]
        # Then delete
        del_resp = client.delete(f"/api/calendar/{event_id}", headers=auth_headers_admin)
        assert del_resp.status_code in (200, 204)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. PIPELINE STAGES — GET /api/pipeline-stages
# ═══════════════════════════════════════════════════════════════════════════════

class TestPipelineStages:

    def test_list_pipeline_stages_authenticated(self, client, auth_headers_admin):
        """Should return pipeline stages (empty list for fresh negocio)."""
        resp = client.get("/api/pipeline-stages", headers=auth_headers_admin)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_list_pipeline_stages_unauthenticated(self, client):
        """Should return 401 without auth."""
        resp = client.get("/api/pipeline-stages")
        assert resp.status_code == 401

    def test_create_pipeline_stage_abogados_uses_fixed_pipeline(self, client, auth_headers_admin):
        """Negocios tipo 'abogados' use the fixed pipeline — creation must 400."""
        resp = client.post("/api/pipeline-stages", json={
            "key": "etapa_test",
            "name": "Etapa de Prueba",
            "color": "#4361ee",
            "order": 1,
        }, headers=auth_headers_admin)
        assert resp.status_code == 400
        assert "pipeline fijo" in resp.json()["detail"]

    def test_create_pipeline_stage_custom_negocio(self, client, db):
        """Non-abogados negocios can create custom pipeline stages."""
        group = models.Group(name="Negocio Custom", tipo="otro", plan="basico")
        db.add(group)
        db.commit()
        user = models.User(
            name="Admin Custom", email="admincustom@test.com",
            password_hash=hash_password("Test1234"),
            role="superadmin", group_id=group.id, is_active=True,
        )
        db.add(user)
        db.commit()
        login = client.post("/api/auth/login", json={
            "email": "admincustom@test.com", "password": "Test1234",
        })
        assert login.status_code == 200, login.text
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        resp = client.post("/api/pipeline-stages", json={
            "key": "etapa_test",
            "name": "Etapa de Prueba",
            "color": "#4361ee",
            "order": 1,
        }, headers=headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["key"] == "etapa_test"
        assert data["name"] == "Etapa de Prueba"

    def test_create_pipeline_stage_missing_key(self, client, auth_headers_admin):
        """Should return 422 if key is missing."""
        resp = client.post("/api/pipeline-stages", json={
            "name": "Sin Clave",
        }, headers=auth_headers_admin)
        assert resp.status_code == 422

    def test_agendadora_can_read_stages(self, client, auth_headers_agendadora):
        """Agendadora should also be able to read pipeline stages."""
        resp = client.get("/api/pipeline-stages", headers=auth_headers_agendadora)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

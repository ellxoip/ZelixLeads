"""
Real End-to-End (E2E) Integration Tests for Sellia (Tania IA) ↔ NEXIO CRM.
Simulates Tania's interaction with Nexio endpoints and checks the system's real behavior.
Run with: pytest backend/tests/test_tania_integration.py -v
"""
import pytest
from datetime import datetime, timezone, timedelta
from app import models
from app.auth import hash_password

class TestTaniaIntegrationE2E:

    def test_01_tania_incoming_message_creates_contact_and_lead(self, client, db, test_group, test_superadmin):
        """
        Simulate Tania receiving a message on WhatsApp and checking if Nexio's
        webhook receiver properly creates/matches contacts and links them to leads.
        """
        # Ensure a WhatsApp configuration exists in the system
        config = models.WhatsAppConfig(
            name="Meta WhatsApp Config",
            phone_number_id="1234567890",
            phone_number="+56999999999",
            group_id=test_group.id,
            is_active=True,
            api_token="mock_meta_token"
        )
        db.add(config)
        db.commit()

        # Mock incoming WhatsApp message body from Meta
        payload = {
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "entry_id_123",
                "changes": [{
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {
                            "display_phone_number": "56999999999",
                            "phone_number_id": "1234567890"
                        },
                        "contacts": [{
                            "profile": {"name": "Carlos Gomez"},
                            "wa_id": "56911112222"
                        }],
                        "messages": [{
                            "from": "56911112222",
                            "id": "wamid.HBgLNTY5MTExMTIyMjIVAgARGBIxMjM0NTY3ODkwMTIzNDUA",
                            "timestamp": "1782230878",
                            "text": {"body": "Hola, me gustaría agendar una reunión con un abogado de Prescripción."},
                            "type": "text"
                        }]
                    },
                    "field": "messages"
                }]
            }]
        }

        # Send request to webhook
        resp = client.post("/api/webhook/whatsapp", json=payload)
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

        # Verify that contact was created
        contact = db.query(models.Contact).filter(models.Contact.phone == "+56911112222").first()
        assert contact is not None
        assert contact.name == "Carlos Gomez"

        # Verify that message was logged
        message = db.query(models.WhatsAppMessage).filter(models.WhatsAppMessage.contact_id == contact.id).first()
        assert message is not None
        assert message.content == "Hola, me gustaría agendar una reunión con un abogado de Prescripción."
        assert message.direction == "in"

    def test_02_tania_schedules_reunion_and_assigns_vendedor(self, client, auth_headers_admin, db, test_lead, test_vendedor, test_superadmin):
        """
        Simulate Tania scheduling a meeting. Tania reserves a calendar slot for the lead,
        which should trigger owner assignment and status reset.
        """
        # Tania creates a calendar event for a lead
        start_time = datetime.now(timezone.utc) + timedelta(days=1)
        end_time = start_time + timedelta(minutes=30)

        # Let's set the lead's vendor outcome to failed first, to verify scheduling resets it
        test_lead.last_vendor_outcome = "no_show"
        db.commit()

        event_payload = {
            "title": "Reunión Prescripción Deudas - Tania IA",
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "event_type": "reunion",
            "notes": "Agendado automáticamente por Tania IA en Sellia.",
            "color": "#8B5CF6", # Violet for Tania
            "lead_id": test_lead.id,
            "assigned_to": test_vendedor.id
        }

        resp = client.post("/api/calendar", json=event_payload, headers=auth_headers_admin)
        assert resp.status_code in (200, 201), resp.text
        event_data = resp.json()
        assert event_data["title"] == "Reunión Prescripción Deudas - Tania IA"
        assert event_data["event_type"] == "reunion"
        assert event_data["lead_id"] == test_lead.id
        assert event_data["assigned_to"] == test_vendedor.id

        # Verify that the lead's vendor outcome was reset (cleared) so it shows up back on the board
        db.refresh(test_lead)
        assert test_lead.last_vendor_outcome is None

        # Verify lead vendor assignment matches the calendar event assignee
        assert test_lead.vendedor_id == test_vendedor.id

    def test_03_ai_agent_contact_state_management(self, client, auth_headers_admin, db, test_contact, test_superadmin):
        """
        Simulate Tania query or state toggle. Nexio must manage the active/paused/handed_off
        state for a contact to prevent collision with human agents.
        """
        # Create an AIAgent configuration first
        agent = models.AIAgent(
            name="Tania IA",
            system_prompt="Eres Tania, la asistente IA de Abogados Tributarios...",
            is_active=True,
            openai_api_key="sk-mockkey1234567890",
            group_id=test_contact.group_id,
            escalation_keywords="humano, persona, ayuda, asesor"
        )
        db.add(agent)
        db.commit()

        # Initially there is no contact state, let's create or update it
        state = models.AIAgentContactState(
            contact_id=test_contact.id,
            agent_id=agent.id,
            state="active"
        )
        db.add(state)
        db.commit()

        # Update contact state to handed_off
        resp = client.post(
            f"/api/ai-agents/{agent.id}/contact/{test_contact.id}/state",
            json={"state": "handed_off"},
            headers=auth_headers_admin
        )
        assert resp.status_code == 200
        assert resp.json()["state"] == "handed_off"

    def test_04_pipeline_validation_financials_for_pago_comprometido(self, client, auth_headers_admin, db, test_lead):
        """
        Simulate moving the lead through pipeline stages.
        Verify that moving to pago_pendiente (via success from cierre) validates financial values.
        """
        # Set stage to cierre and set lead financials to 0
        test_lead.current_stage = "cierre"
        test_lead.honorarios = 0
        db.commit()

        # Attempting to advance lead from cierre to pago_pendiente should fail if honorarios is 0
        resp = client.post(
            f"/api/leads/{test_lead.id}/advance",
            json={"result": "success"}, # success from cierre goes to pago_pendiente
            headers=auth_headers_admin
        )
        # It should fail with HTTP 400
        assert resp.status_code == 400
        assert "honorarios" in resp.json()["detail"].lower()

        # Set correct financials
        test_lead.honorarios = 1000000
        test_lead.num_cuotas = 5
        test_lead.cuota_inicial = 200000
        db.commit()

        # Advancing lead with correct financials should succeed
        resp = client.post(
            f"/api/leads/{test_lead.id}/advance",
            json={"result": "success"},
            headers=auth_headers_admin
        )
        assert resp.status_code == 200
        assert resp.json()["current_stage"] == "pago_pendiente"

    def test_05_cierre_stage_requires_rut(self, client, auth_headers_admin, db, test_lead, test_contact):
        """
        Simulate moving the lead to Cierre stage.
        Verify that RUT (rut_persona or rut_empresa) is mandatory when moving highly interested to cierre.
        """
        # Set stage to altamente_interesado
        test_lead.current_stage = "altamente_interesado"
        # Ensure contact does NOT have RUT
        test_contact.rut_persona = None
        test_contact.rut_empresa = None
        db.commit()

        # Advance to cierre stage (success from altamente_interesado goes to cierre)
        resp = client.post(
            f"/api/leads/{test_lead.id}/advance",
            json={"result": "success"},
            headers=auth_headers_admin
        )
        assert resp.status_code == 400
        assert "rut" in resp.json()["detail"].lower()

        # Add RUT to contact
        test_contact.rut_persona = "12.345.678-9"
        db.commit()

        # Advance to cierre stage should now succeed
        resp = client.post(
            f"/api/leads/{test_lead.id}/advance",
            json={"result": "success"},
            headers=auth_headers_admin
        )
        assert resp.status_code == 200
        assert resp.json()["current_stage"] == "cierre"

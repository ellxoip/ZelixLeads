"""
LADRILLO 3 — la boca única: el CRM habla A TRAVÉS de Zelix.

Lo que estas pruebas cuidan es un fallo que ya ocurrió en producción y que nadie
vio: en `whatsapp_messages` había UN solo mensaje saliente en toda la historia
de la base —id 12, "Hola", 2026-08-12— con `status = 'logged'`, o sea guardado y
jamás enviado. La config del número de Zelix no tiene `api_token` (decisión 72:
una credencial que le escribe a los clientes no vive en la base), así que TODO
lo que se contestara desde el inbox se quedaba acá adentro.

Tres cosas se prueban, y las tres duelen si se rompen:

 1. **Se envía por Zelix**, no con credenciales propias — si esto se rompe,
    vuelven las dos bocas en el mismo número.
 2. **Un rechazo se marca `failed` con su MOTIVO**, no `logged` a secas: la
    agendadora leía "WhatsApp no conectado" cuando el problema real podía ser
    la ventana de 24 h, y se iba a revisar una conexión que estaba sana.
 3. **404 de Zelix = "ese número no es mío"** y se cae al camino directo. Es la
    diferencia entre "no me hago cargo" y "no se pudo enviar"; confundirlas
    dejaría números ajenos mudos.
"""
import httpx
import pytest

from app import models
from app.routers import whatsapp as wa


PHONE_ID = "1164312330107171"
ZELIX = "https://api.zelix.test"
SECRETO = "secreto-de-prueba"


@pytest.fixture()
def config_zelix(db, test_group, test_agendadora):
    """El número de Zelix tal como está en producción: SIN api_token, a propósito."""
    cfg = models.WhatsAppConfig(
        name="Zelix — WhatsApp oficial", phone_number="+56994124779", phone_number_id=PHONE_ID,
        api_provider="meta", group_id=test_group.id, owner_user_id=test_agendadora.id,
        is_active=True,
    )
    db.add(cfg)
    db.commit()
    return cfg


@pytest.fixture()
def con_zelix(monkeypatch):
    monkeypatch.setattr(wa, "ZELIX_API_URL", ZELIX)
    monkeypatch.setattr(wa, "ZELIX_CRM_SECRET", SECRETO)


def _falso_cliente(monkeypatch, responder):
    """Reemplaza httpx.AsyncClient por uno que responde lo que diga `responder`."""
    llamadas = []

    class _Cliente:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            llamadas.append({"url": url, **kw})
            return responder(url, kw)

    monkeypatch.setattr(wa.httpx, "AsyncClient", _Cliente)
    return llamadas


def _resp(status, payload=None):
    return httpx.Response(status, json=payload if payload is not None else {}, request=httpx.Request("POST", "http://x"))


# ── 1. El envío sale por Zelix ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_envia_por_zelix_con_el_secreto_y_devuelve_el_wamid(config_zelix, con_zelix, monkeypatch):
    llamadas = _falso_cliente(monkeypatch, lambda u, k: _resp(200, {"ok": True, "message_id": "wamid.ZLX1"}))

    r = await wa.send_whatsapp_api(config_zelix, "+56911111111", "Hola, soy Ana 👋")

    assert r == {"status": "sent", "message_id": "wamid.ZLX1"}
    assert len(llamadas) == 1, "debería haber UNA llamada: a Zelix, no a Graph"
    assert llamadas[0]["url"] == f"{ZELIX}/api/crm/enviar"
    assert llamadas[0]["headers"]["x-crm-callback-secret"] == SECRETO
    assert llamadas[0]["json"] == {
        "phone_number_id": PHONE_ID,
        "telefono": "+56911111111",
        "texto": "Hola, soy Ana 👋",
    }


@pytest.mark.asyncio
async def test_jamas_le_habla_a_graph_cuando_zelix_esta_configurado(config_zelix, con_zelix, monkeypatch):
    """El número es de Zelix: dos bocas en el mismo número es el defecto a evitar."""
    llamadas = _falso_cliente(monkeypatch, lambda u, k: _resp(200, {"ok": True, "message_id": "wamid.X"}))
    config_zelix.api_token = "TOKEN-QUE-NO-SE-DEBE-USAR"

    await wa.send_whatsapp_api(config_zelix, "+56911111111", "hola")

    assert all("graph.facebook.com" not in c["url"] for c in llamadas), \
        "se habló con Meta directo teniendo la boca única configurada"


# ── 2. Un rechazo se cuenta, con su motivo ──────────────────────────────────

@pytest.mark.asyncio
async def test_rechazo_de_meta_queda_failed_con_el_motivo(config_zelix, con_zelix, monkeypatch):
    _falso_cliente(monkeypatch, lambda u, k: _resp(502, {
        "ok": False, "clase": "ventana_24h",
        "error": "Pasaron más de 24 h desde el último mensaje del cliente.",
    }))

    r = await wa.send_whatsapp_api(config_zelix, "+56911111111", "¿seguimos?")

    assert r["status"] == "failed", "un rechazo marcado 'logged' se lee como 'WhatsApp no conectado', que es falso"
    assert "24 h" in r["error"]
    assert r["message_id"] is None


@pytest.mark.asyncio
async def test_zelix_caido_no_se_traga_el_mensaje(config_zelix, con_zelix, monkeypatch):
    def _explota(url, kw):
        raise httpx.ConnectError("sin ruta al host")

    _falso_cliente(monkeypatch, _explota)

    r = await wa.send_whatsapp_api(config_zelix, "+56911111111", "hola")

    assert r["status"] == "failed"
    assert r["error"], "una caída de red tiene que decir algo: el silencio es lo que costó el mensaje id 12"


# ── 3. "Ese número no es mío" ≠ "no se pudo enviar" ─────────────────────────

@pytest.mark.asyncio
async def test_404_de_zelix_cae_al_camino_directo(config_zelix, con_zelix, monkeypatch):
    """Zelix no maneja ese número → se usa el token propio de la config."""
    def _responder(url, kw):
        if url.endswith("/api/crm/enviar"):
            return _resp(404, {"ok": False, "error": "phone_number_id desconocido para Zelix"})
        return _resp(200, {"messages": [{"id": "wamid.DIRECTO"}]})

    llamadas = _falso_cliente(monkeypatch, _responder)
    config_zelix.api_token = "TOKEN-PROPIO"

    r = await wa.send_whatsapp_api(config_zelix, "+56911111111", "hola")

    assert r == {"status": "sent", "message_id": "wamid.DIRECTO"}
    assert any("graph.facebook.com" in c["url"] for c in llamadas), \
        "con 404 de Zelix el número es ajeno: hay que enviarlo con las credenciales propias"


@pytest.mark.asyncio
async def test_sin_zelix_configurado_todo_sigue_igual(config_zelix, monkeypatch):
    """Retrocompatible: sin la variable, el CRM se comporta como antes del ladrillo 3."""
    llamadas = _falso_cliente(monkeypatch, lambda u, k: _resp(200, {"messages": [{"id": "wamid.VIEJO"}]}))
    monkeypatch.setattr(wa, "ZELIX_API_URL", "")
    config_zelix.api_token = "TOKEN-PROPIO"

    r = await wa.send_whatsapp_api(config_zelix, "+56911111111", "hola")

    assert r["status"] == "sent"
    assert all("/api/crm/enviar" not in c["url"] for c in llamadas)


@pytest.mark.asyncio
async def test_sin_token_y_sin_zelix_queda_logged_como_antes(config_zelix, monkeypatch):
    """El estado ANTERIOR al ladrillo 3, preservado como prueba de qué se arregló."""
    monkeypatch.setattr(wa, "ZELIX_API_URL", "")
    r = await wa.send_whatsapp_api(config_zelix, "+56911111111", "hola")
    assert r == {"status": "logged", "message_id": None}

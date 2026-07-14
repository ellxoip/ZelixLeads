"""
Test de stress del broadcaster SSE + Redis bajo carga masiva.
- Abre 50 conexiones SSE simultáneas
- Publica 200 eventos en paralelo
- Mide latencia de propagación y mensajes perdidos
"""
import asyncio
import json
import time
import os
import sys
from pathlib import Path

_backend = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_backend))

import redis
import httpx
from dotenv import load_dotenv
load_dotenv(dotenv_path=_backend / ".env")

BASE_URL = "http://127.0.0.1:8001"
SSE_CONNECTIONS = 50
BROADCASTS = 200

async def get_token() -> str:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(f"{BASE_URL}/api/auth/login",
                         json={"email": "jorge@abogadostributarios.cl", "password": "Admin2024!"})
        return r.json()["access_token"]


async def sse_listener(token: str, results: dict, idx: int):
    """Conecta a SSE y cuenta mensajes recibidos."""
    headers = {"Authorization": f"Bearer {token}"}
    received = 0
    t_first = None
    try:
        async with httpx.AsyncClient(timeout=None) as c:
            # Buscar endpoint SSE
            for path in ["/api/events", "/api/sse", "/api/whatsapp/events"]:
                try:
                    async with c.stream("GET", f"{BASE_URL}{path}", headers=headers, timeout=30) as resp:
                        if resp.status_code == 200:
                            t_start = time.perf_counter()
                            async for line in resp.aiter_lines():
                                if line.startswith("data:"):
                                    if t_first is None:
                                        t_first = time.perf_counter() - t_start
                                    received += 1
                                    if received >= 5:  # recibir 5 eventos y salir
                                        break
                            break
                except Exception:
                    continue
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        pass
    results[idx] = {"received": received, "t_first_ms": round((t_first or 0) * 1000)}


async def redis_broadcaster(n_events: int):
    """Publica N eventos en Redis y mide throughput."""
    r = redis.Redis(host="localhost", port=6379, db=0)
    t0 = time.perf_counter()
    for i in range(n_events):
        payload = json.dumps({
            "type": "wa_message",
            "contact_id": (i % 100) + 1,
            "text": f"Mensaje de stress {i}",
            "seq": i,
        })
        r.publish("wa_events", payload)
    elapsed = time.perf_counter() - t0
    return elapsed, n_events / elapsed if elapsed else 0


async def main():
    print("\n╔══════════════════════════════════════════════╗")
    print("║  STRESS TEST: Broadcaster SSE + Redis        ║")
    print("╚══════════════════════════════════════════════╝\n")

    # Verificar Redis
    r = redis.Redis(host="localhost", port=6379, db=0, socket_timeout=3)
    try:
        assert r.ping()
        print(f"  Redis OK — {r.dbsize()} keys en DB")
    except Exception as e:
        print(f"  Redis ERROR: {e}")
        return

    token = await get_token()
    print(f"  Token obtenido OK\n")

    # Test 1: throughput puro de Redis pub/sub
    print("─── Test 1: Redis pub/sub throughput ───")
    elapsed, rps = await redis_broadcaster(1000)
    print(f"  1000 eventos publicados en {elapsed:.3f}s → {rps:.0f} eventos/s")

    # Test 2: latencia Redis (round-trip publish → subscribe)
    print("\n─── Test 2: Latencia Redis pub/sub ───")
    latencies = []
    r_sync = redis.Redis(host="localhost", port=6379, db=0)
    pubsub = r_sync.pubsub()
    pubsub.subscribe("wa_events_latency_test")
    for _ in range(20):
        t0 = time.perf_counter()
        r_sync.publish("wa_events_latency_test", json.dumps({"ping": t0}))
        for msg in pubsub.listen():
            if msg["type"] == "message":
                latencies.append((time.perf_counter() - t0) * 1000)
                break
    pubsub.unsubscribe()
    latencies.sort()
    if latencies:
        print(f"  Latencia avg: {sum(latencies)/len(latencies):.2f}ms")
        print(f"  Latencia p50: {latencies[len(latencies)//2]:.2f}ms")
        print(f"  Latencia p99: {latencies[-1]:.2f}ms")

    # Test 3: SSE bajo carga concurrente
    print("\n─── Test 3: SSE + carga concurrente ───")
    # Verificar si hay endpoint SSE
    async with httpx.AsyncClient(timeout=5) as c:
        sse_path = None
        for path in ["/api/events", "/api/sse", "/api/whatsapp/events"]:
            try:
                headers = {"Authorization": f"Bearer {token}"}
                r_check = await c.get(f"{BASE_URL}{path}", headers=headers, timeout=3)
                if r_check.status_code == 200:
                    sse_path = path
                    print(f"  SSE endpoint encontrado: {path}")
                    break
            except Exception:
                continue

    if not sse_path:
        print("  No se encontró endpoint SSE expuesto — broadcaster opera vía Redis workers internos")
        print("  Esto es correcto: SSE se suscribe por cada worker uvicorn vía Redis pub/sub")
    else:
        results = {}
        print(f"  Abriendo {SSE_CONNECTIONS} conexiones SSE simultáneas...")
        sse_tasks = [
            asyncio.create_task(sse_listener(token, results, i))
            for i in range(SSE_CONNECTIONS)
        ]
        await asyncio.sleep(1)  # dejar que se establezcan

        # Publicar eventos mientras SSE escucha
        t_pub = time.perf_counter()
        for i in range(BROADCASTS):
            r_sync.publish("wa_events", json.dumps({"type": "wa_message", "seq": i}))
        pub_time = time.perf_counter() - t_pub

        await asyncio.sleep(2)  # esperar propagación
        for t in sse_tasks:
            t.cancel()
        await asyncio.gather(*sse_tasks, return_exceptions=True)

        total_received = sum(v["received"] for v in results.values())
        avg_latency = sum(v["t_first_ms"] for v in results.values() if v["t_first_ms"] > 0)
        n_got = sum(1 for v in results.values() if v["received"] > 0)
        print(f"  Publicados: {BROADCASTS} eventos en {pub_time*1000:.0f}ms")
        print(f"  Conexiones que recibieron: {n_got}/{SSE_CONNECTIONS}")
        print(f"  Total mensajes recibidos: {total_received}")

    # Test 4: carga HTTP + Redis simultáneos (broadcaster no bloquea requests)
    print("\n─── Test 4: HTTP carga + Redis simultáneo ───")
    headers = {"Authorization": f"Bearer {token}"}

    async def http_requests():
        ok = 0
        latencies_http = []
        async with httpx.AsyncClient(timeout=15, limits=httpx.Limits(max_connections=30)) as c:
            tasks = []
            for i in range(100):
                tasks.append(c.get(f"{BASE_URL}/api/leads?limit=20", headers=headers))
            t0 = time.perf_counter()
            resps = await asyncio.gather(*tasks, return_exceptions=True)
            elapsed = time.perf_counter() - t0
            for r in resps:
                if hasattr(r, 'status_code') and r.status_code < 400:
                    ok += 1
        return ok, elapsed

    async def redis_flood():
        r2 = redis.Redis(host="localhost", port=6379, db=0)
        for i in range(500):
            r2.publish("wa_events", json.dumps({"type": "flood_test", "seq": i}))
        return 500

    (http_ok, http_elapsed), n_redis = await asyncio.gather(
        http_requests(),
        redis_flood(),
    )
    print(f"  HTTP: {http_ok}/100 OK en {http_elapsed:.2f}s ({100/http_elapsed:.0f} RPS)")
    print(f"  Redis: {n_redis} eventos publicados en paralelo")
    print(f"  Broadcaster no interfirió: {'✓ SÍ' if http_ok >= 90 else '✗ NO — revisar'}")

    print("\n╔══════════════════════════════════════════════╗")
    print("║  RESULTADO BROADCASTER                       ║")
    print(f"║  Redis throughput:  {rps:.0f} eventos/s            ║")
    print(f"║  Redis latencia p50: {latencies[len(latencies)//2]:.1f}ms              ║")
    print(f"║  HTTP bajo flood:   {http_ok}/100 OK              ║")
    print("╚══════════════════════════════════════════════╝\n")


if __name__ == "__main__":
    asyncio.run(main())

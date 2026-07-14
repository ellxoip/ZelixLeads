#!/usr/bin/env python3
"""
Stress / smoke test del flujo de integraciones de nexio (Fase 1: auth + health).

Modo SEGURO por defecto:
  - Los GET son lecturas reales (proceso-mora, abogados) — seguro bajo carga.
  - Los POST de creación se mandan con body vacío → la validación responde 422
    DESPUÉS de pasar la auth, sin escribir datos. Mide la ruta red+auth+parseo
    sin ensuciar la DB.

Lee las URLs base y las keys desde backend/.env (las mismas que usa la app).
Motor: hilos + httpx síncrono (robusto en Windows, sin asyncio/anyio).

Uso:
  python scripts/stress_integrations.py                 # smoke seguro, 20 req/endpoint, conc 10
  python scripts/stress_integrations.py -n 200 -c 25    # más carga
  python scripts/stress_integrations.py --only fc,control
  python scripts/stress_integrations.py --timeout 8

Métricas por endpoint: p50/p95/p99 (ms), throughput (req/s), error-rate,
y distribución de status codes. "auth_ok" = ningún 401 (la key calza).
"""
from __future__ import annotations

import argparse
import os
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)


def _u(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").rstrip("/")


def _k(name: str) -> str:
    return (os.getenv(name) or "").strip()


LEGAL_FINANCE_URL = _u("LEGAL_FINANCE_URL", "http://localhost:4000")
PAGACUOTAS_URL    = _u("PAGACUOTAS_URL",    "http://localhost:4000")
HIVE_SERVICE_URL  = _u("HIVE_SERVICE_URL",  "http://localhost:3001")
AT_INFORMA_URL    = _u("AT_INFORMA_URL",    "http://localhost:3000")

# (name, system, method, url, headers, json_body, safe_kind)
#   safe_kind="read"  -> GET de lectura real
#   safe_kind="probe" -> POST con body vacío (espera 422 si auth OK, 401 si no)
ENDPOINTS = [
    ("fc:proceso-mora", "fc", "GET",
     f"{LEGAL_FINANCE_URL}/api/integrations/cobranza/proceso-mora",
     {"Authorization": f"Bearer {_k('PAGACUOTAS_INTERNAL_API_KEY')}"}, None, "read"),

    ("control:abogados", "control", "GET",
     f"{AT_INFORMA_URL}/api/integration/abogados",
     {"x-integration-secret": _k("AT_INFORMA_INTEGRATION_SECRET")}, None, "read"),

    ("fc:pago-comprometido", "fc", "POST",
     f"{LEGAL_FINANCE_URL}/api/integrations/crm/pago-comprometido",
     {"x-api-key": _k("LEGAL_FINANCE_API_KEY")}, {}, "probe"),

    ("pagacuotas:from-crm", "pagacuotas", "POST",
     f"{PAGACUOTAS_URL}/api/integration/clients/from-crm",
     {"x-crm-api-key": _k("PAGACUOTAS_API_KEY")}, {}, "probe"),

    ("control:cases", "control", "POST",
     f"{HIVE_SERVICE_URL}/api/internal/integration/cases",
     {"Authorization": f"Bearer {_k('HIVE_SERVICE_API_KEY') or _k('INTEGRATION_INTERNAL_API_KEY')}"}, {}, "probe"),

    ("control:reunion-lead", "control", "POST",
     f"{AT_INFORMA_URL}/api/integration/reunion-lead",
     {"x-integration-secret": _k("AT_INFORMA_INTEGRATION_SECRET")}, {}, "probe"),

    ("control:payment-needed", "control", "POST",
     f"{AT_INFORMA_URL}/api/integration/payment-needed",
     {"x-integration-secret": _k("AT_INFORMA_INTEGRATION_SECRET")}, {}, "probe"),
]


def _one(client: httpx.Client, ep, timeout: float):
    _, _, method, url, headers, body, _ = ep
    h = {"Content-Type": "application/json", **{k: v for k, v in headers.items() if v}}
    t0 = time.perf_counter()
    try:
        resp = client.request(method, url, headers=h, json=body, timeout=timeout)
        return (time.perf_counter() - t0) * 1000, resp.status_code, None
    except Exception as exc:  # noqa: BLE001
        return (time.perf_counter() - t0) * 1000, None, type(exc).__name__


def run_endpoint(ep, n: int, conc: int, timeout: float):
    lat: list[float] = []
    codes: Counter = Counter()
    errors: Counter = Counter()

    with httpx.Client(follow_redirects=True, verify=True) as client:
        def task(_):
            dt, code, err = _one(client, ep, timeout)
            return dt, code, err

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as pool:
            for dt, code, err in pool.map(task, range(n)):
                lat.append(dt)
                if err:
                    errors[err] += 1
                else:
                    codes[code] += 1
        wall = time.perf_counter() - t0

    lat_sorted = sorted(lat)

    def pct(p):
        if not lat_sorted:
            return 0.0
        i = min(len(lat_sorted) - 1, int(round(p / 100 * (len(lat_sorted) - 1))))
        return lat_sorted[i]

    n_err = sum(errors.values())
    n_401 = codes.get(401, 0)
    auth_ok = n_401 == 0 and (n - n_err) > 0
    throughput = n / wall if wall > 0 else 0.0

    return {
        "name": ep[0], "system": ep[1], "kind": ep[6],
        "p50": pct(50), "p95": pct(95), "p99": pct(99),
        "throughput": throughput, "wall": wall,
        "codes": dict(codes), "errors": dict(errors),
        "err_rate": (n_err / n * 100) if n else 0.0,
        "auth_ok": auth_ok,
    }


def fmt_codes(codes: dict, errors: dict) -> str:
    parts = [f"{c}x{n}" for c, n in sorted(codes.items())]
    parts += [f"{e}x{n}" for e, n in errors.items()]
    return " ".join(parts) or "-"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", "--requests", type=int, default=20, help="requests por endpoint")
    ap.add_argument("-c", "--concurrency", type=int, default=10)
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--only", default="", help="filtra por sistema: fc,pagacuotas,control")
    args = ap.parse_args()

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    eps = [e for e in ENDPOINTS if not only or e[1] in only]

    print("\n  Targets:")
    print(f"    fc          {LEGAL_FINANCE_URL}")
    print(f"    pagacuotas  {PAGACUOTAS_URL}")
    print(f"    control     {AT_INFORMA_URL}  (hive: {HIVE_SERVICE_URL})")
    print(f"  Carga: {args.requests} req/endpoint, concurrencia {args.concurrency}, timeout {args.timeout}s\n")

    results = [run_endpoint(ep, args.requests, args.concurrency, args.timeout) for ep in eps]

    hdr = f"{'endpoint':<26}{'kind':<7}{'auth':<6}{'p50':>7}{'p95':>8}{'p99':>8}{'req/s':>8}{'err%':>7}  status"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        auth = "OK" if r["auth_ok"] else "401"
        print(f"{r['name']:<26}{r['kind']:<7}{auth:<6}"
              f"{r['p50']:>6.0f}m{r['p95']:>7.0f}m{r['p99']:>7.0f}m"
              f"{r['throughput']:>8.1f}{r['err_rate']:>6.1f}%  {fmt_codes(r['codes'], r['errors'])}")
    print()

    bad = [r["name"] for r in results if not r["auth_ok"]]
    if bad:
        print(f"  [!] auth/red con problemas en: {', '.join(bad)}")
    else:
        print("  [OK] todos los hops respondieron con auth valida")


if __name__ == "__main__":
    main()

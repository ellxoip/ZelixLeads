#!/usr/bin/env python3
"""
Fase 2 — Stress con RAMPA de carga sobre el flujo de integraciones.

Sube la concurrencia por etapas (default 10 → 50 → 100) y, en cada etapa, mide
p50/p95/p99, throughput, error-rate y % de respuestas degradadas. Detecta el
"punto de quiebre": la etapa donde p95 se dispara o el error-rate supera el umbral.

Dos modos:
  SAFE (default): mismas sondas seguras que Fase 1 (GET de lectura + POST con body
                  vacío → 422 tras auth). NO escribe datos. Apto contra cualquier
                  entorno, incluso uno compartido, a baja/media carga.

  E2E  (--e2e):   flujo end-to-end real con datos sintéticos (prefijo STRESS-NNNN).
                  CREA registros → SOLO debe correrse contra STAGING aislado.
                  Doble seguro: requiere --e2e Y env STRESS_ALLOW_WRITES=1, y que
                  la DB NO sea la de producción (chequea el host).

Uso:
  python scripts/stress_e2e_ramp.py                          # rampa segura 10,50,100
  python scripts/stress_e2e_ramp.py --stages 10,25,50,100,200 --duration 8
  python scripts/stress_e2e_ramp.py --p95-budget 1500 --err-budget 2
  STRESS_ALLOW_WRITES=1 python scripts/stress_e2e_ramp.py --e2e   # solo en staging
"""
from __future__ import annotations

import argparse
import os
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=ENV_PATH)


def _u(name, d=""):
    return (os.getenv(name, d) or "").rstrip("/")


def _k(name):
    return (os.getenv(name) or "").strip()


LEGAL_FINANCE_URL = _u("LEGAL_FINANCE_URL", "http://localhost:4000")
PAGACUOTAS_URL    = _u("PAGACUOTAS_URL",    "http://localhost:4000")
HIVE_SERVICE_URL  = _u("HIVE_SERVICE_URL",  "http://localhost:3001")
AT_INFORMA_URL    = _u("AT_INFORMA_URL",    "http://localhost:3000")
DATABASE_URL      = os.getenv("DATABASE_URL", "")

# Sondas seguras (no escriben): (name, method, url, headers, body)
SAFE_PROBES = [
    ("fc:proceso-mora", "GET", f"{LEGAL_FINANCE_URL}/api/integrations/cobranza/proceso-mora",
     {"Authorization": f"Bearer {_k('PAGACUOTAS_INTERNAL_API_KEY')}"}, None),
    ("control:abogados", "GET", f"{AT_INFORMA_URL}/api/integration/abogados",
     {"x-integration-secret": _k("AT_INFORMA_INTEGRATION_SECRET")}, None),
    ("control:payment-needed", "POST", f"{AT_INFORMA_URL}/api/integration/payment-needed",
     {"x-integration-secret": _k("AT_INFORMA_INTEGRATION_SECRET")}, {}),
    ("control:reunion-lead", "POST", f"{AT_INFORMA_URL}/api/integration/reunion-lead",
     {"x-integration-secret": _k("AT_INFORMA_INTEGRATION_SECRET")}, {}),
]


def _pct(sorted_lat, p):
    if not sorted_lat:
        return 0.0
    i = min(len(sorted_lat) - 1, int(round(p / 100 * (len(sorted_lat) - 1))))
    return sorted_lat[i]


def _hit(client, probe, timeout, run_id):
    name, method, url, headers, body = probe
    h = {"Content-Type": "application/json",
         "X-Request-ID": f"{run_id}-{uuid.uuid4().hex[:8]}",
         **{k: v for k, v in headers.items() if v}}
    t0 = time.perf_counter()
    try:
        r = client.request(method, url, headers=h, json=body, timeout=timeout)
        return (time.perf_counter() - t0) * 1000, r.status_code, None
    except Exception as exc:  # noqa: BLE001
        return (time.perf_counter() - t0) * 1000, None, type(exc).__name__


def run_stage(conc, duration, timeout, run_id):
    """Corre carga a `conc` concurrentes durante `duration` s. Round-robin de sondas."""
    lat, codes, errors = [], Counter(), Counter()
    deadline = time.perf_counter() + duration
    n_probes = len(SAFE_PROBES)
    counter = {"i": 0}

    with httpx.Client(follow_redirects=True) as client:
        def worker(_):
            local = []
            while time.perf_counter() < deadline:
                idx = counter["i"] % n_probes
                counter["i"] += 1
                dt, code, err = _hit(client, SAFE_PROBES[idx], timeout, run_id)
                local.append((dt, code, err))
            return local

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as pool:
            for chunk in pool.map(worker, range(conc)):
                for dt, code, err in chunk:
                    lat.append(dt)
                    if err:
                        errors[err] += 1
                    else:
                        codes[code] += 1
        wall = time.perf_counter() - t0

    total = len(lat)
    n_err = sum(errors.values())
    ls = sorted(lat)
    return {
        "conc": conc, "total": total, "wall": wall,
        "p50": _pct(ls, 50), "p95": _pct(ls, 95), "p99": _pct(ls, 99),
        "throughput": total / wall if wall else 0.0,
        "err_rate": (n_err / total * 100) if total else 0.0,
        "codes": dict(codes), "errors": dict(errors),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="10,50,100", help="concurrencias por etapa")
    ap.add_argument("--duration", type=float, default=6.0, help="seg por etapa")
    ap.add_argument("--timeout", type=float, default=12.0)
    ap.add_argument("--p95-budget", type=float, default=1500.0, help="ms; p95 sobre esto = degradado")
    ap.add_argument("--err-budget", type=float, default=2.0, help="%% error-rate aceptable")
    ap.add_argument("--e2e", action="store_true", help="flujo e2e real (solo staging)")
    args = ap.parse_args()

    stages = [int(s) for s in args.stages.split(",") if s.strip()]
    run_id = f"STRESS-{uuid.uuid4().hex[:6]}"

    if args.e2e:
        prod_host = "pg-produccion" in DATABASE_URL
        if os.getenv("STRESS_ALLOW_WRITES") != "1" or prod_host:
            print("  [BLOQUEADO] --e2e requiere STRESS_ALLOW_WRITES=1 y una DB NO de producción.")
            print(f"             STRESS_ALLOW_WRITES={os.getenv('STRESS_ALLOW_WRITES')!r}  prod_db={prod_host}")
            print("             El flujo e2e CREA datos: úsalo solo contra staging aislado.")
            return
        print("  [E2E] modo end-to-end con datos sintéticos — pendiente de wiring de staging.")
        print("        (scaffold listo; conectar creación de lead→pago→caso cuando exista staging)")
        return

    print(f"\n  RAMPA DE CARGA (modo SAFE)  run_id={run_id}")
    print(f"  Targets: fc={LEGAL_FINANCE_URL}  pagacuotas={PAGACUOTAS_URL}  control={AT_INFORMA_URL}")
    print(f"  Etapas: {stages} concurrentes · {args.duration}s c/u · timeout {args.timeout}s")
    print(f"  Presupuesto: p95<{args.p95_budget:.0f}ms, error-rate<{args.err_budget:.1f}%\n")

    hdr = f"{'conc':>5}{'reqs':>8}{'p50':>8}{'p95':>8}{'p99':>8}{'req/s':>9}{'err%':>8}  veredicto"
    print(hdr)
    print("-" * len(hdr))

    breaking_point = None
    prev_p95 = None
    for conc in stages:
        r = run_stage(conc, args.duration, args.timeout, run_id)
        degraded = r["p95"] > args.p95_budget or r["err_rate"] > args.err_budget
        spike = prev_p95 is not None and prev_p95 > 0 and r["p95"] > prev_p95 * 2.5
        verdict = "OK"
        if degraded:
            verdict = "DEGRADADO"
        if spike:
            verdict = "QUIEBRE (p95 x2.5)"
        if (degraded or spike) and breaking_point is None:
            breaking_point = conc
        print(f"{r['conc']:>5}{r['total']:>8}{r['p50']:>7.0f}m{r['p95']:>7.0f}m{r['p99']:>7.0f}m"
              f"{r['throughput']:>9.1f}{r['err_rate']:>7.1f}%  {verdict}")
        prev_p95 = r["p95"]

    print()
    if breaking_point:
        print(f"  [!] Punto de quiebre detectado a ~{breaking_point} concurrentes.")
    else:
        print(f"  [OK] Sin degradacion hasta {stages[-1]} concurrentes (dentro de presupuesto).")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Backfill del Buscador Global 360 — Sub-paso A.1.

Rellena Contact.search_name y Contact.phone_norm en los registros existentes,
en lotes controlados (no carga toda la tabla en memoria ni hace un commit por
fila). Idempotente: puede correrse las veces que quieras.

Uso:
    cd backend && ./venv/bin/python -m scripts.backfill_search
    ./venv/bin/python -m scripts.backfill_search --batch 1000 --force
"""
from __future__ import annotations

import argparse
import sys

# Permite ejecutar tanto `python -m scripts.backfill_search` como directo.
if __package__ in (None, ""):
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import Contact
from app.search_utils import norm_text, phone_digits


def backfill(batch_size: int = 500, force: bool = False) -> int:
    """Recorre los contactos en lotes y actualiza las columnas derivadas.

    Por defecto solo toca filas sin `search_name` (incrementales). Con --force
    recalcula todas (útil si cambia la lógica de normalización).
    """
    db = SessionLocal()
    updated = 0
    try:
        q = db.query(Contact)
        if not force:
            q = q.filter(Contact.search_name.is_(None))
        total = q.count()
        print(f"→ {total} contactos a procesar (force={force}, batch={batch_size})")

        offset = 0
        while True:
            rows = (
                q.order_by(Contact.id)
                 .offset(0 if not force else offset)   # incremental se "consume" solo
                 .limit(batch_size)
                 .all()
            )
            if not rows:
                break
            for c in rows:
                full_name = " ".join(p for p in (c.name, c.razon_social) if p)
                c.search_name = norm_text(full_name)
                c.phone_norm = phone_digits(c.phone)
                updated += 1
            db.commit()
            print(f"  · {updated}/{total} actualizados")
            if force:
                offset += batch_size
                if offset >= total:
                    break
        print(f"✓ Backfill completo: {updated} contactos actualizados.")
        return updated
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Backfill search_name / phone_norm en Contact")
    ap.add_argument("--batch", type=int, default=500, help="tamaño de lote (default 500)")
    ap.add_argument("--force", action="store_true", help="recalcular todos los contactos")
    args = ap.parse_args()
    backfill(batch_size=args.batch, force=args.force)

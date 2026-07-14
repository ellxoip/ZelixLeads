"""Seed initial data: users, groups, areas, whatsapp configs."""
from .database import SessionLocal, engine, Base
from . import models
from .auth import hash_password


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.User).count() > 0:
            return

        # ── GROUPS ──────────────────────────────────────────────────
        groups = []
        group_names = [
            ("Grupo 1", "Matías / Camila"),
            ("Grupo 2", "Diego / Valentina"),
            ("Grupo 3", "Felipe / Antonia"),
            ("Grupo 4", "Ignacio / Josefa"),
            ("Grupo 5", "Tomás / Fernanda"),
        ]
        for name, desc in group_names:
            g = models.Group(name=name, description=desc)
            db.add(g)
            groups.append(g)
        db.flush()

        # ── WHATSAPP CONFIGS ─────────────────────────────────────────
        # Each group has 2 numbers:
        # WA-A: Deuda Ejecutiva + Contabilidad
        # WA-B: Facturas Falsas + Bloqueo de Folios
        real_phones = [
            ("+56957115528", "CONFIGURAR"),   # Grupo 1 — WA-A real, WA-B pendiente
            ("CONFIGURAR",   "CONFIGURAR"),   # Grupo 2 — pendientes
            ("CONFIGURAR",   "CONFIGURAR"),   # Grupo 3
            ("CONFIGURAR",   "CONFIGURAR"),   # Grupo 4
            ("CONFIGURAR",   "CONFIGURAR"),   # Grupo 5
        ]
        wp_configs = {}
        for i, g in enumerate(groups):
            phone_a, phone_b = real_phones[i]
            wp1 = models.WhatsAppConfig(
                name=f"{g.name} - WhatsApp A (Deuda/Contabilidad)",
                phone_number=phone_a,
                api_provider="manual",
                group_id=g.id,
            )
            wp2 = models.WhatsAppConfig(
                name=f"{g.name} - WhatsApp B (Facturas/Bloqueos)",
                phone_number=phone_b,
                api_provider="manual",
                group_id=g.id,
            )
            db.add(wp1)
            db.add(wp2)
            wp_configs[g.id] = (wp1, wp2)
        db.flush()

        # ── AREAS per group ──────────────────────────────────────────
        area_defs = [
            # (name, wp_index 0=A 1=B, kpi)
            ("Deuda Ejecutiva", 0, 50),
            ("Contabilidad", 0, 50),
            ("Facturas Falsas", 1, 50),
            ("Bloqueo de Folios", 1, 50),
            ("Convenio TGR", 0, 80),
            ("CRM Genético SII", 0, 50),
            ("Grandes Empresas", 0, 20),
            ("Planificación Tributaria", 0, 20),
            ("PERDONAZO", 0, 50),
            ("Quiebra Empresa", 0, 50),
            ("Quiebra Persona", 0, 50),
            ("Reorganización", 0, 50),
        ]
        for g in groups:
            for name, wp_idx, kpi in area_defs:
                wp = wp_configs[g.id][wp_idx]
                area = models.Area(name=name, group_id=g.id, whatsapp_config_id=wp.id, kpi_leads=kpi)
                db.add(area)
        db.flush()

        # ── USERS (credenciales de prueba @zelix.cl) ─────────────────
        tecnico = models.User(
            name="Técnico Zelix",
            email="tecnico@zelix.cl",
            password_hash=hash_password("Tecnico2026!"),
            role="tecnico",
            group_id=None,
        )
        db.add(tecnico)

        admin = models.User(
            name="Admin Zelix",
            email="admin@zelix.cl",
            password_hash=hash_password("Admin2026!"),
            role="superadmin",
            group_id=None,
        )
        subadmin = models.User(
            name="Sofía Rojas",
            email="subadmin@zelix.cl",
            password_hash=hash_password("Sub2026!"),
            role="subadmin",
            group_id=groups[1].id,
        )
        db.add(admin)
        db.add(subadmin)

        # Grupo 1
        vendedor1 = models.User(name="Matías Vega", email="vendedor1@zelix.cl",
                                password_hash=hash_password("Zelix2026!"), role="vendedor", group_id=groups[0].id)
        agenda1 = models.User(name="Camila Torres", email="agenda1@zelix.cl",
                              password_hash=hash_password("Zelix2026!"), role="agendadora", group_id=groups[0].id)
        db.add(vendedor1); db.add(agenda1)

        # Grupo 2
        vendedor2 = models.User(name="Diego Fuentes", email="vendedor2@zelix.cl",
                                password_hash=hash_password("Zelix2026!"), role="vendedor", group_id=groups[1].id)
        agenda2 = models.User(name="Valentina Ruiz", email="agenda2@zelix.cl",
                              password_hash=hash_password("Zelix2026!"), role="agendadora", group_id=groups[1].id)
        db.add(vendedor2); db.add(agenda2)

        # Grupo 3
        vendedor3 = models.User(name="Felipe Soto", email="vendedor3@zelix.cl",
                                password_hash=hash_password("Zelix2026!"), role="vendedor", group_id=groups[2].id)
        agenda3 = models.User(name="Antonia Pérez", email="agenda3@zelix.cl",
                              password_hash=hash_password("Zelix2026!"), role="agendadora", group_id=groups[2].id)
        db.add(vendedor3); db.add(agenda3)

        # Grupo 4 — verificador de pagos
        verificador = models.User(name="Ignacio Silva", email="verificador@zelix.cl",
                                  password_hash=hash_password("Zelix2026!"), role="verificador", group_id=groups[3].id)
        agenda4 = models.User(name="Josefa Muñoz", email="agenda4@zelix.cl",
                              password_hash=hash_password("Zelix2026!"), role="agendadora", group_id=groups[3].id)
        db.add(verificador); db.add(agenda4)

        # Grupo 5
        vendedor5 = models.User(name="Tomás Herrera", email="vendedor5@zelix.cl",
                                password_hash=hash_password("Zelix2026!"), role="vendedor", group_id=groups[4].id)
        agenda5 = models.User(name="Fernanda Castro", email="agenda5@zelix.cl",
                              password_hash=hash_password("Zelix2026!"), role="agendadora", group_id=groups[4].id)
        db.add(vendedor5); db.add(agenda5)

        db.commit()
        print("✅ Database seeded successfully!")
        print("\n📋 CREDENCIALES DE PRUEBA:")
        print("  Técnico:     tecnico@zelix.cl / Tecnico2026!")
        print("  SuperAdmin:  admin@zelix.cl / Admin2026!")
        print("  SubAdmin:    subadmin@zelix.cl / Sub2026!")
        print("  Verificador: verificador@zelix.cl / Zelix2026!")
        print("  Vendedores:  vendedor1..5@zelix.cl / Zelix2026!")
        print("  Agendadoras: agenda1..5@zelix.cl / Zelix2026!")
    except Exception as e:
        db.rollback()
        print(f"❌ Seed error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()

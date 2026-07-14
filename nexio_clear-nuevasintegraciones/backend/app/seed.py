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
            ("Grupo 1", "Jonathan / Marcela"),
            ("Grupo 2", "Nicolás J. / Aizel"),
            ("Grupo 3", "Jorge Javier / Francisca"),
            ("Grupo 4", "Dante Seura / Enma"),
            ("Grupo 5", "Nicole / Stephany"),
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

        # ── USERS ────────────────────────────────────────────────────
        tecnico = models.User(
            name="Técnico Sistema",
            email="tecnico@abogadostributarios.cl",
            password_hash=hash_password("Tecnico2024!"),
            role="tecnico",
            group_id=None,
        )
        db.add(tecnico)

        jorge = models.User(
            name="Jorge Castillo",
            email="jorge@abogadostributarios.cl",
            password_hash=hash_password("Admin2024!"),
            role="superadmin",
            group_id=None,
        )
        nicolas_admin = models.User(
            name="Nicolás Jiménez",
            email="nicolas@abogadostributarios.cl",
            password_hash=hash_password("Sub2024!"),
            role="subadmin",
            group_id=groups[1].id,
        )
        db.add(jorge)
        db.add(nicolas_admin)

        # Grupo 1
        jonathan = models.User(name="Jonathan Cisternas", email="jonathan@abogadostributarios.cl",
                               password_hash=hash_password("Pass2024!"), role="vendedor", group_id=groups[0].id)
        marcela = models.User(name="Marcela", email="marcela@abogadostributarios.cl",
                              password_hash=hash_password("Pass2024!"), role="agendadora", group_id=groups[0].id)
        db.add(jonathan); db.add(marcela)

        # Grupo 2
        nicolas_v = models.User(name="Nicolás J.", email="nicolasj@abogadostributarios.cl",
                                password_hash=hash_password("Pass2024!"), role="vendedor", group_id=groups[1].id)
        aizel = models.User(name="Aizel Echezuría", email="aizel@abogadostributarios.cl",
                            password_hash=hash_password("Pass2024!"), role="agendadora", group_id=groups[1].id)
        db.add(nicolas_v); db.add(aizel)

        # Grupo 3
        jorge_javier = models.User(name="Jorge Javier", email="jorgejavier@abogadostributarios.cl",
                                   password_hash=hash_password("Pass2024!"), role="vendedor", group_id=groups[2].id)
        francisca = models.User(name="Francisca", email="francisca@abogadostributarios.cl",
                                password_hash=hash_password("Pass2024!"), role="agendadora", group_id=groups[2].id)
        db.add(jorge_javier); db.add(francisca)

        # Grupo 4 — Dante es vendedor especial que ve pagos
        dante = models.User(name="Dante Seura", email="dante@abogadostributarios.cl",
                            password_hash=hash_password("Pass2024!"), role="verificador", group_id=groups[3].id)
        enma = models.User(name="Enma", email="enma@abogadostributarios.cl",
                           password_hash=hash_password("Pass2024!"), role="agendadora", group_id=groups[3].id)
        db.add(dante); db.add(enma)

        # Grupo 5
        nicole = models.User(name="Nicole", email="nicole@abogadostributarios.cl",
                             password_hash=hash_password("Pass2024!"), role="vendedor", group_id=groups[4].id)
        stephany = models.User(name="Stephany", email="stephany@abogadostributarios.cl",
                               password_hash=hash_password("Pass2024!"), role="agendadora", group_id=groups[4].id)
        db.add(nicole); db.add(stephany)

        db.commit()
        print("✅ Database seeded successfully!")
        print("\n📋 CREDENTIALS:")
        print("  Tecnico:    tecnico@abogadostributarios.cl / Tecnico2024!")
        print("  SuperAdmin: jorge@abogadostributarios.cl / Admin2024!")
        print("  SubAdmin:   nicolas@abogadostributarios.cl / Sub2024!")
        print("  Dante:      dante@abogadostributarios.cl / Pass2024!")
        print("  All others: [email] / Pass2024!")
    except Exception as e:
        db.rollback()
        print(f"❌ Seed error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()

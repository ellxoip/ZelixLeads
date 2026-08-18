"""
SEPARAR EL NEGOCIO "ZELIX" DEL DE ABOGADOS — decisión (A) de §12.9.2.1 del maestro.

── Qué problema resuelve ──
El número de WhatsApp de Zelix (`whatsapp_configs` con `phone_number_id` de Meta)
desembocaba en el negocio "Abogados Tributarios", el rubro que ya no está
vigente: los prospectos de Zelix caían dentro del pipeline de los abogados. Y ese
negocio es `tipo = "abogados"`, al que el CRM le PROHÍBE crear etapas propias
(`pipeline_stages.py`), así que las peceras no se podían configurar donde caían
los leads.

── Cómo se ejecuta ──
    python3 scripts/separar_negocio_zelix.py            # SIMULA. No escribe nada.
    python3 scripts/separar_negocio_zelix.py --aplicar  # escribe, en UNA transacción

Simula por defecto a propósito: esto toca datos de producción de un CRM en uso.

── Lo que NO hace, y por qué ──
No inventa áreas ni usuarios que ya existen. El área "Zelix — Ventas" y la
configuración de WhatsApp ya estaban creadas dentro del negocio de abogados: se
MUEVEN, no se duplican. Duplicarlas dejaría dos áreas con el mismo nombre y
nadie sabría cuál mira el equipo.

── La trampa que este script existe para no pisar ──
`webhooks.py::_crear_lead_automatico` exige área, agendadora y vendedor para
crear un Lead, y **si falta alguno no crea el lead pero igual guarda el mensaje**:
el prospecto entra y nadie lo ve, sin un solo error en los registros. Al mover la
configuración a un negocio nuevo eso se rompería en silencio. Por eso acá se
verifica ANTES y DESPUÉS que las tres piezas se resuelvan:

  · área      → la del propio config (`whatsapp_config_id`), que se mueve con él;
  · agendadora→ `config.owner_user_id`, que no depende del grupo;
  · vendedor  → si no hay en el grupo, el código cae a la agendadora.

── Por qué el negocio nuevo necesita su propio usuario ──
`auth.get_visible_group_ids` limita lo que se ve al grupo del usuario (o a su
negocio raíz). Ninguna cuenta actual pertenecería al negocio "Zelix", así que sin
un superadmin propio los leads existirían y **nadie podría verlos** — que es la
misma falla silenciosa, un piso más arriba.
"""
import json
import os
import secrets
import stat
import sys

import psycopg2

# ── Constantes de la migración, todas verificadas contra producción ──────────
NOMBRE_NEGOCIO = "Zelix"
# `tipo` es texto libre; lo único que el código mira es si vale "abogados", que
# fuerza el pipeline fijo. Se usa "otro" —valor ya aceptado por el panel técnico
# (`NEGOCIO_TIPOS`)— en vez de inventar un rubro nuevo para un solo inquilino.
TIPO_NEGOCIO = "otro"
CORREO_ADMIN = "zelix@zelix.cl"
NOMBRE_ADMIN = "Zelix"
ARCHIVO_CREDENCIALES = os.path.expanduser("~/.zelix-credenciales-crm.json")

# Las etapas del pipeline de Zelix. Las cuatro primeras son las peceras (§12.9.2);
# las otras existen porque el CÓDIGO del CRM las escribe solo —`agenda_whatsapp`
# mueve a `reunion`, `seguimiento_asistente` a `altamente_interesado`, `payments`
# a `pagado_confirmado`— y una etapa que el sistema escribe y nadie declaró deja
# al lead fuera del tablero.
ETAPAS = [
    ("audiencia", "Audiencia", "#64748b", 1),
    ("contacto", "Contacto", "#0ea5e9", 2),
    ("lead", "Lead", "#6366f1", 3),
    ("reunion", "Reunión agendada", "#a855f7", 4),
    ("altamente_interesado", "Altamente interesado", "#f59e0b", 5),
    ("pagado_confirmado", "Cliente", "#22c55e", 6),
]


def cargar_env(ruta=".env"):
    env = {}
    try:
        for linea in open(ruta):
            linea = linea.strip().removeprefix("export ").strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            k, v = linea.split("=", 1)
            env[k] = v.strip().strip("\"'")
    except FileNotFoundError:
        pass
    return env


def hash_password(clave: str) -> str:
    """El MISMO hash que usa el CRM. Se importa en vez de reimplementarse."""
    sys.path.insert(0, os.getcwd())
    from app.auth import hash_password as h

    return h(clave)


def guardar_credencial(correo: str, clave: str) -> str:
    """Deja la clave donde ya viven las otras, con permisos 600.

    Se escribe al archivo y NO se imprime: una clave en la salida de un comando
    termina en el historial de la terminal y en cualquier registro que la capture.
    """
    try:
        with open(ARCHIVO_CREDENCIALES) as f:
            cuentas = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        cuentas = []
    if any(c.get("email") == correo for c in cuentas):
        return "ya estaba en el archivo, no se tocó"
    cuentas.append({"email": correo, "rol": "superadmin", "pw": clave})
    with open(ARCHIVO_CREDENCIALES, "w") as f:
        json.dump(cuentas, f, indent=2, ensure_ascii=False)
    os.chmod(ARCHIVO_CREDENCIALES, stat.S_IRUSR | stat.S_IWUSR)
    return f"agregada a {ARCHIVO_CREDENCIALES} (chmod 600)"


def main():
    aplicar = "--aplicar" in sys.argv
    env = cargar_env()
    url = env.get("DIRECT_DATABASE_URL") or env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        print("✖ Falta DATABASE_URL: se lee del .env de backend/")
        sys.exit(1)

    conn = psycopg2.connect(url)
    conn.autocommit = False
    cur = conn.cursor()

    def q(sql, args=()):
        cur.execute(sql, args)
        return cur.fetchall()

    print("\n══ SEPARAR EL NEGOCIO ZELIX ══════════════════════════════════════")
    print(f"   Modo: {'APLICAR (escribe)' if aplicar else 'SIMULACIÓN (no escribe nada)'}\n")

    # ── Antes ────────────────────────────────────────────────────────────────
    configs = q(
        "select id, group_id, owner_user_id, name from whatsapp_configs where phone_number_id is not null"
    )
    if len(configs) != 1:
        print(f"✖ Se esperaba exactamente UNA configuración con phone_number_id y hay {len(configs)}.")
        print("  Con más de una, cuál es 'la de Zelix' deja de ser evidente: no se adivina.")
        sys.exit(1)
    cfg_id, cfg_grupo, cfg_owner, cfg_nombre = configs[0]
    print(f"   Config de WhatsApp: #{cfg_id} «{cfg_nombre}» · grupo actual {cfg_grupo} · owner {cfg_owner}")

    areas = q("select id, name, group_id from areas where whatsapp_config_id = %s", (cfg_id,))
    if not areas:
        print("✖ Esa configuración no tiene área propia. Sin área, el webhook no crea leads.")
        sys.exit(1)
    print(f"   Áreas que cuelgan de ella: {[(a[0], a[1]) for a in areas]}")

    ids_area = [a[0] for a in areas]
    leads = q("select id, current_stage, group_id from leads where area_id = any(%s)", (ids_area,))
    print(f"   Leads en esas áreas: {[(l[0], l[1]) for l in leads] or 'ninguno'}")

    if not cfg_owner:
        print("✖ La configuración no tiene `owner_user_id`. Es de donde sale la agendadora")
        print("  cuando el grupo no tiene una: sin eso, el webhook dejaría de crear leads.")
        sys.exit(1)

    # ── 1. El negocio ────────────────────────────────────────────────────────
    fila = q("select id, tipo from groups where name = %s", (NOMBRE_NEGOCIO,))
    if fila:
        negocio_id, tipo = fila[0][0], fila[0][1]
        print(f"\n   1. Negocio «{NOMBRE_NEGOCIO}» YA existe (id {negocio_id}, tipo {tipo}) — no se crea de nuevo")
    else:
        print(f"\n   1. Crear negocio «{NOMBRE_NEGOCIO}» (tipo={TIPO_NEGOCIO}, raíz)")
        if aplicar:
            cur.execute(
                "insert into groups (name, description, negocio_id, tipo, plan) values (%s,%s,null,%s,'basico') returning id",
                (NOMBRE_NEGOCIO, "Zelix SaaS — prospectos propios, separados del rubro abogados", TIPO_NEGOCIO),
            )
            negocio_id = cur.fetchone()[0]
        else:
            negocio_id = -1

    # ── 2. El superadmin del negocio ─────────────────────────────────────────
    usuario = q("select id, group_id from users where email = %s", (CORREO_ADMIN,))
    if usuario:
        print(f"   2. Usuario {CORREO_ADMIN} YA existe (id {usuario[0][0]}) — no se crea de nuevo")
        nota_credencial = "sin cambios"
    else:
        print(f"   2. Crear superadmin {CORREO_ADMIN} en el negocio (sin él, los leads existen y nadie los ve)")
        nota_credencial = "se generará al aplicar"
        if aplicar:
            clave = secrets.token_urlsafe(12)
            # `failed_login_attempts` va explícito porque su valor por defecto
            # vive en el MODELO de SQLAlchemy y no en la columna: insertando por
            # SQL directo la fila se rechaza por NOT NULL. La primera corrida se
            # cayó justo ahí, y la transacción revirtió sin dejar nada a medias
            # — que es exactamente para lo que estaba en una transacción.
            cur.execute(
                "insert into users (name, email, password_hash, role, group_id, is_active, failed_login_attempts)"
                " values (%s,%s,%s,'superadmin',%s,true,0) returning id",
                (NOMBRE_ADMIN, CORREO_ADMIN, hash_password(clave), negocio_id),
            )
            nota_credencial = guardar_credencial(CORREO_ADMIN, clave)

    # ── 3. Mover el área, la configuración y los leads ───────────────────────
    print(f"   3. Mover al negocio: área(s) {ids_area}, config #{cfg_id}, {len(leads)} lead(s)")
    if aplicar:
        cur.execute("update areas set group_id = %s where id = any(%s)", (negocio_id, ids_area))
        cur.execute("update whatsapp_configs set group_id = %s where id = %s", (negocio_id, cfg_id))
        cur.execute("update leads set group_id = %s where area_id = any(%s)", (negocio_id, ids_area))

    # ── 4. Las etapas ────────────────────────────────────────────────────────
    print(f"   4. Declarar {len(ETAPAS)} etapas del pipeline")
    if aplicar:
        for clave, nombre, color, orden in ETAPAS:
            cur.execute(
                """insert into pipeline_stages (negocio_id, key, name, color, "order")
                   select %s,%s,%s,%s,%s
                   where not exists (select 1 from pipeline_stages where negocio_id=%s and key=%s)""",
                (negocio_id, clave, nombre, color, orden, negocio_id, clave),
            )

    if not aplicar:
        conn.rollback()
        print("\n   ── SIMULACIÓN: no se escribió nada. Repetir con --aplicar ──\n")
        return

    # ── Verificación DENTRO de la transacción: si algo no cuadra, no se guarda ──
    print("\n   ── Verificación antes de confirmar ──")
    problemas = []

    area_ok = q("select count(*) from areas where whatsapp_config_id = %s and group_id = %s", (cfg_id, negocio_id))[0][0]
    if area_ok < 1:
        problemas.append("la configuración quedó sin área en el negocio nuevo: el webhook no crearía leads")

    owner_ok = q("select is_active from users where id = %s", (cfg_owner,))
    if not owner_ok or not owner_ok[0][0]:
        problemas.append("el `owner_user_id` de la configuración no es un usuario activo: no habría agendadora")

    admin_ok = q("select count(*) from users where group_id = %s and role = 'superadmin' and is_active", (negocio_id,))[0][0]
    if admin_ok < 1:
        problemas.append("el negocio quedó sin superadmin: los leads existirían y nadie podría verlos")

    etapas_ok = q("select count(*) from pipeline_stages where negocio_id = %s", (negocio_id,))[0][0]
    if etapas_ok < len(ETAPAS):
        problemas.append(f"se declararon {etapas_ok} etapas de {len(ETAPAS)}")

    huerfanos = q("select count(*) from leads where area_id = any(%s) and group_id <> %s", (ids_area, negocio_id))[0][0]
    if huerfanos:
        problemas.append(f"{huerfanos} lead(s) quedaron con el área en un negocio y el grupo en otro")

    if problemas:
        conn.rollback()
        print("\n✖ NO SE GUARDÓ NADA. La verificación encontró:")
        for p in problemas:
            print(f"    · {p}")
        sys.exit(1)

    conn.commit()
    print(f"   ✔ negocio {negocio_id} · área en su lugar · superadmin presente · {etapas_ok} etapas · leads consistentes")
    print(f"   ✔ credencial: {nota_credencial}")
    print("\n✔ APLICADO.\n")


if __name__ == "__main__":
    main()

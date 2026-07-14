-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA DE USUARIOS/CONTACTOS DE PRUEBA
-- ═══════════════════════════════════════════════════════════════════════════
-- Registros objetivo:
--   Test Jedi                    | +56957115528  | jedi@gmail.com
--   Test Truco                   | +56969036226  | truco@gmail.com
--   Tania de Abogados            | +56955344037  | tania@gmail.com
--   Felipe test                  | +447710173736 | felipetest@gmail.com
--   Luis Vecchionacce quiero     | +56992211143  | lvecchionacce@gmail.com
--   Cliente Demo SpA             | 000000000     | cliente_777777777@pagacuotas.local
--   Test prueba                  | +56965002990  | testprueba@gmail.com
--
-- ⚠️  IMPORTANTE
--   1. Ejecuta SIEMPRE el SELECT de seguridad primero y revisa fila por fila.
--   2. Ejecuta el DELETE dentro de una transacción: BEGIN; ... ; COMMIT;
--      (si el SELECT posterior al DELETE muestra algo raro: ROLLBACK;)
--   3. Si la tabla tiene claves foráneas (leads, mensajes, eventos), revisa
--      si el esquema usa ON DELETE CASCADE o si debes borrar los hijos antes.
--
-- Reemplaza los placeholders:
--   [TU_TABLA]        → nombre real de la tabla (p.ej. contacts, users, clientes)
--   [COLUMNA_EMAIL]   → columna de email      (p.ej. email)
--   [COLUMNA_TELEFONO]→ columna de teléfono   (p.ej. phone, telefono)
--   [COLUMNA_NOMBRE]  → columna de nombre     (p.ej. name, nombre, razon_social)
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- VARIANTE 1 · POR EMAIL (la más segura: el email es el dato más unívoco)
-- ───────────────────────────────────────────────────────────────────────────

-- Paso 1 · SELECT de seguridad — revisa que salgan SOLO los 7 esperados:
SELECT *
FROM [TU_TABLA]
WHERE lower([COLUMNA_EMAIL]) IN (
    'jedi@gmail.com',
    'truco@gmail.com',
    'tania@gmail.com',
    'felipetest@gmail.com',
    'lvecchionacce@gmail.com',
    'cliente_777777777@pagacuotas.local',
    'testprueba@gmail.com'
);

-- Paso 2 · DELETE (dentro de transacción):
BEGIN;
DELETE FROM [TU_TABLA]
WHERE lower([COLUMNA_EMAIL]) IN (
    'jedi@gmail.com',
    'truco@gmail.com',
    'tania@gmail.com',
    'felipetest@gmail.com',
    'lvecchionacce@gmail.com',
    'cliente_777777777@pagacuotas.local',
    'testprueba@gmail.com'
);
-- Verifica el número de filas afectadas (esperado: 7 o menos). Si cuadra:
COMMIT;
-- Si NO cuadra: ROLLBACK;


-- ───────────────────────────────────────────────────────────────────────────
-- VARIANTE 2 · POR TELÉFONO (normaliza + y espacios para atrapar formatos mixtos)
-- ───────────────────────────────────────────────────────────────────────────

-- Paso 1 · SELECT de seguridad:
SELECT *
FROM [TU_TABLA]
WHERE replace(replace(replace([COLUMNA_TELEFONO], '+', ''), ' ', ''), '-', '') IN (
    '56957115528',
    '56969036226',
    '56955344037',
    '447710173736',
    '56992211143',
    '000000000',
    '56965002990'
);

-- Paso 2 · DELETE (dentro de transacción):
BEGIN;
DELETE FROM [TU_TABLA]
WHERE replace(replace(replace([COLUMNA_TELEFONO], '+', ''), ' ', ''), '-', '') IN (
    '56957115528',
    '56969036226',
    '56955344037',
    '447710173736',
    '56992211143',
    '000000000',
    '56965002990'
);
COMMIT;
-- Si no cuadra: ROLLBACK;


-- ───────────────────────────────────────────────────────────────────────────
-- VARIANTE 3 · POR NOMBRE (la MENOS segura: puede haber homónimos — úsala solo
--              si email/teléfono no existen en la tabla, y revisa el SELECT
--              con doble atención)
-- ───────────────────────────────────────────────────────────────────────────

-- Paso 1 · SELECT de seguridad:
SELECT *
FROM [TU_TABLA]
WHERE lower(trim([COLUMNA_NOMBRE])) IN (
    'test jedi',
    'test truco',
    'tania de abogados',
    'felipe test',
    'luis vecchionacce quiero',
    'cliente demo spa',
    'test prueba'
);

-- Paso 2 · DELETE (dentro de transacción):
BEGIN;
DELETE FROM [TU_TABLA]
WHERE lower(trim([COLUMNA_NOMBRE])) IN (
    'test jedi',
    'test truco',
    'tania de abogados',
    'felipe test',
    'luis vecchionacce quiero',
    'cliente demo spa',
    'test prueba'
);
COMMIT;
-- Si no cuadra: ROLLBACK;

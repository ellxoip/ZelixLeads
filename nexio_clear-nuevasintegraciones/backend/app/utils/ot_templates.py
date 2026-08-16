"""Plantillas legales de cada tipo de OT, portadas desde el modal del frontend.

Cada entrada describe las secciones que deben aparecer en el PDF (en el mismo
orden y wording que en `frontend/src/components/WorkOrderModal.tsx`). El
generador `_build_ot_pdf` consume este catálogo para emitir el documento que
viaja a Hive-service-control al pasar el lead a `pago_comprometido`.

Tipos de bloque:
- ``body``      : párrafo justificado (puede ser una lista de párrafos).
- ``bullets``   : lista con viñetas.
- ``ai_field``  : valor variable tomado de ``fields[key]`` (típicamente lo
                  completa la IA). Se imprime tal cual si existe.
- ``honorarios``: sección de honorarios con tabla y, opcionalmente, datos
                  bancarios.
- ``acceptance``: cierre con texto fijo de aceptación.

Las claves ``has_own_client`` reflejan el set ``HAS_OWN_CLIENT`` del modal: los
tipos que ya emiten su propia sección "I. IDENTIFICACIÓN" no necesitan la sección
genérica "I. INDIVIDUALIZACIÓN DEL CLIENTE".
"""
from __future__ import annotations

from typing import Any

HAS_OWN_CLIENT = {
    "liquidacion_juridica",
    "liquidacion_natural",
    "defensa_ejecutiva",
    "proteccion_patrimonial",
    "renegociacion",
    "alzamiento",
}

# Bloques compartidos -------------------------------------------------------

_OBLIGACIONES_CLIENTE_TRIBUTARIO = {
    "kind": "section",
    "title": "VII. OBLIGACIONES DEL CLIENTE",
    "blocks": [
        {"kind": "body", "text": "El cliente se obliga a:"},
        {
            "kind": "bullets",
            "items": [
                "Entregar oportunamente todos los antecedentes requeridos para la adecuada tramitación del procedimiento.",
                "Informar cualquier notificación, requerimiento o actuación relacionada con las deudas tributarias materia de esta gestión.",
                "Mantener comunicación activa durante la vigencia del procedimiento.",
            ],
        },
    ],
}

_ACCEPTANCE_BODY = [
    "Las partes dejan constancia que la aceptación expresa de los servicios profesionales indicados en la presente orden de trabajo se entenderá materializada mediante el pago del abono inicial acordado entre las partes.",
    "Dicho pago constituirá señal inequívoca de aceptación de las condiciones de prestación de servicios y autorización para iniciar las gestiones profesionales correspondientes.",
]


def _section(title: str, *blocks: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "section", "title": title, "blocks": list(blocks)}


def _body(*paragraphs: str) -> dict[str, Any]:
    return {"kind": "body", "paragraphs": list(paragraphs)}


def _bullets(*items: str) -> dict[str, Any]:
    return {"kind": "bullets", "items": list(items)}


def _ai_field(label: str, key: str) -> dict[str, Any]:
    return {"kind": "ai_field", "label": label, "key": key}


def _honorarios(show_bank: bool = False) -> dict[str, Any]:
    return {"kind": "honorarios", "show_bank": show_bank}


def _acceptance(section_num: str) -> dict[str, Any]:
    return {"kind": "acceptance", "section_num": section_num}


# Catálogo --------------------------------------------------------------------

OT_CONTENT: dict[str, list[dict[str, Any]]] = {
    "prescripcion": [
        _section(
            "II. OBJETO DE LA CONTRATACIÓN",
            _body(
                "Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales consistentes en la revisión, análisis y tramitación de acciones administrativas y/o judiciales destinadas a obtener la prescripción de deudas tributarias mantenidas ante la Tesorería General de la República y/o Servicio de Impuestos Internos, conforme a lo dispuesto en el artículo 200 del Código Tributario y demás normas aplicables.",
                "La presente gestión tiene por finalidad obtener la declaración de prescripción de las obligaciones tributarias que legalmente correspondan y lograr la eliminación de las deudas registradas a nombre del contribuyente.",
            ),
        ),
        _section(
            "III. SERVICIOS INCLUIDOS",
            _body("La presente orden de trabajo incluye:"),
            _bullets(
                "Revisión y análisis de antecedentes tributarios y cartolas de deuda.",
                "Estudio de prescripción conforme al artículo 200 del Código Tributario y normativa complementaria.",
                "Determinación de periodos tributarios susceptibles de prescripción.",
                "Elaboración de estrategia jurídica y tributaria.",
                "Preparación y presentación de escritos, solicitudes y antecedentes administrativos y/o judiciales que correspondan.",
                "Tramitación integral del procedimiento de prescripción tributaria.",
                "Seguimiento de actuaciones ante Tesorería General de la República, Servicio de Impuestos Internos y/o tribunales competentes.",
                "Asistencia a comparendos, audiencias o reuniones administrativas que fueren necesarias en primera instancia.",
                "Gestión destinada a obtener la eliminación total o parcial de las deudas prescritas registradas a nombre del contribuyente.",
                "Obtención y entrega final de certificado emitido por Tesorería General de la República que indique que el RUT del contribuyente no mantiene deuda tributaria pendiente, según corresponda.",
            ),
        ),
        _section(
            "IV. FUNDAMENTOS NORMATIVOS",
            _body("La presente gestión se desarrollará conforme a las disposiciones contenidas en:"),
            _bullets(
                "Artículo 200 del Código Tributario.",
                "Normas sobre prescripción contenidas en el Código Tributario.",
                "DFL N°1 de 1994 del Ministerio de Hacienda.",
                "Normativa administrativa vigente de Tesorería General de la República y Servicio de Impuestos Internos.",
            ),
        ),
        _section(
            "V. PLAZO ESTIMADO DEL PROCEDIMIENTO",
            _ai_field("Plazo estimado", "plazo_estimado"),
        ),
        _honorarios(),
        _OBLIGACIONES_CLIENTE_TRIBUTARIO,
        _acceptance("VIII"),
    ],
    "desbloqueo": [
        _section(
            "II. OBJETO DE LA CONTRATACIÓN",
            _body(
                "Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales destinados al levantamiento de bloqueos, restricciones y/o anotaciones registradas por el Servicio de Impuestos Internos respecto del contribuyente, que afecten su situación tributaria y capacidad de emisión de documentos tributarios electrónicos.",
            ),
        ),
        _section(
            "III. SERVICIOS INCLUIDOS",
            _bullets(
                "Revisión y análisis de anotaciones, bloqueos y observaciones registradas por el SII.",
                "Elaboración de estrategia administrativa para el levantamiento de observaciones.",
                "Presentación de escritos, solicitudes y documentación ante el SII.",
                "Asistencia a reuniones, fiscalizaciones o audiencias ante funcionarios del SII.",
                "Seguimiento integral del procedimiento hasta su resolución.",
                "Obtención de folios de emergencia para continuidad operacional del contribuyente.",
            ),
        ),
        _section(
            "IV. FOLIOS DE EMERGENCIA Y CONTINUIDAD OPERACIONAL",
            _body(
                "En paralelo al procedimiento de desbloqueo tributario, se activará de forma inmediata la solicitud y obtención de folios de emergencia ante el SII, permitiendo al cliente emitir documentación tributaria dentro de un plazo aproximado de una semana.",
            ),
        ),
        _section("V. PLAZO ESTIMADO DEL PROCEDIMIENTO", _ai_field("Plazo estimado", "plazo_estimado")),
        _section("VI. OBSERVACIONES", _ai_field("Observaciones", "observaciones_adicionales")),
        _honorarios(),
        _section(
            "VIII. OBLIGACIONES DEL CLIENTE",
            _body(
                "El cliente se obliga a entregar oportunamente la información y antecedentes requeridos, informar cualquier nueva notificación del SII, y mantener comunicación activa.",
            ),
        ),
        _acceptance("IX"),
    ],
    "desbloqueo_contable": [
        _section(
            "II. OBJETO DE LA CONTRATACIÓN",
            _body(
                "Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales destinados al levantamiento de bloqueos, restricciones y/o anotaciones registradas por el Servicio de Impuestos Internos respecto del contribuyente, que afecten su situación tributaria y capacidad de emisión de documentos tributarios electrónicos.",
            ),
        ),
        _section(
            "III. SERVICIOS INCLUIDOS",
            _bullets(
                "Revisión y análisis de anotaciones, bloqueos y observaciones registradas por el SII.",
                "Elaboración de estrategia administrativa para el levantamiento de observaciones.",
                "Presentación de escritos, solicitudes y documentación ante el SII.",
                "Asistencia a reuniones, fiscalizaciones o audiencias ante funcionarios del SII.",
                "Rectificación y/o declaración de impuestos pendientes (IVA u otros).",
                "Normalización del estado tributario ante SII.",
                "Presentación ante el SII de la documentación contable elaborada.",
                "Seguimiento integral del procedimiento hasta su resolución.",
                "Obtención de folios de emergencia para continuidad operacional del contribuyente.",
            ),
        ),
        _section(
            "IV. FOLIOS DE EMERGENCIA Y CONTINUIDAD OPERACIONAL",
            _body(
                "En paralelo al procedimiento de desbloqueo tributario, se activará de forma inmediata la solicitud y obtención de folios de emergencia ante el SII, permitiendo al cliente emitir documentación tributaria dentro de un plazo aproximado de una semana.",
            ),
        ),
        _section("V. PLAZO ESTIMADO DEL PROCEDIMIENTO", _ai_field("Plazo estimado", "plazo_estimado")),
        _section("VI. OBSERVACIONES", _ai_field("Observaciones", "observaciones_adicionales")),
        _honorarios(),
        _section(
            "VIII. OBLIGACIONES DEL CLIENTE",
            _body(
                "El cliente se obliga a entregar oportunamente la información y antecedentes requeridos, informar cualquier nueva notificación del SII, y mantener comunicación activa.",
            ),
        ),
        _acceptance("IX"),
    ],
    "facturas_irregulares": [
        _section(
            "II. OBJETO DE LA CONTRATACIÓN",
            _body(
                "Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales consistentes en la defensa administrativa derivada de observaciones formuladas por el SII respecto de facturas presuntamente irregulares, con la finalidad de resguardar los derechos del contribuyente y evitar la configuración de antecedentes que pudieren derivar en acciones penales tributarias.",
            ),
        ),
        _section(
            "III. SERVICIOS INCLUIDOS",
            _bullets(
                "Revisión y análisis de antecedentes tributarios asociados a las facturas observadas.",
                "Rectificación de formularios de IVA y declaraciones tributarias observadas.",
                "Desarrollo de estrategia de defensa orientada a evitar imputaciones del Art. 97 N°4 C.T.",
                "Asistencia a audiencias ante funcionarios del SII y Jefe de Grupo.",
                "Preparación de antecedentes para acreditar inexistencia de participación dolosa.",
                "Seguimiento administrativo hasta la conclusión del procedimiento.",
            ),
        ),
        _section(
            "IV. FUNDAMENTOS NORMATIVOS",
            _bullets(
                "Código Tributario, especialmente Art. 97 N°4.",
                "Ley sobre Impuesto a las Ventas y Servicios.",
                "Normativa administrativa vigente del SII.",
            ),
        ),
        _section("V. OBSERVACIONES", _ai_field("Observaciones", "observaciones_adicionales")),
        _honorarios(),
        _acceptance("VII"),
    ],
    "convenio_full": [
        _section(
            "II. EXPOSICIÓN DE LOS HECHOS",
            _body(
                "Que el contribuyente antes individualizado mantiene actualmente obligaciones tributarias pendientes ante la Tesorería General de la República. Atendida su situación económica actual y capacidad financiera, se solicita la suscripción de un convenio de pago que permita regularizar razonablemente la deuda fiscal existente.",
            ),
        ),
        _section(
            "III. FUNDAMENTOS DE DERECHO",
            _bullets(
                "Artículo 192 del Código Tributario.",
                "DFL N°1 de 1994 del Ministerio de Hacienda.",
                "Normativa administrativa vigente de Tesorería General de la República.",
            ),
        ),
        _section(
            "IV. PROPUESTA DE CONVENIO",
            _body("En virtud de lo expuesto, se propone:"),
            _body("1. Pago parcial de deuda activa"),
            _body(
                "Enterar aproximadamente un 40% de la deuda vigente mediante cuotas mensuales compatibles con la capacidad económica del contribuyente.",
            ),
            _body("2. Cuotas propuestas"),
            _ai_field("Cantidad de cuotas", "cuotas_propuestas_cantidad"),
            _ai_field("Monto aproximado de cuota", "cuotas_propuestas_monto"),
        ),
        _section("V. OBSERVACIONES", _ai_field("Observaciones", "observaciones_adicionales")),
        _honorarios(),
        _acceptance("VII"),
    ],
    "liquidacion_juridica": [
        _section(
            "DIAGNÓSTICO FINANCIERO Y JUDICIAL",
            _ai_field("Deuda Total Estimada", "deuda_total_estimada"),
            _ai_field("Estado de Alerta", "estado_alerta"),
            _ai_field("Observación Técnica", "observacion_tecnica"),
        ),
        _section(
            "SERVICIO CONTRATADO",
            _body(
                "Asesoría legal integral para el cierre y extinción de pasivos de la sociedad mediante:",
                "Liquidación Voluntaria de Empresa (Ley 20.720): Tramitación judicial del procedimiento de quiebra para la persona jurídica, con el objetivo de realizar los activos y extinguir la totalidad de las deudas vigentes.",
            ),
        ),
        _section(
            "OBJETO Y ALCANCE DEL SERVICIO",
            _bullets(
                "Fase de Preparación: Recopilación de certificados de deuda, revisión de estados financieros e inventario de bienes de la empresa.",
                "Fase Concursal: Presentación de solicitud de liquidación voluntaria ante el Juzgado Civil correspondiente.",
                "Protección Financiera Concursal: Suspensión inmediata de juicios, embargos y medidas de apremio.",
                "Extinción de Deuda y Cierre: Obtención de resolución de término con extinción de saldos insolutos.",
            ),
        ),
        _honorarios(show_bank=True),
        _acceptance("V"),
    ],
    "liquidacion_natural": [
        _section(
            "DIAGNÓSTICO FINANCIERO",
            _ai_field("Deuda Total Consolidada", "deuda_total_consolidada"),
            _ai_field("Estado de Pago", "estado_pago"),
            _ai_field("Observación Crítica", "observacion_critica"),
        ),
        _section(
            "COMPOSICIÓN DE LA DEUDA",
            {"kind": "debt_table", "key": "composicion_deuda"},
        ),
        _section(
            "SERVICIO CONTRATADO",
            _body(
                "Liquidación Voluntaria (Ley 20.720): Tramitación judicial ante el tribunal civil correspondiente para lograr el perdón legal de las deudas (discharge) mediante la entrega de activos o declaración de carencia de bienes.",
            ),
            _bullets(
                "Fase de Preparación: Análisis de antecedentes financieros, comerciales y de activos.",
                "Fase Concursal: Presentación de la demanda de quiebra y apertura del procedimiento concursal.",
                "Protección Financiera: Cese de intereses, multas y suspensión de cualquier acción de embargo.",
                "Extinción de Deuda: Resolución de término que extingue el 100% de los saldos insolutos.",
            ),
        ),
        _honorarios(show_bank=True),
        _acceptance("V"),
    ],
    "defensa_ejecutiva": [
        _section(
            "DIAGNÓSTICO JUDICIAL Y FINANCIERO",
            _ai_field("Deuda Total Consolidada", "deuda_total_consolidada"),
            _ai_field("Estado de Alerta", "estado_alerta"),
            _ai_field("Observación Técnica", "observacion_tecnica"),
        ),
        _section(
            "SERVICIO CONTRATADO",
            _body("Asesoría legal integral para la Defensa Ejecutiva Completa, orientada a:"),
            _bullets(
                "Representación Judicial: Defensa en juicios ejecutivos iniciados por acreedores.",
                "Estrategia de Prescripción: Dilación técnica y verificación de plazos legales para prescripción de la acción ejecutiva.",
                "Monitoreo Preventivo: Vigilancia diaria en el Poder Judicial para detectar demandas antes de notificación.",
                "Protección de Bienes: Gestión de tercerías para impedir embargo de bienes muebles y/o vehículos.",
            ),
        ),
        _section(
            "OBJETO Y ALCANCE DEL SERVICIO",
            _bullets(
                "Oposición a la Ejecución: Interposición de excepciones (Art. 464 CPC).",
                "Búsqueda de Prescripción: Monitoreo de inactividad del acreedor.",
                "Estrategia de Salida: Negociaciones con quitas sustanciales.",
                "Vigilancia Sitfa/Suj: Revisión constante de ingresos en tribunales civiles.",
            ),
        ),
        _section(
            "COMPOSICIÓN DE LA DEUDA",
            {"kind": "debt_table", "key": "composicion_deuda"},
        ),
        _honorarios(show_bank=True),
        _acceptance("V"),
    ],
    "proteccion_patrimonial": [
        _section(
            "DIAGNÓSTICO FINANCIERO",
            _ai_field("Deuda Financiera Total", "deuda_financiera_total"),
            _ai_field("Origen de la deuda", "origen_deuda"),
            _ai_field("Observación Técnica", "observacion_tecnica"),
            _ai_field("Protección Patrimonial Solicitada", "proteccion_patrimonial_solicitada"),
        ),
        _section(
            "COMPOSICIÓN DE LA DEUDA",
            {"kind": "debt_table", "key": "composicion_deuda"},
        ),
        _section(
            "II. SERVICIO CONTRATADO",
            _body(
                "Asesoría legal integral para la Defensa Ejecutiva de Largo Plazo y gestión de protección patrimonial, orientada a:",
            ),
            _bullets(
                "Blindaje patrimonial frente a embargos y retiros de especies.",
                "Oposición estratégica mediante excepciones legales en juicios ejecutivos.",
                "Gestión de incobrabilidad fáctica y abandono de procedimiento.",
                "Ejecución de estrategia de transferencia de bien raíz para resguardo frente a acreedores.",
            ),
        ),
        _honorarios(show_bank=True),
        _acceptance("IV"),
    ],
    "renegociacion": [
        _section(
            "DIAGNÓSTICO FINANCIERO",
            _ai_field("Deuda Total Reportada", "deuda_total_reportada"),
            _ai_field("Estado de Pago", "estado_pago"),
            _ai_field("Observación Técnica", "observacion_tecnica"),
        ),
        _section(
            "COMPOSICIÓN DE LA DEUDA FINANCIERA",
            {"kind": "debt_table", "key": "composicion_deuda"},
        ),
        _section(
            "SERVICIO CONTRATADO",
            _body(
                "Asesoría legal integral y representación técnica ante la Superintendencia de Insolvencia y Reemprendimiento (SUPERIR), orientada a:",
            ),
            _bullets(
                "Reestructuración Integral de Pasivos: Consolidar la deuda en un plan de pago único.",
                "Condonación de Intereses y Multas: Eliminar recargos generados por la mora pesada.",
                "Protección Financiera Concursal: Suspensión legal de juicios ejecutivos durante negociación.",
                "Blindaje y Rehabilitación: Eliminación de registros de morosidad en Dicom.",
            ),
        ),
        _honorarios(show_bank=True),
        _acceptance("V"),
    ],
    "alzamiento": [
        _section(
            "II. SERVICIO CONTRATADO",
            _body(
                "Asesoría y gestión legal especializada para el Alzamiento de Embargo de vehículo motorizado, con tramitación ante el Archivero Judicial, Tribunal Civil y Registro Civil e Identificación.",
            ),
        ),
        _section(
            "III. OBJETO Y ALCANCE DEL SERVICIO (HOJA DE RUTA)",
            _bullets(
                "Gestión de Desarchivo: Solicitud de desarchivo ante el tribunal y pago de derechos.",
                "Impulso ante Archivero Judicial: Coordinación del envío efectivo del expediente.",
                "Notificación a la Demandante: Gestión con Receptor Judicial.",
                "Solicitud de Alzamiento de Embargo: Presentación de escrito judicial.",
                "Inscripción en Registro Civil: Cancelación del embargo en el RVM.",
            ),
        ),
        _section("IV. ESTRATEGIA LEGAL", _ai_field("Estrategia legal", "estrategia_legal")),
        _honorarios(show_bank=True),
        _acceptance("VI"),
    ],
    "constitucion": [
        _section(
            "II. OBJETO DE LA CONTRATACIÓN",
            _body(
                "Por el presente instrumento, el cliente encomienda la prestación de servicios profesionales destinados a la creación de una nueva sociedad del tipo y giro elegido, incluyendo la constitución, inicio de actividades y verificación de actividad económica ante el SII.",
            ),
            _ai_field("Tipo societario", "tipo_societario"),
            _ai_field("Método de constitución", "metodo_constitucion"),
        ),
        _section(
            "III. SERVICIOS INCLUIDOS",
            _bullets(
                "Redacción de escritura de constitución, inscripción en CBR y publicación en Diario Oficial.",
                "Inicio de actividades, obtención de RUT y cédula e-RUT ante el SII.",
                "Redacción de contratos para Verificación de actividades económicas.",
                "Seguimiento integral del procedimiento.",
            ),
        ),
        _section(
            "IV. FUNDAMENTOS NORMATIVOS",
            _bullets(
                "Art. 2053 y siguientes del Código Civil.",
                "Ley N° 3.918 (SRL) / Ley N° 20.190 (SpA).",
                "Decreto Ley N° 824 y N° 825.",
            ),
        ),
        _section("V. PLAZO ESTIMADO DEL PROCEDIMIENTO", _ai_field("Plazo estimado", "plazo_estimado")),
        _honorarios(),
        _acceptance("VII"),
    ],
}


def get_content(ot_type: str) -> list[dict[str, Any]]:
    return OT_CONTENT.get(ot_type, [])


def acceptance_body() -> list[str]:
    return list(_ACCEPTANCE_BODY)

# ── Contrato de encargo de tratamiento de datos (Ley 21.719) ────────────────
# Reutiliza el motor de documentos del rubro legal, que ya no se usa para eso.
# La 21.719 exige contrato ESCRITO entre responsable (la pyme, dueña de los
# datos de sus clientes) y encargado (Zelix, que los trata por cuenta de ella).
# Sin él, onboardear pymes después de diciembre de 2026 es infracción de las dos.
#
# ⚠️ BORRADOR TÉCNICO: cubre los deberes que la ley enumera para el encargado,
# pero NO reemplaza revisión de abogado. Antes de usarlo con un cliente real
# tiene que pasar por firma profesional.
OT_CONTENT["encargo_datos"] = [
    _section(
        "II. PARTES Y ROLES",
        _body(
            "Para efectos de la Ley N° 19.628, con las modificaciones introducidas por la Ley N° 21.719, las partes reconocen expresamente los siguientes roles:",
        ),
        _bullets(
            "EL CLIENTE individualizado en la sección anterior actúa como RESPONSABLE del tratamiento respecto de los datos personales de sus propios clientes y contactos.",
            "ZELIX actúa como ENCARGADO del tratamiento, tratando dichos datos únicamente por cuenta del responsable y conforme a sus instrucciones documentadas.",
        ),
        _body(
            "Zelix no determina los fines del tratamiento ni utiliza los datos para finalidades propias. Cualquier tratamiento fuera de las instrucciones del responsable, salvo obligación legal, constituye incumplimiento de este contrato.",
        ),
    ),
    _section(
        "III. OBJETO, NATURALEZA, FINALIDAD Y DURACIÓN",
        _body(
            "El objeto es el tratamiento de datos personales necesario para prestar el servicio de asistente conversacional de ventas: recibir mensajes de los clientes del responsable, responderlos automáticamente, registrar pedidos y facilitar el cobro.",
            "La duración del encargo coincide con la vigencia del servicio contratado. Terminado el servicio, rige lo previsto en la sección X.",
        ),
    ),
    _section(
        "IV. DATOS Y TITULARES ALCANZADOS",
        _body("El encargo alcanza las siguientes categorías, y ninguna otra:"),
        _bullets(
            "Identificadores de contacto: número de teléfono y nombre de perfil del cliente final.",
            "Contenido de las conversaciones sostenidas con el asistente.",
            "Datos de pedidos: productos, cantidades, montos y fechas.",
            "Datos de identificación del responsable y de sus operadores autorizados.",
        ),
        _body(
            "Zelix aplica filtros automáticos que impiden el almacenamiento de datos de tarjetas de pago: si un cliente final los escribe en el chat, el dato se descarta antes de persistirse y antes de enviarse a cualquier proveedor.",
        ),
    ),
    _section(
        "V. OBLIGACIONES DEL ENCARGADO",
        _body("Zelix se obliga a:"),
        _bullets(
            "Tratar los datos únicamente conforme a las instrucciones documentadas del responsable.",
            "Garantizar que quienes accedan a los datos estén sujetos a deber de confidencialidad.",
            "Aplicar medidas técnicas y organizativas apropiadas al riesgo, incluyendo aislamiento lógico entre comercios, cifrado de credenciales y registro de accesos.",
            "No comunicar ni ceder los datos a terceros distintos de los subencargados autorizados en la sección VI.",
            "Asistir al responsable en el cumplimiento de sus propias obligaciones, en los términos de las secciones VIII y IX.",
            "Mantener un registro de las actividades de tratamiento realizadas por cuenta del responsable, y ponerlo a su disposición cuando lo requiera.",
        ),
    ),
    _section(
        "VI. SUBENCARGADOS AUTORIZADOS",
        _body(
            "El responsable autoriza a Zelix a recurrir a los siguientes subencargados, cada uno vinculado por obligaciones de protección equivalentes a las de este contrato:",
        ),
        _bullets(
            "Supabase, Inc. (EE.UU.) — almacenamiento de base de datos y bóveda cifrada de credenciales.",
            "Render, Inc. (EE.UU.) — alojamiento y procesamiento del backend.",
            "Cloudflare, Inc. (EE.UU.) — sitio web y red de entrega de contenidos.",
            "OpenAI, LLC (EE.UU.) — generación de las respuestas del asistente.",
            "Google LLC (EE.UU.) — generación de respuestas del asistente, únicamente como respaldo ante indisponibilidad del proveedor principal.",
            "Meta Platforms, Inc. (EE.UU.) — transporte de los mensajes de WhatsApp.",
            "Telegram Messenger Inc. — transporte de los mensajes del canal Telegram.",
            "Flow (Chile) — procesamiento de pagos, bajo su propia política; Zelix no accede a datos de tarjeta.",
        ),
        _body(
            "Zelix informará al responsable de cualquier incorporación o sustitución de subencargados con antelación razonable, permitiéndole oponerse por motivos fundados.",
        ),
    ),
    _section(
        "VII. TRANSFERENCIA INTERNACIONAL",
        _body(
            "El responsable reconoce que los subencargados indicados, salvo Flow, se encuentran fuera del territorio nacional, por lo que el tratamiento involucra transferencia internacional de datos.",
            "Dicha transferencia se ampara en cláusulas contractuales de protección de datos suscritas con cada proveedor, que imponen obligaciones de seguridad y confidencialidad equivalentes y prohíben el uso de los datos para fines propios del proveedor.",
            "Tratándose de proveedores de inteligencia artificial, el tratamiento se realiza bajo condiciones que excluyen el uso del contenido de las conversaciones para el entrenamiento de sus modelos.",
        ),
    ),
    _section(
        "VIII. SEGURIDAD Y NOTIFICACIÓN DE VULNERACIONES",
        _body(
            "Zelix mantiene medidas de seguridad apropiadas al riesgo y registro de accesos que permite determinar el alcance de un eventual incidente.",
            "Detectada una vulneración de seguridad que afecte datos personales tratados por cuenta del responsable, Zelix se lo notificará SIN DILACIÓN INDEBIDA, informando la naturaleza del incidente, las categorías y volumen aproximado de datos afectados, las consecuencias probables y las medidas adoptadas o propuestas.",
            "La notificación a la Agencia de Protección de Datos Personales y, cuando corresponda, a los titulares, es obligación del responsable; Zelix le prestará la asistencia y la información necesarias para cumplirla en plazo.",
        ),
    ),
    _section(
        "IX. ASISTENCIA EN EL EJERCICIO DE DERECHOS",
        _body(
            "Zelix asistirá al responsable para atender las solicitudes de acceso, rectificación, supresión, oposición, portabilidad y bloqueo que formulen los titulares.",
            "Si un titular dirige su solicitud directamente a Zelix, ésta la derivará al responsable sin demora, absteniéndose de resolverla por sí misma salvo instrucción expresa.",
        ),
    ),
    _section(
        "X. DEVOLUCIÓN O SUPRESIÓN AL TÉRMINO",
        _body(
            "Terminada la prestación, Zelix suprimirá los datos personales tratados por cuenta del responsable, salvo que una norma legal obligue a conservarlos.",
            "Se exceptúa el respaldo tributario de las operaciones (monto, fecha, medio de pago e identificación del emisor), que se conserva por seis años conforme al artículo 200 del Código Tributario. Dicho respaldo no incluye el contenido de las conversaciones ni los identificadores de contacto de los clientes finales.",
        ),
    ),
    _section(
        "XI. AUDITORÍA Y ACREDITACIÓN",
        _body(
            "Zelix pondrá a disposición del responsable la información necesaria para acreditar el cumplimiento de las obligaciones de esta sección, y permitirá auditorías razonables, acordadas con antelación y sin comprometer la seguridad ni la confidencialidad de los datos de otros comercios.",
        ),
    ),
    _section("XII. PLAZO Y VIGENCIA", _ai_field("Vigencia y condiciones particulares", "vigencia_encargo")),
    _acceptance("XIII"),
]

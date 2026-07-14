"""Render de la OT como HTML — el MISMO documento del panel del vendedor.

El vendedor genera su PDF en el navegador (html2canvas + jsPDF) a partir del
componente `FullDocument` de `frontend/src/components/WorkOrderModal.tsx`.
Este módulo replica ese HTML 1:1 (mismas secciones, wording, tipografía y
estilos del export: inputs → texto subrayado, montos → CLP formateado, sin
badges de IA ni controles de edición) para que Hive-service-control (AT.Informa)
reciba exactamente la misma OT que ve y descarga el vendedor en NEXIO.

El documento es autónomo: las imágenes de header/footer van embebidas en
base64, de modo que el HTML se puede abrir desde cualquier sistema sin
depender de los assets de NEXIO.
"""
from __future__ import annotations

import base64
import html as _html
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .ot_templates import OT_CONTENT, HAS_OWN_CLIENT, acceptance_body

_PUBLIC_DIR = Path(__file__).parent.parent.parent.parent / "frontend" / "public"

# Campos que en el modal son áreas de texto SIN label inline (el título de la
# sección ya describe el contenido) y los que llevan label en su propia línea.
_UNLABELED_BLOCK_KEYS = {"plazo_estimado", "observaciones_adicionales", "estrategia_legal"}
_LABELED_BLOCK_KEYS = {
    "observacion_tecnica",
    "observacion_critica",
    "proteccion_patrimonial_solicitada",
}


@lru_cache(maxsize=4)
def _img_data_uri(filename: str, mime: str) -> str:
    try:
        raw = (_PUBLIC_DIR / filename).read_bytes()
    except OSError:
        return ""
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def _esc(v: Any) -> str:
    return _html.escape(str(v)) if v not in (None, "") else ""


def _fmt_clp(v: Any) -> str:
    """Réplica de fmtCLP del frontend: '$ 1.234.567'."""
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    n = int(digits) if digits else 0
    return "$ " + f"{n:,}".replace(",", ".")


def _blank_line(label: str, value: Any) -> str:
    """BlankLine del modal: label + valor subrayado."""
    return (
        '<div class="row"><span class="lbl">{label}</span>'
        '<span class="blank">{value}</span></div>'
    ).format(label=_esc(label), value=_esc(value) or "&nbsp;")


def _blank_area(value: Any, label: str | None = None) -> str:
    out = ""
    if label:
        out += f'<p class="body" style="margin-bottom:2px">{_esc(label)}</p>'
    out += f'<div class="area">{_esc(value) or "&nbsp;"}</div>'
    return out


def _section_title(text: str) -> str:
    return f'<p class="sec">{_esc(text)}</p>'


def _body_p(text: str) -> str:
    return f'<p class="body">{_esc(text)}</p>'


def _bullets(items: list[str]) -> str:
    lis = "".join(
        f'<li><span class="dot">•</span><span>{_esc(it)}</span></li>' for it in items
    )
    return f'<ul class="bullets">{lis}</ul>'


def _debt_table(value: Any) -> str:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = None
    if not isinstance(value, list) or not value:
        return ""
    head = "".join(
        f"<th>{h}</th>" for h in ["Acreedor", "Tipo de Producto", "Monto Total", "Estado"]
    )
    rows = ""
    for row in value:
        if not isinstance(row, dict):
            continue
        rows += (
            "<tr>"
            f"<td>{_esc(row.get('acreedor')) or '—'}</td>"
            f"<td>{_esc(row.get('tipo_producto')) or '—'}</td>"
            f"<td>{_esc(row.get('monto_total')) or '—'}</td>"
            f"<td>{_esc(row.get('estado_critico')) or '—'}</td>"
            "</tr>"
        )
    return f'<table class="debt"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'


def _client_section(ot_type: str, f: dict[str, Any]) -> str:
    """Sección de identificación del cliente, igual que en el modal."""
    if ot_type not in HAS_OWN_CLIENT:
        return (
            _section_title("I. INDIVIDUALIZACIÓN DEL CLIENTE")
            + _blank_line("Nombre o Razón Social:", f.get("nombre_razon_social"))
            + _blank_line("RUT:", f.get("rut"))
            + _blank_line("Domicilio:", f.get("domicilio"))
            + '<div class="two-col">'
            + _blank_line("Comuna:", f.get("comuna"))
            + _blank_line("Teléfono:", f.get("telefono"))
            + "</div>"
            + _blank_line("Correo electrónico:", f.get("email"))
        )

    if ot_type == "liquidacion_juridica":
        return (
            _section_title("I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES")
            + _blank_line("Representante Legal:", f.get("representante_legal"))
            + _blank_line("RUT Representante:", f.get("rut_representante"))
            + _blank_line("Razón Social:", f.get("razon_social"))
            + _blank_line("RUT Empresa:", f.get("rut_empresa"))
            + _blank_line("Email de Contacto:", f.get("email"))
            + '<p class="body" style="margin-top:4px">Perfil: Persona Jurídica (Empresa Deudora).</p>'
        )

    title = (
        "I. IDENTIFICACIÓN DEL CLIENTE"
        if ot_type in ("proteccion_patrimonial", "renegociacion")
        else "I. IDENTIFICACIÓN DEL CLIENTE Y ANTECEDENTES"
    )
    out = (
        _section_title(title)
        + _blank_line("Titular:", f.get("nombre_razon_social"))
        + _blank_line("RUT:", f.get("rut"))
        + _blank_line("Email:", f.get("email"))
    )
    if ot_type == "alzamiento":
        out += (
            _blank_line("Causa / Rol:", f.get("causa_referencia"))
            + _blank_line("Tribunal:", f.get("tribunal"))
            + _blank_line("Acreedor / Demandante:", f.get("acreedor_demandante"))
        )
    else:
        label = "Perfil del Deudor:" if ot_type in ("proteccion_patrimonial",) else "Perfil:"
        out += _blank_line(label, f.get("perfil_deudor"))
    return out


def _honorarios(f: dict[str, Any], show_bank: bool) -> str:
    out = _section_title("HONORARIOS PROFESIONALES")
    out += _body_p(
        "Los honorarios profesionales correspondientes a los servicios indicados "
        "precedentemente ascienden a la suma de:"
    )
    out += f'<p class="money">{_fmt_clp(f.get("honorarios"))}</p>'
    out += _blank_line("Forma de pago:", f.get("forma_de_pago"))
    nc = _esc(f.get("num_cuotas")) or "1"
    out += (
        '<div class="two-col">'
        + f'<div class="row"><span class="lbl">Pie Inicial:</span>'
          f'<span class="money-inline">{_fmt_clp(f.get("pie_inicial"))}</span></div>'
        + f'<div class="row"><span class="lbl">Cuotas:</span>'
          f'<span class="blank" style="flex:none;min-width:24px;text-align:center">{nc}</span>'
          f'<span class="lbl">de</span>'
          f'<span class="money-inline">{_fmt_clp(f.get("monto_cuota"))}</span></div>'
        + "</div>"
    )
    if show_bank:
        out += (
            '<div class="bank">'
            "<p>DATOS PARA TRANSFERENCIA</p>"
            "<p>Titular: Abogados Chile SpA &nbsp;|&nbsp; RUT: 78.216.743-K &nbsp;|&nbsp; "
            "Banco: Santander (Cta. Cte.) &nbsp;|&nbsp; N° 99606614</p>"
            "<p>Comprobantes: cobranza@abogadostributarioschile.com</p>"
            "</div>"
        )
    return out


def _acceptance(section_num: str) -> str:
    out = _section_title(f"{section_num}. ACEPTACIÓN DEL SERVICIO")
    for p in acceptance_body():
        out += _body_p(p)
    out += '<p class="body" style="margin-top:18px;margin-bottom:0">Atentamente,</p>'
    out += '<p class="body" style="margin-bottom:0">Abogados Tributarios Chile SpA</p>'
    return out


def _render_block(block: dict[str, Any], f: dict[str, Any]) -> str:
    kind = block.get("kind")
    if kind == "body":
        paragraphs = block.get("paragraphs") or ([block["text"]] if block.get("text") else [])
        return "".join(_body_p(p) for p in paragraphs)
    if kind == "bullets":
        return _bullets(block.get("items", []))
    if kind == "ai_field":
        key = block.get("key", "")
        val = f.get(key, "")
        if key in _UNLABELED_BLOCK_KEYS:
            return _blank_area(val)
        if key in _LABELED_BLOCK_KEYS:
            return _blank_area(val, label=f"{block.get('label', key)}:")
        return _blank_line(f"{block.get('label', key)}:", val)
    if kind == "debt_table":
        return _debt_table(f.get(block.get("key", "")))
    return ""


_CSS = """
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #6b7280; margin: 0; }
  .page { width: 794px; margin: 0 auto; background: #fff; color: #111827;
          font-family: "Play", Georgia, "Times New Roman", serif; font-weight: 700; }
  .page img.hdr { width: 100%; display: block; max-height: 120px;
                  object-fit: cover; object-position: center top; }
  .page img.ftr { width: 100%; display: block; margin-top: 16px;
                  max-height: 50px; object-fit: contain; }
  .inner { padding: 24px 40px; }
  .title  { font-size: 15px; text-transform: uppercase; line-height: 1.25; }
  .title2 { font-size: 13px; text-transform: uppercase; line-height: 1.25; margin-top: 2px; }
  .title3 { font-size: 12px; text-transform: uppercase; line-height: 1.25; margin-top: 2px; }
  .titleblock { margin-bottom: 16px; }
  .sec  { font-size: 13px; text-transform: uppercase; letter-spacing: 0.025em;
          margin: 20px 0 8px; }
  .body { font-size: 13px; line-height: 1.6; margin-bottom: 8px; }
  .row  { display: flex; align-items: flex-end; gap: 4px; margin-bottom: 6px;
          font-size: 13px; }
  .row .lbl { white-space: nowrap; flex-shrink: 0; }
  .row .blank { border-bottom: 2px solid #9ca3af; flex: 1; min-width: 80px;
                padding: 0 4px 2px; }
  .row .money-inline { border-bottom: 2px solid #9ca3af; min-width: 120px;
                       padding: 0 4px 2px; }
  .two-col { display: flex; flex-wrap: wrap; gap: 0 24px; }
  .area { border-bottom: 2px solid #9ca3af; width: 100%; min-height: 1.5em;
          font-size: 13px; line-height: 1.5; padding: 0 4px 2px;
          margin-bottom: 8px; white-space: pre-wrap; }
  .money { font-size: 13px; margin: 2px 0 8px; padding: 0 4px;
           border-bottom: 2px solid #9ca3af; display: inline-block; min-width: 260px; }
  .bullets { list-style: none; margin-bottom: 8px; }
  .bullets li { display: flex; gap: 8px; font-size: 13px; line-height: 1.6; }
  .bullets li .dot { flex-shrink: 0; }
  .debt { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  .debt th, .debt td { border: 1px solid #9ca3af; padding: 3px 8px; text-align: left; }
  .debt th { background: #e5e7eb; }
  .bank { margin-top: 12px; padding: 12px; background: #f9fafb;
          border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px;
          color: #374151; line-height: 1.5; }
  @media print {
    body { background: #fff; }
    .page { width: auto; }
  }
"""


def build_ot_html(
    ot_type: str,
    fields: dict[str, Any],
    *,
    label: str,
    subtitle: str | None = None,
    catalog: list[dict[str, Any]] | None = None,
) -> str:
    """Genera el documento OT completo, idéntico al export del vendedor.

    `catalog` permite pasar el catálogo de secciones ya resuelto (p.ej. con los
    overrides de plantilla que guarda el admin en AppSetting), de modo que el
    HTML quede 1:1 con el PDF del servidor. Si es None se usa el catálogo base
    `OT_CONTENT` (lo que ve y exporta el vendedor en el modal).
    """
    f = fields or {}
    entries = catalog if catalog is not None else OT_CONTENT.get(ot_type, [])
    body = '<div class="titleblock">'
    body += '<p class="title">ORDEN DE TRABAJO</p>'
    body += f'<p class="title2">{_esc(label)}</p>'
    if subtitle and subtitle.upper() != label.upper():
        body += f'<p class="title3">{_esc(subtitle)}</p>'
    body += "</div>"

    body += _blank_line("Fecha:", f.get("fecha"))
    body += _client_section(ot_type, f)

    for entry in entries:
        kind = entry.get("kind")
        if kind == "section":
            body += _section_title(entry["title"])
            for blk in entry.get("blocks", []):
                body += _render_block(blk, f)
        elif kind == "honorarios":
            body += _honorarios(f, bool(entry.get("show_bank")))
        elif kind == "acceptance":
            body += _acceptance(entry.get("section_num", "VIII"))

    hdr = _img_data_uri("ot_header.png", "image/png")
    ftr = _img_data_uri("ot_footer.gif", "image/gif")
    hdr_tag = f'<img class="hdr" src="{hdr}" alt="Abogados Tributarios" />' if hdr else ""
    ftr_tag = f'<img class="ftr" src="{ftr}" alt="" />' if ftr else ""

    nombre = _esc(f.get("nombre_razon_social")) or "Cliente"
    return (
        "<!DOCTYPE html>"
        '<html lang="es"><head><meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        f"<title>OT — {nombre}</title>"
        '<link rel="preconnect" href="https://fonts.googleapis.com" />'
        '<link href="https://fonts.googleapis.com/css2?family=Play:wght@400;700&display=swap" rel="stylesheet" />'
        f"<style>{_CSS}</style>"
        "</head><body>"
        f'<div class="page">{hdr_tag}<div class="inner">{body}</div>{ftr_tag}</div>'
        "</body></html>"
    )

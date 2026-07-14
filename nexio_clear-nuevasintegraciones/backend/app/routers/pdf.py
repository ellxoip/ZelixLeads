from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from io import BytesIO
from datetime import datetime
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, Image as RLImage, KeepTogether,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from ..database import get_db
from .. import models
from ..auth import get_current_user

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

ASSETS = Path(__file__).parent.parent.parent.parent / "frontend" / "public"
HEADER_IMG = str(ASSETS / "ot_header.png")
FOOTER_IMG = str(ASSETS / "ot_footer.gif")

BLACK       = colors.HexColor("#111827")
GRAY        = colors.HexColor("#6B7280")
BORDER      = colors.HexColor("#D1D5DB")
LIGHT       = colors.HexColor("#F9FAFB")


def _styles():
    base = getSampleStyleSheet()
    def s(name, **kw):
        return ParagraphStyle(name, parent=base["Normal"], **kw)
    return {
        "section": s("section", fontSize=10, fontName="Helvetica-Bold",
                     textColor=BLACK, spaceBefore=10, spaceAfter=4,
                     textTransform="uppercase", leading=14),
        "label":   s("label",   fontSize=9,  fontName="Helvetica-Bold",
                     textColor=GRAY),
        "value":   s("value",   fontSize=10, fontName="Helvetica-Bold",
                     textColor=BLACK),
        "normal":  s("normal",  fontSize=9,  fontName="Helvetica",
                     textColor=BLACK, leading=13),
        "footer":  s("footer",  fontSize=8,  fontName="Helvetica",
                     textColor=GRAY, alignment=TA_CENTER),
    }


def _table(data, col_w=None):
    col_w = col_w or [4.5*cm, 11.5*cm]
    t = Table(data, colWidths=col_w)
    t.setStyle(TableStyle([
        ("FONTNAME",    (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, -1), 10),
        ("TEXTCOLOR",   (0, 0), (-1, -1), BLACK),
        ("BACKGROUND",  (0, 0), (0, -1), LIGHT),
        ("GRID",        (0, 0), (-1, -1), 0.4, BORDER),
        ("PADDING",     (0, 0), (-1, -1), 8),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def fmt_clp(v):
    try:
        return f"$ {int(v):,}".replace(",", ".")
    except Exception:
        return str(v)


def build_lead_pdf(lead: models.Lead) -> BytesIO:
    buffer = BytesIO()
    # No margins — header/footer images go edge-to-edge
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=0, leftMargin=0,
        topMargin=0, bottomMargin=0,
    )
    st = _styles()
    A4_W = A4[0]
    BODY_W = A4_W - 4*cm  # 2 cm each side for body content
    story = []

    # ── Header image ──────────────────────────────────────────────────────────
    if Path(HEADER_IMG).exists():
        try:
            hdr = RLImage(HEADER_IMG, width=A4_W, height=A4_W * 425 / 2048)
            story.append(hdr)
        except Exception:
            pass
    else:
        story.append(Spacer(1, 1.5*cm))

    # ── Body padding wrapper via nested table trick ────────────────────────────
    # Use a 1-col table with padding to simulate 2cm side margins
    def body_block(items):
        inner = Table([[item] for item in items], colWidths=[BODY_W])
        inner.setStyle(TableStyle([
            ("LEFTPADDING",  (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING",   (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ]))
        outer = Table([[inner]], colWidths=[A4_W])
        outer.setStyle(TableStyle([
            ("LEFTPADDING",  (0, 0), (-1, -1), 2*cm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2*cm),
            ("TOPPADDING",   (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ]))
        return outer

    contact = lead.contact

    body_items = []

    # Title
    body_items.append(Spacer(1, 0.5*cm))
    body_items.append(Paragraph("ORDEN DE TRABAJO", ParagraphStyle(
        "ot_title", parent=getSampleStyleSheet()["Normal"],
        fontSize=15, fontName="Helvetica-Bold", textColor=BLACK,
        spaceAfter=2, leading=18,
    )))
    body_items.append(Paragraph("Ficha de Servicio al Cliente", ParagraphStyle(
        "ot_sub", parent=getSampleStyleSheet()["Normal"],
        fontSize=11, fontName="Helvetica-Bold", textColor=BLACK,
        spaceAfter=2, leading=14,
    )))
    body_items.append(Spacer(1, 0.15*cm))
    body_items.append(Paragraph(
        f"Fecha: {datetime.now().strftime('%d/%m/%Y')}",
        st["normal"],
    ))
    body_items.append(Spacer(1, 0.4*cm))

    # ── I. CLIENTE ─────────────────────────────────────────────────────────────
    body_items.append(Paragraph("I. INDIVIDUALIZACIÓN DEL CLIENTE", st["section"]))
    body_items.append(HRFlowable(width=BODY_W, thickness=0.5, color=BORDER, spaceAfter=4))
    client_rows = [
        ["Nombre o Razón Social:", contact.name if contact else "—"],
        ["RUT Cliente:",           contact.rut_persona  or "—"],
        ["RUT Empresa:",           contact.rut_empresa  or "—"],
        ["Razón Social:",          contact.razon_social or "—"],
        ["Email:",                 contact.email        or "—"],
        ["Teléfono:",              contact.phone        if contact else "—"],
        ["Domicilio:",             contact.address      or "—"],
        ["Comuna:",                contact.city         or "—"],
    ]
    body_items.append(_table(client_rows, col_w=[4.5*cm, BODY_W - 4.5*cm]))
    body_items.append(Spacer(1, 0.4*cm))

    # ── II. SERVICIO ───────────────────────────────────────────────────────────
    body_items.append(Paragraph("II. DETALLE DEL SERVICIO", st["section"]))
    body_items.append(HRFlowable(width=BODY_W, thickness=0.5, color=BORDER, spaceAfter=4))
    service_rows = [
        ["Área Legal:",   lead.area.name if lead.area else "—"],
        ["Vendedor:",     lead.vendedor.name  if lead.vendedor  else "—"],
        ["Agendador/a:",  lead.agendadora.name if lead.agendadora else "—"],
        ["Fuente:",       (lead.source or "—").capitalize()],
    ]
    if lead.service_description:
        service_rows.append(["Descripción:", lead.service_description])
    body_items.append(_table(service_rows, col_w=[4.5*cm, BODY_W - 4.5*cm]))
    body_items.append(Spacer(1, 0.4*cm))

    # ── III. HONORARIOS ────────────────────────────────────────────────────────
    body_items.append(Paragraph("HONORARIOS PROFESIONALES", st["section"]))
    body_items.append(HRFlowable(width=BODY_W, thickness=0.5, color=BORDER, spaceAfter=4))
    pay_rows = [
        ["Honorarios:",    fmt_clp(lead.honorarios)],
        ["Cuota Inicial:", fmt_clp(lead.cuota_inicial)],
        ["N° Cuotas:",     str(lead.num_cuotas)],
        ["Monto Cuota:",   fmt_clp(lead.monto_cuota)],
    ]
    body_items.append(_table(pay_rows, col_w=[4.5*cm, BODY_W - 4.5*cm]))

    if lead.notes:
        body_items.append(Spacer(1, 0.4*cm))
        body_items.append(Paragraph("OBSERVACIONES", st["section"]))
        body_items.append(HRFlowable(width=BODY_W, thickness=0.5, color=BORDER, spaceAfter=4))
        body_items.append(Paragraph(lead.notes, st["normal"]))

    body_items.append(Spacer(1, 0.8*cm))
    body_items.append(Paragraph("Atentamente,", st["normal"]))
    body_items.append(Paragraph("Abogados Tributarios Chile SpA", ParagraphStyle(
        "firm", parent=getSampleStyleSheet()["Normal"],
        fontSize=10, fontName="Helvetica-Bold", textColor=BLACK,
    )))

    story.append(body_block(body_items))

    # ── Footer image ───────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.6*cm))
    if Path(FOOTER_IMG).exists():
        try:
            ftr = RLImage(FOOTER_IMG, width=A4_W, height=30)
            story.append(ftr)
        except Exception:
            pass

    doc.build(story)
    buffer.seek(0)
    return buffer


@router.get("/lead/{lead_id}")
def generate_lead_pdf(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    lead = db.query(models.Lead).options(
        joinedload(models.Lead.contact),
        joinedload(models.Lead.area),
        joinedload(models.Lead.agendadora),
        joinedload(models.Lead.vendedor),
    ).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    pdf_buffer = build_lead_pdf(lead)
    import re as _re
    import unicodedata as _ud
    raw = lead.contact.name if lead.contact else "LEAD"
    normalized = _ud.normalize('NFD', raw)
    ascii_name = ''.join(c for c in normalized if _ud.category(c) != 'Mn')
    contact_name = _re.sub(r'[^A-Za-z0-9]+', '_', ascii_name).strip('_').upper()
    filename = f"FICHA_{contact_name or 'CLIENTE'}.pdf"

    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

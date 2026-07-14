"""Utilidades de normalización para el Buscador Global 360.

Sin dependencias del resto de la app (evita ciclos de import). Estas funciones
producen el texto que se guarda en columnas indexadas (Contact.search_name /
Contact.phone_norm) y el que normaliza la query del usuario, de modo que el
emparejamiento sea agnóstico a acentos, mayúsculas y formatos de teléfono.
"""
from __future__ import annotations

import re
import unicodedata

_WS_RE = re.compile(r"\s+")
_NON_DIGIT_RE = re.compile(r"\D")


def norm_text(s: str | None) -> str:
    """Minúsculas, sin acentos (NFKD) y espacios colapsados/recortados.

    'Juán  PÉREZ' -> 'juan perez'
    """
    if not s:
        return ""
    # NFKD separa el carácter base de su diacrítico; ascii/ignore lo descarta.
    decomposed = unicodedata.normalize("NFKD", s)
    no_accents = decomposed.encode("ascii", "ignore").decode("ascii")
    return _WS_RE.sub(" ", no_accents.lower()).strip()


def phone_digits(s: str | None) -> str:
    """Deja solo dígitos. '+56 9 1234 5678' -> '56912345678'."""
    if not s:
        return ""
    return _NON_DIGIT_RE.sub("", s)


def phone_suffix(s: str | None, n: int = 8) -> str:
    """Últimos `n` dígitos — emparejamiento agnóstico al prefijo país.

    '+56912345678' y '912345678' comparten sufijo '12345678'.
    """
    return phone_digits(s)[-n:] if s else ""

import re
import unicodedata


def safe_ascii_filename(name: str, fallback: str = "documento") -> str:
    """
    Nombre de archivo seguro para el header Content-Disposition (latin-1/ASCII).

    Los headers HTTP no aceptan unicode: un contacto llamado "ᴰᴵᴱᴳᴼ" o "Ñuñoa"
    rompía la descarga con UnicodeEncodeError. NFKD descompone acentos y
    caracteres de compatibilidad (ᴰ→D, ñ→n), se descarta lo no-ASCII y lo no
    seguro se colapsa a "_".
    """
    ascii_name = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", ascii_name).strip("_.")
    return safe or fallback

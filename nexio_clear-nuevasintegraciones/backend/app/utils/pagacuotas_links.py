from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def normalize_pagacuotas_portal_link(link: str | None) -> str:
    if not link:
        return ""

    try:
        parts = urlsplit(link)
        path = parts.path
        query = parts.query

        if path == "/client/payment":
            path = "/client/portal"
            query = ""
        elif path == "/client/auto-login":
            query_items = [(key, value) for key, value in parse_qsl(query, keep_blank_values=True) if key != "pay"]
            query = urlencode(query_items)

        return urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))
    except Exception:
        return link

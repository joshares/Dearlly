import ipaddress

from fastapi import Request

from app.core.config import Settings


def client_ip(request: Request, settings: Settings) -> str:
    """The visitor's IP. Behind Cloudflare, trust only its header (set CLIENT_IP_HEADER)."""
    if settings.client_ip_header:
        value = request.headers.get(settings.client_ip_header, "").strip()
        try:
            return str(ipaddress.ip_address(value))
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"

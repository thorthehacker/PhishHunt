import ipaddress
import socket

from urllib.parse import urlparse

from .template import normalize_url


class ImportValidationError(Exception):
    """Raised when a URL is not allowed for import (SSRF/allowlist)."""


def _host_is_literal(host: str):
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        return None


def _reject_ip(ip) -> bool:
    """Reject anything that is not a globally routable public address."""
    if ip.version == 4:
        return bool(
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        )
    if ip.version == 6:
        return bool(
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or ip.is_site_local  # deprecated but still boundable in places
        )
    return True


def _is_internal_ip_text(host: str) -> bool:
    ip = _host_is_literal(host)
    return ip is not None and _reject_ip(ip)


def _resolves_to_internal(raw: bytes) -> bool:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return False
    return _reject_ip(ip)


def domain_matches(hostname: str, allowed: str) -> bool:
    """
    A hostname is allowed when it equals an allowlist entry or is a
    descendant (subdomain) of one. Case-insensitive.
    """
    host = hostname.rstrip(".").lower()
    entries = [e.strip().lower().rstrip(".") for e in allowed.split(",")]
    entries = [e for e in entries if e]
    if not entries:
        return True
    for entry in entries:
        if host == entry or host.endswith("." + entry):
            return True
    return False


def validate_import_url(raw_url: str, allowlist: str = "") -> str:
    """
    Validate + normalize a URL for server-side import.

    Rejects:
      - invalid/missing URLs, non-http(s) schemes
      - literal private/loopback/link-local/reserved IPs
      - hostnames that resolve to private/local/cloud-metadata addresses
      - non-standard ports (only 80/443)
      - hosts not matching the authorized-domain allowlist (when provided)

    Returns the normalized URL string.
    Raises ImportValidationError with a user-facing message.
    """
    if not raw_url or not raw_url.strip():
        raise ImportValidationError("URL cannot be empty.")

    try:
        url = normalize_url(raw_url)
    except ValueError as exc:
        raise ImportValidationError(str(exc))

    parsed = urlparse(url)
    host = parsed.hostname or ""

    if parsed.port is not None and parsed.port not in (80, 443):
        raise ImportValidationError("Only standard HTTP/HTTPS ports are allowed.")

    if _is_internal_ip_text(host):
        raise ImportValidationError(
            "Importing from private or local-network addresses is not allowed."
        )

    # Resolve the hostname and make sure none of its addresses are internal.
    # This also surfaces DNS failures as a clear error.
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ImportValidationError(f"DNS resolution failed for '{host}'.")
    except Exception:
        raise ImportValidationError(f"Unable to resolve host '{host}'.")

    for info in infos:
        if _resolves_to_internal(info[4][0]):
            raise ImportValidationError(
                "Host resolves to a private or local-network address and "
                "cannot be imported."
            )

    if not domain_matches(host, allowlist):
        raise ImportValidationError(
            f"Domain '{host}' is not in the authorized import list."
        )

    return url
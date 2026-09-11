









import os
import socket
import ipaddress
from urllib.parse import urlparse


_BLOCKED_HOSTS = {
    "metadata.google.internal",
    "metadata",
    "metadata.goog",
}


def assert_public_http_url(url: str) -> None:






    if not isinstance(url, str) or not url:
        raise ValueError("空 URL")
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise ValueError(f"不允许的 URL scheme: {p.scheme!r}（仅 http/https）")
    host = p.hostname
    if not host:
        raise ValueError("URL 缺少主机名")
    if host.lower() in _BLOCKED_HOSTS:
        raise ValueError(f"禁止访问元数据/内部主机: {host}")

    try:
        literal_ip = ipaddress.ip_address(host)
        _assert_ip_public(literal_ip)
        return
    except ValueError:
        pass
    port = p.port or (443 if p.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise ValueError(f"无法解析主机 {host}: {e}")
    for info in infos:
        _assert_ip_public(ipaddress.ip_address(info[4][0]))


def _assert_ip_public(ip) -> None:
    if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified):
        raise ValueError(f"禁止访问内网/保留地址: {ip}")


def safe_storage_path(url: str, project_root: str) -> str:




    base = os.path.realpath(os.path.join(project_root, "persistent_storage"))
    if url.startswith("/storage/"):
        rel = url[len("/storage/"):]
    else:
        rel = url.lstrip("/")
    full = os.path.realpath(os.path.join(base, rel))
    if full != base and not full.startswith(base + os.sep):
        raise ValueError(f"路径越界，拒绝访问 persistent_storage 之外: {url}")
    return full

"""Update-Prüfung über die GitHub-Releases und Ein-Klick-Update unter Windows.

Es wird nur die öffentliche Release-Information von GitHub abgefragt
(api.github.com, ohne persönliche Daten). Unter Windows lädt „Jetzt
aktualisieren“ den Installer, prüft seine SHA-256-Prüfsumme und startet ihn
still; der Installer beendet Buchlover, installiert und startet es neu.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import threading
import time
import urllib.request

from . import __version__

REPO = "TherapyCenter/Buchlover"
API = os.environ.get("BUCHLOVER_UPDATE_URL") or f"https://api.github.com/repos/{REPO}/releases/latest"
RELEASES = f"https://github.com/{REPO}/releases"
CACHE_SECONDS = 6 * 3600

_cache = {"t": 0.0, "data": None}
_lock = threading.Lock()


def parse_version(v):
    nums = re.findall(r"\d+", str(v or ""))[:3]
    return tuple(int(n) for n in nums) + (0,) * (3 - len(nums))


def _arch():
    m = platform.machine().lower()
    return "arm64" if m in ("arm64", "aarch64") else "x86_64"


def platform_key():
    if os.environ.get("BUCHLOVER_DOCKER"):
        return "docker"
    if sys.platform == "win32":
        return "windows"
    if sys.platform == "darwin":
        return "macos-" + _arch()
    return "linux-" + ("aarch64" if _arch() == "arm64" else "x86_64")


def _pick_asset(assets, key):
    for a in assets or []:
        n = a.get("name", "")
        if key == "windows" and n.lower().endswith(".exe") and "setup" in n.lower():
            return a
        if key.startswith(("macos-", "linux-")) and key in n:
            return a
    return None


def install_dir():
    """Installationsordner des Windows-Installers, sonst None (Quellcode, Linux …)."""
    if sys.platform != "win32":
        return None
    app = os.path.dirname(os.path.dirname(os.path.abspath(sys.executable)))   # {app}\python\pythonw.exe
    return app if os.path.isfile(os.path.join(app, "unins000.exe")) else None


def _release_api():
    req = urllib.request.Request(API, headers={"User-Agent": f"Buchlover/{__version__}",
                                               "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def _asset_name(version, key):
    if key == "windows":
        return f"Buchlover-Setup-{version}.exe"
    if key.startswith("macos-"):
        return f"Buchlover-{version}-{key}.dmg"
    if key.startswith("linux-"):
        return f"buchlover-{version}-{key}.tar.gz"
    return None


def _release_redirect():
    """Ersatz, wenn die GitHub-API nicht antwortet (z.B. Abfragelimit je IP-Adresse):
    github.com/…/releases/latest leitet auf …/releases/tag/vX.Y.Z weiter."""
    req = urllib.request.Request(RELEASES + "/latest", method="HEAD",
                                 headers={"User-Agent": f"Buchlover/{__version__}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        final = r.geturl()
    m = re.search(r"/releases/tag/([^/?#]+)", final)
    if not m:
        raise ValueError("Keine Release-Information gefunden")
    tag = m.group(1)
    ver = tag.lstrip("vV")
    assets = []
    for key in ("windows", "macos-arm64", "macos-x86_64", "linux-x86_64", "linux-aarch64"):
        n = _asset_name(ver, key)
        assets.append({"name": n, "browser_download_url": f"{RELEASES}/download/{tag}/{n}"})
    return {"tag_name": tag, "html_url": final, "body": "", "assets": assets}


def check(force=False):
    """Neueste Version ermitteln -> dict (Ergebnis 6 Stunden zwischengespeichert)."""
    with _lock:
        if not force and _cache["data"] and time.time() - _cache["t"] < CACHE_SECONDS:
            return _cache["data"]
    try:
        rel = _release_api()
    except Exception:  # noqa - Limit erreicht, API gestört …
        if os.environ.get("BUCHLOVER_UPDATE_URL"):
            raise
        rel = _release_redirect()
    latest = (rel.get("tag_name") or "").lstrip("vV")
    key = platform_key()
    asset = _pick_asset(rel.get("assets"), key)
    data = {
        "current": __version__, "latest": latest,
        "newer": parse_version(latest) > parse_version(__version__),
        "url": rel.get("html_url") or RELEASES, "notes": (rel.get("body") or "")[:6000],
        "published": rel.get("published_at"), "platform": key,
        "asset": {"name": asset["name"], "url": asset.get("browser_download_url"),
                  "size": asset.get("size"), "digest": asset.get("digest")} if asset else None,
        "can_install": bool(asset and key == "windows" and install_dir()),
    }
    with _lock:
        _cache.update(t=time.time(), data=data)
    return data


def download_and_install(data_dir, port=8765):
    """Windows: Installer laden, Prüfsumme prüfen, still installieren und neu starten."""
    info = check()
    if not info["newer"]:
        raise ValueError("Keine neuere Version vorhanden")
    if not info["can_install"]:
        raise ValueError("Automatisches Update ist hier nicht möglich")
    a = info["asset"]
    if not a.get("digest"):            # Prüfsumme fehlte (Ersatzweg) – noch einmal bei der API nachfragen
        try:
            info = check(force=True)
            a = info["asset"] or a
        except Exception:  # noqa
            pass
    if not str(a.get("url", "")).startswith(("https://github.com/", "https://objects.githubusercontent.com/")) \
            and not os.environ.get("BUCHLOVER_UPDATE_URL"):
        raise ValueError("Unerwartete Download-Adresse")
    target_dir = os.path.join(data_dir, "update")
    os.makedirs(target_dir, exist_ok=True)
    target = os.path.join(target_dir, os.path.basename(a["name"]))
    req = urllib.request.Request(a["url"], headers={"User-Agent": f"Buchlover/{__version__}"})
    h = hashlib.sha256()
    with urllib.request.urlopen(req, timeout=60) as r, open(target + ".part", "wb") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            fh.write(chunk)
    digest = (a.get("digest") or "").lower()
    if digest.startswith("sha256:") and digest[7:] != h.hexdigest():
        os.remove(target + ".part")
        raise ValueError("Prüfsumme des Installers stimmt nicht – Update abgebrochen")
    os.replace(target + ".part", target)
    if os.environ.get("BUCHLOVER_UPDATE_DRYRUN"):
        return {"file": target, "sha256": h.hexdigest(), "started": False}
    # /MERGETASKS="!importblh": beim Update nicht erneut den Buchliebhaber importieren
    args = [target, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RESTART=1",
            '/MERGETASKS="!importblh"']
    flags = 0x00000008 | 0x00000200   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(" ".join(f'"{x}"' if " " in x and not x.startswith("/") else x for x in args),
                     creationflags=flags, close_fds=True)
    return {"file": target, "sha256": h.hexdigest(), "started": True}

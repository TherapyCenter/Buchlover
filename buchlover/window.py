"""Öffnet Buchlover in einem eigenen Programmfenster (App-Modus von Edge/Chrome).

Das Fenster hat keine Adresszeile und keine Tabs. Es läuft mit einem eigenen
Browserprofil im Datenordner, dadurch ist es ein eigener Prozess: Wird das
Fenster geschlossen, endet der Prozess – und Buchlover beendet sich.
Ist weder Edge noch Chrome/Chromium vorhanden, wird der Standardbrowser benutzt.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import webbrowser

WINDOW_SIZE = "1280,860"


def _candidates():
    if sys.platform == "win32":
        roots = [os.environ.get(k) for k in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
        rel = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe",
               r"Chromium\Application\chrome.exe", r"BraveSoftware\Brave-Browser\Application\brave.exe"]
        for r in rel:                      # Reihenfolge: erst Edge überall, dann Chrome …
            for root in roots:
                if root:
                    yield os.path.join(root, r)
    elif sys.platform == "darwin":
        for app, exe in (("Microsoft Edge", "Microsoft Edge"), ("Google Chrome", "Google Chrome"),
                         ("Chromium", "Chromium"), ("Brave Browser", "Brave Browser")):
            for base in ("/Applications", os.path.expanduser("~/Applications")):
                yield f"{base}/{app}.app/Contents/MacOS/{exe}"
    else:
        for name in ("microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable",
                     "chromium", "chromium-browser", "brave-browser"):
            p = shutil.which(name)
            if p:
                yield p


def find_app_browser():
    for p in _candidates():
        if p and os.path.isfile(p):
            return p
    return None


def open_window(url, data_dir, force_browser=False):
    """Öffnet die Oberfläche. Liefert den Fenster-Prozess (Popen) oder None,
    wenn der normale Browser benutzt wurde."""
    exe = None if force_browser else find_app_browser()
    if not exe:
        webbrowser.open(url)
        return None
    profile = os.path.join(data_dir, "fenster")
    first = not os.path.isdir(profile)
    args = [exe, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run",
            "--no-default-browser-check", "--disable-sync", "--lang=de",
            "--hide-crash-restore-bubble"]
    if first:
        args.append(f"--window-size={WINDOW_SIZE}")
    kw = {}
    if sys.platform == "win32":
        kw["creationflags"] = 0x08000000      # CREATE_NO_WINDOW (keine Konsole)
    try:
        return subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, **kw)
    except OSError:
        webbrowser.open(url)
        return None


def close_window(proc):
    """Fenster schließen wie mit X (Windows: WM_CLOSE, sonst SIGTERM); notfalls hart."""
    if proc is None or proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=0x08000000, timeout=5)
        else:
            proc.terminate()
        proc.wait(timeout=5)
    except Exception:  # noqa
        try:
            proc.kill()
        except OSError:
            pass

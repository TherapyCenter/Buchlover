"""Baut die Linux- bzw. macOS-Pakete mit eingebettetem Python.

    python installer/build_unix.py linux-x86_64|linux-aarch64|macos-arm64|macos-x86_64

Ergebnis in dist/:
  linux:  buchlover-<ver>-linux-<arch>.tar.gz   (Starter, install.sh, uninstall.sh)
  macos:  Buchlover-<ver>-macos-<arch>.dmg      (Buchlover.app; DMG nur auf macOS)

Python stammt aus python-build-standalone (astral-sh), Version wie unter Windows.
Muss auf dem Zielbetriebssystem laufen (Dateirechte, Symlinks, hdiutil).
"""
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "installer")
sys.path.insert(0, HERE)
import make_icon  # noqa: E402

PY_VERSION = "3.15.2"
PBS_TAG = "20261110"
TRIPLES = {
    "linux-x86_64": "x86_64-unknown-linux-gnu",
    "linux-aarch64": "aarch64-unknown-linux-gnu",
    "macos-arm64": "aarch64-apple-darwin",
    "macos-x86_64": "x86_64-apple-darwin",
}


def app_version():
    import re
    src = open(os.path.join(ROOT, "buchlover", "__init__.py"), encoding="utf-8").read()
    return re.search(r'__version__\s*=\s*"([^"]+)"', src).group(1)


def fetch_python(target):
    name = f"cpython-{PY_VERSION}+{PBS_TAG}-{TRIPLES[target]}-install_only.tar.gz"
    url = f"https://github.com/astral-sh/python-build-standalone/releases/download/{PBS_TAG}/{name}"
    cache = os.path.join(ROOT, "build", "cache")
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        print("Lade", url)
        urllib.request.urlretrieve(url, path + ".part")
        os.replace(path + ".part", path)
    return path


def extract_python(tgz, dest):
    """Entpackt 'python/' aus dem Archiv nach dest (ohne Test- und Header-Ballast)."""
    with tarfile.open(tgz) as t:
        members = [m for m in t.getmembers()
                   if not any(x in m.name for x in ("/test/", "/idlelib/", "/tkinter/", "/turtledemo/",
                                                    "/include/", "/ensurepip/", "/lib2to3/"))]
        t.extractall(dest, members=members, filter="tar")


def copy_app(dest):
    shutil.copytree(os.path.join(ROOT, "buchlover"), os.path.join(dest, "buchlover"),
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(os.path.join(ROOT, "HANDBUCH.md"), dest)


def write(path, text, exe=False):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    if exe:
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def selftest(python, apppath):
    env = dict(os.environ, PYTHONPATH=apppath)
    out = subprocess.run([python, "-c", "import buchlover.server, sqlite3, ssl; print(buchlover.__version__)"],
                         capture_output=True, text=True, env=env)
    if out.returncode:
        sys.exit("Selbsttest fehlgeschlagen:\n" + out.stderr)
    print("Selbsttest ok:", out.stdout.strip())


# ------------------------------------------------------------------ Linux

LAUNCHER = """#!/bin/sh
# Buchlover starten (eingebettetes Python)
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PYTHONPATH="$HERE/app" exec "$HERE/python/bin/python3" -m buchlover "$@"
"""

INSTALL_SH = """#!/bin/sh
# Installiert Buchlover für den aktuellen Benutzer nach ~/.local/opt/buchlover
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/opt/buchlover"
BIN="$HOME/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
# laufende Instanz beenden (Update)
if command -v curl >/dev/null 2>&1; then curl -s -m 3 -X POST http://127.0.0.1:8765/api/shutdown >/dev/null 2>&1 || true; sleep 1; fi
mkdir -p "$DEST" "$BIN" "$APPS"
if [ "$SRC" != "$DEST" ]; then
  rm -rf "$DEST/python" "$DEST/app"
  cp -R "$SRC/." "$DEST/"
fi
ln -sf "$DEST/buchlover" "$BIN/buchlover"
cat > "$APPS/buchlover.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Buchlover
GenericName=Bücherverwaltung
Comment=OpenSource „Buchliebhaber“ – Bücherverwaltung
Exec=$DEST/buchlover
Icon=$DEST/buchlover.png
Terminal=false
Categories=Office;Database;
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Buchlover installiert: $DEST"
echo "Start über das Anwendungsmenü oder mit: $BIN/buchlover"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Hinweis: $BIN ist nicht im PATH." ;; esac
"""

UNINSTALL_SH = """#!/bin/sh
# Entfernt Buchlover (der Datenordner ~/.local/share/buchlover bleibt erhalten)
DEST="$HOME/.local/opt/buchlover"
command -v curl >/dev/null 2>&1 && curl -s -m 3 -X POST http://127.0.0.1:8765/api/shutdown >/dev/null 2>&1
rm -f "$HOME/.local/bin/buchlover" "${XDG_DATA_HOME:-$HOME/.local/share}/applications/buchlover.desktop"
rm -rf "$DEST"
echo "Buchlover entfernt. Ihre Daten liegen weiterhin in ${XDG_DATA_HOME:-$HOME/.local/share}/buchlover"
"""


def build_linux(target, ver):
    name = f"buchlover-{ver}-{target}"
    stage = os.path.join(ROOT, "build", name)
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    extract_python(fetch_python(target), stage)          # -> stage/python
    copy_app(os.path.join(stage, "app"))
    for f in ("README.md", "LICENSE", "HANDBUCH.md"):
        shutil.copy2(os.path.join(ROOT, f), stage)
    with open(os.path.join(stage, "buchlover.png"), "wb") as f:
        f.write(make_icon.png(256))
    write(os.path.join(stage, "buchlover"), LAUNCHER, exe=True)
    write(os.path.join(stage, "install.sh"), INSTALL_SH, exe=True)
    write(os.path.join(stage, "uninstall.sh"), UNINSTALL_SH, exe=True)
    if target == f"linux-{os.uname().machine}".replace("arm64", "aarch64"):
        selftest(os.path.join(stage, "python", "bin", "python3"), os.path.join(stage, "app"))
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", name + ".tar.gz")
    with tarfile.open(out, "w:gz") as t:
        t.add(stage, arcname=name)
    print("Fertig:", out)
    return out


# ------------------------------------------------------------------ macOS

MAC_LAUNCHER = """#!/bin/sh
# Startet Buchlover aus dem App-Bundle abgekoppelt im Hintergrund und beendet sich
# sofort – so öffnet jeder weitere Doppelklick zuverlässig den Browser.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
export PYTHONPATH="$RES/app"
LOG="$HOME/Library/Logs/Buchlover.log"
mkdir -p "$HOME/Library/Logs"
nohup "$RES/python/bin/python3" -m buchlover "$@" </dev/null >>"$LOG" 2>&1 &
exit 0
"""


def icns(path):
    """ICNS mit PNG-Einträgen (ic07=128, ic08=256, ic09=512, ic10=1024)."""
    import struct
    chunks = b""
    for typ, n in ((b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)):
        data = make_icon.png(n)
        chunks += typ + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def build_macos(target, ver):
    name = f"Buchlover-{ver}-{target}"
    work = os.path.join(ROOT, "build", name)
    shutil.rmtree(work, ignore_errors=True)
    app = os.path.join(work, "Buchlover.app", "Contents")
    res = os.path.join(app, "Resources")
    os.makedirs(os.path.join(app, "MacOS"))
    os.makedirs(res)
    extract_python(fetch_python(target), res)            # -> Resources/python
    copy_app(os.path.join(res, "app"))
    icns(os.path.join(res, "buchlover.icns"))
    write(os.path.join(app, "MacOS", "Buchlover"), MAC_LAUNCHER, exe=True)
    with open(os.path.join(app, "Info.plist"), "wb") as f:
        plistlib.dump({
            "CFBundleName": "Buchlover", "CFBundleDisplayName": "Buchlover",
            "CFBundleIdentifier": "io.github.therapycenter.buchlover",
            "CFBundleVersion": ver, "CFBundleShortVersionString": ver,
            "CFBundleExecutable": "Buchlover", "CFBundleIconFile": "buchlover.icns",
            "CFBundlePackageType": "APPL", "LSMinimumSystemVersion": "11.0",
            "LSUIElement": True, "NSHighResolutionCapable": True,
            "CFBundleDevelopmentRegion": "de",
        }, f)
    for f in ("README.md", "LICENSE", "HANDBUCH.md"):
        shutil.copy2(os.path.join(ROOT, f), work)
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    if sys.platform != "darwin":
        print("Hinweis: DMG kann nur auf macOS erzeugt werden; Bundle liegt in", work)
        return work
    machine = os.uname().machine
    if (machine == "arm64") == target.endswith("arm64"):
        selftest(os.path.join(res, "python", "bin", "python3"), os.path.join(res, "app"))
    # ad-hoc signieren (nötig für Apple-Silicon), dann DMG mit Verknüpfung auf /Applications
    subprocess.check_call(["codesign", "--force", "--deep", "--sign", "-",
                           os.path.join(work, "Buchlover.app")])
    os.symlink("/Applications", os.path.join(work, "Programme"))
    out = os.path.join(ROOT, "dist", name + ".dmg")
    if os.path.exists(out):
        os.remove(out)
    subprocess.check_call(["hdiutil", "create", "-volname", f"Buchlover {ver}", "-srcfolder", work,
                           "-ov", "-format", "UDZO", out])
    print("Fertig:", out)
    return out


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in TRIPLES:
        sys.exit(__doc__)
    target, ver = sys.argv[1], app_version()
    (build_linux if target.startswith("linux") else build_macos)(target, ver)


if __name__ == "__main__":
    main()

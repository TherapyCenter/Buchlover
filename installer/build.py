"""Baut den Windows-Installer dist/Buchlover-Setup-<version>.exe.

Ablauf: eingebettetes Python laden (Cache) -> build/stage zusammenstellen ->
Inno Setup (ISCC.exe) aufrufen.   Aufruf:  python installer/build.py
"""
import glob
import hashlib
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "installer")
BUILD = os.path.join(ROOT, "build")
STAGE = os.path.join(BUILD, "stage")
CACHE = os.path.join(BUILD, "cache")

PY_VERSION = "3.15.2"   # getestete Version
PY_URL = f"https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-embed-amd64.zip"


def app_version():
    src = open(os.path.join(ROOT, "buchlover", "__init__.py"), encoding="utf-8").read()
    return re.search(r'__version__\s*=\s*"([^"]+)"', src).group(1)


def fetch_python():
    os.makedirs(CACHE, exist_ok=True)
    zpath = os.path.join(CACHE, os.path.basename(PY_URL))
    if not os.path.exists(zpath):
        print("Lade", PY_URL)
        urllib.request.urlretrieve(PY_URL, zpath + ".part")
        os.replace(zpath + ".part", zpath)
    with open(zpath, "rb") as f:
        print("Python embed sha256:", hashlib.sha256(f.read()).hexdigest())
    return zpath


def find_iscc():
    cands = [os.path.expandvars(r"%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"),
             os.path.expandvars(r"%ProgramFiles%\Inno Setup 6\ISCC.exe"),
             os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe")]
    for c in cands:
        if os.path.isfile(c):
            return c
    return shutil.which("ISCC")


def stage(pyzip):
    shutil.rmtree(STAGE, ignore_errors=True)
    pydir = os.path.join(STAGE, "python")
    os.makedirs(pydir)
    with zipfile.ZipFile(pyzip) as z:
        z.extractall(pydir)
    # Suchpfad des eingebetteten Pythons: ..\app enthält das Paket buchlover
    pth = glob.glob(os.path.join(pydir, "python*._pth"))[0]
    zipname = os.path.basename(glob.glob(os.path.join(pydir, "python3*.zip"))[0])
    with open(pth, "w", encoding="ascii") as f:
        f.write(f"{zipname}\n.\n..\\app\n")
    shutil.copytree(os.path.join(ROOT, "buchlover"), os.path.join(STAGE, "app", "buchlover"),
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for f in ("HANDBUCH.md", "MANUAL.md"):
        shutil.copy2(os.path.join(ROOT, f), os.path.join(STAGE, "app"))
    for f in ("README.md", "LICENSE", "HANDBUCH.md", "MANUAL.md"):
        shutil.copy2(os.path.join(ROOT, f), STAGE)
    ico = os.path.join(HERE, "buchlover.ico")
    if not os.path.exists(ico):
        subprocess.check_call([sys.executable, os.path.join(HERE, "make_icon.py"), ico])
    shutil.copy2(ico, STAGE)
    # Schnelltest: startet das eingebettete Python mit dem Paket?
    out = subprocess.run([os.path.join(pydir, "python.exe"), "-c",
                          "import buchlover.server, sqlite3, ssl; print(buchlover.__version__)"],
                         capture_output=True, text=True)
    if out.returncode:
        sys.exit("Selbsttest fehlgeschlagen:\n" + out.stderr)
    print("Selbsttest ok, Version", out.stdout.strip())


def main():
    ver = app_version()
    stage(fetch_python())
    iscc = find_iscc()
    if not iscc:
        sys.exit("Inno Setup 6 (ISCC.exe) nicht gefunden – https://jrsoftware.org/isinfo.php")
    subprocess.check_call([iscc, f"/DAppVer={ver}", os.path.join(HERE, "buchlover.iss")])
    print("Fertig:", os.path.join(ROOT, "dist", f"Buchlover-Setup-{ver}.exe"))


if __name__ == "__main__":
    main()

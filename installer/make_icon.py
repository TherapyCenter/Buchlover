"""Erzeugt installer/buchlover.ico (Buch-Symbol) ohne Fremdbibliotheken."""
import os
import struct
import sys
import zlib

BLUE = (0x31, 0x5C, 0x86, 255)
SPINE = (0x90, 0xB4, 0xD8, 255)
PAGE = (0xF4, 0xF1, 0xEA, 255)
LINE = (0xC9, 0xBF, 0xAE, 255)


def draw(n):
    px = [[(0, 0, 0, 0)] * n for _ in range(n)]
    s = n / 32.0

    def rect(x0, y0, x1, y1, c):
        for y in range(int(y0 * s), int(y1 * s)):
            for x in range(int(x0 * s), int(x1 * s)):
                if 0 <= x < n and 0 <= y < n:
                    px[y][x] = c

    rect(7, 4, 27, 29, PAGE)          # Seiten
    rect(5, 3, 25, 27, BLUE)          # Einband
    rect(8, 3, 11, 27, SPINE)         # Rücken
    rect(14, 8, 22, 9.6, PAGE)        # Titelzeilen
    rect(14, 11.5, 20, 12.8, PAGE)
    rect(25, 5, 27, 28, LINE)         # Seitenschnitt
    return px


def png(n):
    px = draw(n)
    raw = b"".join(b"\0" + b"".join(bytes(c) for c in row) for row in px)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico(path, sizes=(16, 24, 32, 48, 64, 256)):
    images = [png(n) for n in sizes]
    head = struct.pack("<HHH", 0, 1, len(sizes))
    off = 6 + 16 * len(sizes)
    entries = b""
    for n, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", n % 256, n % 256, 0, 0, 1, 32, len(data), off)
        off += len(data)
    with open(path, "wb") as f:
        f.write(head + entries + b"".join(images))


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "buchlover.ico")
    ico(out)
    print("Icon:", out)

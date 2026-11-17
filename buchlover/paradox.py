"""Reader for Borland/Corel Paradox tables (.DB + .MB blob files).

Supports Paradox 3.x - 7.x data files, all common field types and memo/BLOB
fields stored in the companion .MB file. Pure standard library.
"""
from __future__ import annotations

import datetime as _dt
import os
import struct

try:
    from ._crypt_tables import TAB_A, TAB_B, TAB_C
except ImportError:  # executed as a script
    from _crypt_tables import TAB_A, TAB_B, TAB_C

FIELD_TYPES = {
    0x01: "alpha", 0x02: "date", 0x03: "short", 0x04: "long",
    0x05: "currency", 0x06: "number", 0x09: "logical", 0x0C: "memo",
    0x0D: "blob", 0x0E: "fmtmemo", 0x0F: "ole", 0x10: "graphic",
    0x14: "time", 0x15: "timestamp", 0x16: "autoinc", 0x17: "bcd",
    0x18: "bytes",
}
BLOB_TYPES = {0x0C, 0x0D, 0x0E, 0x0F, 0x10}

_CODEPAGES = {437: "cp437", 850: "cp850", 852: "cp852", 1252: "cp1252", 1250: "cp1250"}


class ParadoxError(Exception):
    pass


class Field:
    __slots__ = ("name", "type", "size", "type_name")

    def __init__(self, name, ftype, size):
        self.name = name
        self.type = ftype
        self.size = size
        self.type_name = FIELD_TYPES.get(ftype, f"0x{ftype:02x}")

    def __repr__(self):
        return f"<Field {self.name} {self.type_name}({self.size})>"


class ParadoxTable:
    def __init__(self, path: str, encoding: str | None = None):
        self.path = path
        with open(path, "rb") as f:
            self.data = f.read()
        self._mb = None
        self._parse_header(encoding)

    # ------------------------------------------------------------------ header
    def _parse_header(self, encoding):
        d = self.data
        if len(d) < 0x58:
            raise ParadoxError("file too small")
        (self.record_size, self.header_size) = struct.unpack_from("<HH", d, 0)
        self.file_type = d[4]
        self.block_size = d[5] * 1024
        (self.num_records,) = struct.unpack_from("<I", d, 6)
        (self.first_block,) = struct.unpack_from("<H", d, 0x0E)
        self.num_fields = struct.unpack_from("<H", d, 0x21)[0]
        self.key_fields = struct.unpack_from("<H", d, 0x23)[0]
        self.encryption = struct.unpack_from("<I", d, 0x25)[0]
        self.version = d[0x39]
        (self.autoinc,) = struct.unpack_from("<I", d, 0x49)
        if self.file_type not in (0, 2):
            raise ParadoxError(f"not a data table (file type {self.file_type})")
        if self.block_size == 0 or self.header_size == 0:
            raise ParadoxError("invalid header")

        extended = self.version >= 5
        codepage = 0
        if self.encryption == 0xFF00FF00 and len(d) >= 0x60:
            # Paradox 4+: real key lives in the extended header
            self.encryption = struct.unpack_from("<I", d, 0x5C)[0]
        if extended:
            codepage = struct.unpack_from("<H", d, 0x6A)[0]
            pos = 0x78
        else:
            pos = 0x58
        self.codepage = codepage
        self.encoding = encoding or _CODEPAGES.get(codepage, "cp1252")

        ftypes = []
        for i in range(self.num_fields):
            ftypes.append((d[pos], d[pos + 1]))
            pos += 2
        pos += 4  # table name pointer
        pos += 4 * self.num_fields  # field name pointers
        tn_len = 261 if self.version >= 0x0C else 79
        raw_tn = d[pos:pos + tn_len]
        self.table_name = raw_tn.split(b"\0", 1)[0].decode(self.encoding, "replace")
        pos += tn_len
        names = []
        for _ in range(self.num_fields):
            end = d.index(b"\0", pos)
            names.append(d[pos:end].decode(self.encoding, "replace"))
            pos = end + 1
        self.fields = [Field(n, t, s) for n, (t, s) in zip(names, ftypes)]
        if sum(f.size for f in self.fields) != self.record_size:
            # Not fatal, but suspicious
            self.size_mismatch = True
        else:
            self.size_mismatch = False

    # ----------------------------------------------------------------- records
    def __iter__(self):
        return self.records()

    def _block(self, block):
        bs = self.block_size
        off = self.header_size + (block - 1) * bs
        raw = self.data[off:off + bs]
        if self.encryption and len(raw) == bs:
            raw = decrypt_block(raw, self.encryption, block)
        return raw

    def records(self, as_dict=True):
        rs = self.record_size
        block = self.first_block
        seen = set()
        nblocks = (len(self.data) - self.header_size) // self.block_size
        while block and block not in seen and block <= nblocks:
            seen.add(block)
            d = self._block(block)
            off = 0
            nxt, _prev, add = struct.unpack_from("<HHh", d, off)
            count = add // rs + 1 if add >= 0 else 0
            p = off + 6
            for _ in range(count):
                rec = d[p:p + rs]
                p += rs
                vals = self._decode_record(rec)
                yield dict(zip((f.name for f in self.fields), vals)) if as_dict else vals
            block = nxt

    def _decode_record(self, rec):
        out = []
        p = 0
        for f in self.fields:
            raw = rec[p:p + f.size]
            p += f.size
            try:
                out.append(self._decode(f, raw))
            except Exception:  # never fail a whole record on one odd value
                out.append(None)
        return out

    def _decode(self, f, raw):
        t = f.type
        if t == 0x01:
            s = raw.split(b"\0", 1)[0]
            return s.decode(self.encoding, "replace") if s else None
        if not any(raw):
            return None
        if t in (0x03, 0x04, 0x16, 0x02, 0x14):
            b = bytearray(raw)
            b[0] ^= 0x80
            fmt = ">h" if len(b) == 2 else ">i"
            v = struct.unpack(fmt, bytes(b))[0]
            if t == 0x02:
                return _days_to_date(v)
            if t == 0x14:
                return _dt.time(v // 3600000, (v // 60000) % 60, (v // 1000) % 60,
                                (v % 1000) * 1000)
            return v
        if t in (0x05, 0x06, 0x15):
            b = bytearray(raw)
            if b[0] & 0x80:
                b[0] ^= 0x80
            else:
                b = bytearray(x ^ 0xFF for x in b)
            v = struct.unpack(">d", bytes(b))[0]
            if t == 0x15:
                ms = v
                days = int(ms // 86400000)
                base = _days_to_date(days)
                if base is None:
                    return None
                return _dt.datetime.combine(base, _dt.time()) + _dt.timedelta(
                    milliseconds=ms - days * 86400000)
            return v
        if t == 0x09:
            return raw[0] == 0x81 if raw[0] in (0x80, 0x81) else bool(raw[0] & 0x7F)
        if t in BLOB_TYPES:
            return self._read_blob(f, raw)
        if t == 0x18:
            return bytes(raw)
        if t == 0x17:
            return _bcd(raw)
        return bytes(raw)

    # ------------------------------------------------------------------- blobs
    def _mbdata(self):
        if self._mb is None:
            base, _ = os.path.splitext(self.path)
            self._mb = b""
            for ext in (".MB", ".mb", ".Mb", ".mB"):
                if os.path.exists(base + ext):
                    with open(base + ext, "rb") as fh:
                        self._mb = fh.read()
                    if self.encryption:
                        self._mb = decrypt_mb(self._mb, self.encryption)
                    break
        return self._mb

    def _read_blob(self, f, raw):
        leader_len = f.size - 10
        leader = raw[:leader_len]
        offidx, length, _mod = struct.unpack_from("<IIH", raw, leader_len)
        is_text = f.type in (0x0C, 0x0E)
        if length == 0:
            return None
        if length <= leader_len:
            data = leader[:length]
        else:
            mb = self._mbdata()
            index = offidx & 0xFF
            offset = offidx & 0xFFFFFF00
            data = None
            if mb and offset < len(mb):
                btype = mb[offset]
                if index == 0xFF and btype == 2:
                    blen = struct.unpack_from("<I", mb, offset + 3)[0]
                    data = mb[offset + 9: offset + 9 + blen]
                elif btype == 3:
                    e = offset + 12 + index * 5
                    if e + 5 <= len(mb):
                        doff = mb[e]
                        ldiv = mb[e + 1]
                        lmod = mb[e + 4]
                        blen = (ldiv - 1) * 16 + lmod if ldiv else lmod
                        start = offset + doff * 16
                        data = mb[start:start + blen]
            if data is None:
                data = leader  # best effort
        if f.type == 0x10 and data[:8] and len(data) > 8 and data[8:10] in (b"BM", b"\xff\xd8"):
            data = data[8:]
        if f.type == 0x0E:
            data = fmtmemo_text(data)
        if is_text:
            return data.rstrip(b"\0").decode(self.encoding, "replace")
        return bytes(data)

    # ---------------------------------------------------------------- summary
    def describe(self):
        return {
            "table": os.path.basename(self.path),
            "records": self.num_records,
            "version": self.version,
            "codepage": self.codepage,
            "encrypted": bool(self.encryption),
            "keyed": self.key_fields,
            "fields": [(f.name, f.type_name, f.size) for f in self.fields],
        }


MAGIC_FMT = bytes([7, 0, 0, 0])


def fmtmemo_text(data):
    """Extract the plain text from a Paradox formatted-memo (rich text) blob.

    Layout: u32 7, u32 text length, then (u16 id, u32 value) pairs ending with
    id 7, followed by the text and binary formatting runs.
    """
    if len(data) < 14 or data[:4] != MAGIC_FMT:
        return data
    tlen = struct.unpack_from("<I", data, 4)[0]
    pos = 8
    for _ in range(32):
        if pos + 6 > len(data):
            break
        ident = struct.unpack_from("<H", data, pos)[0]
        pos += 6
        if ident == 7:
            return data[pos:pos + tlen]
    # fallback: first NUL-terminated printable run after the header
    end = data.find(bytes(1), 44)
    return data[44:end if end > 0 else None]


def _decrypt_chunk(src, a, b, c, d):
    out = bytearray(256)
    for x in range(256):
        y = (TAB_C[x] - d) & 0xFF
        out[x] = src[y] ^ TAB_A[(x + a) & 0xFF] ^ TAB_B[(y + b) & 0xFF] ^ TAB_C[(y + c) & 0xFF]
    return out


def decrypt_block(raw, encryption, blockno):
    """Decrypt one .DB data block (Paradox table password protection)."""
    a = encryption & 0xFF
    b = (encryption >> 8) & 0xFF
    out = bytearray()
    for chunk in range(len(raw) // 256):
        out += _decrypt_chunk(raw[chunk * 256:(chunk + 1) * 256], a, b, chunk, blockno & 0xFF)
    return bytes(out)


def decrypt_mb(mb, encryption):
    a = encryption & 0xFF
    b = (encryption >> 8) & 0xFF
    out = bytearray(mb[:4096])
    for pos in range(4096, len(mb) - 255, 256):
        out += _decrypt_chunk(mb[pos:pos + 256], a, b, (a + 1) & 0xFF, (b + 1) & 0xFF)
    return bytes(out)


def _days_to_date(days):
    if days <= 0:
        return None
    try:
        return _dt.date.fromordinal(days)
    except ValueError:
        return None


def _bcd(raw):
    # Paradox BCD: first byte sign/precision, rest nibbles; return float best effort
    neg = not (raw[0] & 0x80)
    digits = "".join(f"{b:02x}" for b in raw[1:])
    if neg:
        digits = "".join("%x" % (15 - int(c, 16)) for c in digits)
    try:
        v = int(digits[:32]) / 10 ** (raw[0] & 0x3F)
    except ValueError:
        return None
    return -v if neg else v


def open_table(path, encoding=None):
    return ParadoxTable(path, encoding)


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        try:
            t = ParadoxTable(p)
        except Exception as e:  # noqa
            print(f"## {p}: {e}")
            continue
        info = t.describe()
        print(f"## {info['table']}  recs={info['records']} v={info['version']} "
              f"cp={info['codepage']} key={info['keyed']} enc={info['encrypted']}")
        print("   " + ", ".join(f"{n}:{tn}{'' if tn not in ('alpha',) else '(%d)' % s}"
                                for n, tn, s in info["fields"]))

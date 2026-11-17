"""Minimaler Markdown-Renderer für das eingebaute Handbuch (ohne Fremdbibliotheken).

Unterstützt: Überschriften, Absätze, Listen (auch verschachtelt), Tabellen,
Codeblöcke, Zitate, Trennlinien, **fett**, *kursiv*, `Code`, [Links](url).
"""
from __future__ import annotations

import html
import re


def _slug(text):
    s = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.UNICODE)
    return re.sub(r"\s+", "-", s.strip())


def _inline(text):
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(f"<code>{html.escape(p[1:-1])}</code>")
            continue
        p = html.escape(p, quote=False)
        p = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", p)
        p = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", p)

        def link(m):
            url = m.group(2)
            if not re.match(r"^(https?://|#|/|mailto:)", url):
                url = "#"
            ext = ' target="_blank" rel="noopener noreferrer"' if url.startswith("http") else ""
            return f'<a href="{html.escape(url, quote=True)}"{ext}>{m.group(1)}</a>'
        p = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, p)
        out.append(p)
    return "".join(out)


def render(md: str):
    lines = md.replace("\r\n", "\n").split("\n")
    out, toc = [], []
    i = 0
    para = []

    def flush():
        if para:
            out.append("<p>" + _inline(" ".join(x.strip() for x in para)) + "</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            j = i + 1
            code = []
            while j < len(lines) and not lines[j].startswith("```"):
                code.append(lines[j])
                j += 1
            out.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
            i = j + 1
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush()
            lvl, text = len(m.group(1)), m.group(2).strip()
            sid = _slug(text)
            if lvl == 2:
                toc.append((sid, text))
            out.append(f'<h{lvl} id="{sid}">{_inline(text)}</h{lvl}>')
            i += 1
            continue
        if re.match(r"^\s*(-{3,}|\*{3,})\s*$", line):
            flush()
            out.append("<hr>")
            i += 1
            continue
        if line.startswith(">"):
            flush()
            quote = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i][1:].strip())
                i += 1
            out.append("<blockquote>" + _inline(" ".join(quote)) + "</blockquote>")
            continue
        if line.lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-+", lines[i + 1]):
            flush()
            head = [c.strip() for c in line.strip().strip("|").split("|")]
            rows = []
            i += 2
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            t = "<table><thead><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in head) + "</tr></thead><tbody>"
            for r in rows:
                t += "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>"
            out.append(t + "</tbody></table>")
            continue
        if re.match(r"^\s*([-*]|\d+\.)\s+", line):
            flush()
            i = _list(lines, i, out)
            continue
        if not line.strip():
            flush()
        else:
            para.append(line)
        i += 1
    flush()
    return "\n".join(out), toc


def _list(lines, i, out):
    """Liste ab Zeile i; Folgezeilen, eingerückte Codeblöcke und Unterlisten
    gehören zum Eintrag. Text wird erst am Ende eines Eintrags formatiert,
    damit **fett** auch über Zeilenumbrüche funktioniert."""
    item_rx = re.compile(r"^\s*([-*]|\d+\.)\s+(.*)$")
    base = len(lines[i]) - len(lines[i].lstrip())
    tag = "ol" if re.match(r"^\s*\d+\.", lines[i]) else "ul"
    out.append(f"<{tag}>")
    item = None   # Liste von ("t", Rohtext) / ("h", fertiges HTML)

    def close():
        if item is None:
            return
        html_parts, text = [], []
        for kind, val in item + [("h", "")]:
            if kind == "t":
                text.append(val)
            else:
                if text:
                    html_parts.append(_inline(" ".join(text)))
                    text.clear()
                html_parts.append(val)
        out.append("<li>" + "".join(html_parts) + "</li>")

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            nind = len(nxt) - len(nxt.lstrip())
            if nxt.strip() and (nind > base or (item_rx.match(nxt) and nind == base)):
                i += 1
                continue
            break
        ind = len(line) - len(line.lstrip())
        m = item_rx.match(line)
        if ind > base and line.lstrip().startswith("```") and item is not None:
            code = []
            i += 1
            while i < len(lines) and not lines[i].lstrip().startswith("```"):
                code.append(lines[i][ind:] if lines[i][:ind].strip() == "" else lines[i].strip())
                i += 1
            item.append(("h", "<pre><code>" + html.escape(chr(10).join(code)) + "</code></pre>"))
            i += 1
        elif m and ind == base:
            close()
            item = [("t", m.group(2))]
            i += 1
        elif m and ind > base and item is not None:
            sub = []
            i = _list(lines, i, sub)
            item.append(("h", "".join(sub)))
        elif ind > base and item is not None:
            item.append(("t", line.strip()))
            i += 1
        else:
            break
    close()
    out.append(f"</{tag}>")
    return i


PAGE = """<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root {{ --bg:#f4f1ea; --surface:#fff; --ink:#23211d; --ink2:#5b574f; --line:#ddd7cb; --accent:#315c86; --code:#f1ede4; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#1b1d20; --surface:#24272b; --ink:#ebe8e2; --ink2:#b9b4aa; --line:#3a3f45; --accent:#7fa8d1; --code:#2b2f34; }} }}
* {{ box-sizing: border-box; }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:15px/1.6 "Segoe UI", system-ui, -apple-system, sans-serif; }}
.wrap {{ display:grid; grid-template-columns: 250px minmax(0, 820px); gap:28px; max-width:1120px; margin:0 auto; padding:24px 16px; }}
nav {{ position:sticky; top:16px; align-self:start; font-size:13.5px; max-height:calc(100vh - 32px); overflow:auto; }}
nav a {{ display:block; color:var(--ink2); text-decoration:none; padding:3px 8px; border-radius:5px; }}
nav a:hover {{ background:var(--surface); color:var(--ink); }}
nav strong {{ display:block; padding:3px 8px 8px; }}
main {{ background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:8px 32px 32px; min-width:0; }}
h1 {{ font-size:26px; }} h2 {{ font-size:20px; margin-top:36px; padding-top:12px; border-top:1px solid var(--line); }}
h3 {{ font-size:16px; margin-top:24px; }} h4 {{ font-size:15px; }}
a {{ color:var(--accent); }}
code {{ background:var(--code); padding:1px 5px; border-radius:4px; font-size:13px; font-family:ui-monospace, Consolas, monospace; }}
pre {{ background:var(--code); padding:12px 14px; border-radius:6px; overflow:auto; }} pre code {{ padding:0; background:none; }}
table {{ border-collapse:collapse; width:100%; font-size:14px; margin:12px 0; }}
th, td {{ border:1px solid var(--line); padding:6px 9px; text-align:left; vertical-align:top; }}
th {{ background:var(--code); }}
blockquote {{ margin:12px 0; padding:8px 14px; border-left:4px solid var(--accent); background:var(--code); border-radius:0 6px 6px 0; }}
@media (max-width: 800px) {{ .wrap {{ grid-template-columns: 1fr; }} nav {{ position:static; max-height:none; }} main {{ padding:4px 16px 24px; }} }}
@media print {{ nav {{ display:none; }} .wrap {{ display:block; }} main {{ border:none; }} }}
</style></head><body><div class="wrap">
<nav><strong>{contents}</strong>{toc}</nav>
<main>{body}</main></div></body></html>"""


def markdown_page(md: str, title: str = "Handbuch", lang: str = "de"):
    body, toc = render(md)
    nav = "".join(f'<a href="#{sid}">{html.escape(t)}</a>' for sid, t in toc)
    return PAGE.format(title=html.escape(title), toc=nav, body=body, lang=lang,
                       contents="Inhalt" if lang == "de" else "Contents")

"""
Generic, structure-aware PDF chunking (PyMuPDF only).

Design rules
------------
* No document-specific logic: nothing here knows what "EDUCATION" or
  "PROJECTS" is. Headings are found from how the text LOOKS (size, weight,
  coloured bands, spacing), measured relative to the document's own body text.
* Reading order comes from page position, not from PDF content-stream order.
* Repeated page furniture (running headers / footers / page numbers) is
  detected by repetition and removed.
* Chunks follow the document's own sections. A section that fits is one
  chunk; a bigger one is split on its sub-headings, then on paragraphs.
  Tiny neighbouring pieces are merged so no orphan fragments remain.
* Each chunk starts with its heading trail ("A > B > C") for context.
* If anything fails, chunk_pdf() falls back to the original pipeline.
"""

import logging
import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------- settings
MAX_CHARS = 1300        # largest body of a single piece before splitting
MERGE_MAX_CHARS = 1500  # largest body after merging small neighbours
MIN_CHARS = 300         # pieces smaller than this are merge candidates
TINY_CHARS = 150        # pieces smaller than this are always merged

TOP_ZONE = 0.12         # page furniture can only live in these margins
BOTTOM_ZONE = 0.08

BULLET_RE = re.compile(r"^\s*(?:[•·▪●◦■□‣⁃*–—-]|\d{1,3}[.)]|[a-zA-Z][.)])\s+")
SENTENCE_END = (".", "!", "?", ":", ";", '"', "”", ")", "’")


# ------------------------------------------------------------- data classes
@dataclass
class Line:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    size: float
    bold: float                 # fraction of characters in a bold face
    in_band: bool = False       # sits on a coloured strip
    gap_before: float = 1e9     # vertical gap to the previous line on the page
    heading_class: str | None = None


@dataclass
class Block:
    text: str
    page: int


@dataclass
class Node:
    title: str | None
    level: int
    page: int
    blocks: list = field(default_factory=list)
    children: list = field(default_factory=list)


@dataclass
class Piece:
    """One or more (heading-trail, body) segments that become one chunk."""
    segments: list
    page: int

    @property
    def trail(self):
        trails = [t for t, _ in self.segments]
        n = min(len(t) for t in trails)
        k = 0
        while k < n and all(t[k] == trails[0][k] for t in trails):
            k += 1
        return trails[0][:k]

    def render(self):
        base = self.trail
        prev, parts = base, []
        for trail, body in self.segments:
            start = max(_common(prev, trail), len(base))
            heads = trail[start:]
            parts.append("\n".join(heads + [body]) if heads else body)
            prev = trail
        return "\n\n".join(p for p in parts if p)

    def size(self):
        return len(self.render())


# ----------------------------------------------------------- 1. extraction
def _is_bold(span) -> bool:
    name = span["font"].lower()
    return bool(span["flags"] & 16) or "bold" in name or "black" in name


def _raw_lines(page, pno):
    """All text lines of a page with style info (in PDF order)."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for ln in block["lines"]:
            spans = [s for s in ln["spans"] if s["text"].strip()]
            if not spans:
                continue
            spans.sort(key=lambda s: s["bbox"][0])

            text = spans[0]["text"]
            for prev, cur in zip(spans, spans[1:]):
                gap = cur["bbox"][0] - prev["bbox"][2]
                if (not text.endswith(" ") and not cur["text"].startswith(" ")
                        and gap > 0.15 * cur["size"]):
                    text += " "
                text += cur["text"]
            text = re.sub(r"\s+", " ", text).strip()
            if not text:
                continue

            chars = sum(len(s["text"].strip()) or 1 for s in spans)
            bold_chars = sum(len(s["text"].strip()) or 1 for s in spans if _is_bold(s))
            dominant = max(spans, key=lambda s: len(s["text"].strip()))
            x0, y0, x1, y1 = ln["bbox"]
            out.append(Line(pno, x0, y0, x1, y1, text,
                            round(dominant["size"], 1), bold_chars / chars))
    return out


def _bands(page):
    """Wide, coloured, strip-shaped fills (section bars). Generic visual cue."""
    bands = []
    width = page.rect.width
    for d in page.get_drawings():
        fill = d.get("fill")
        r = d.get("rect")
        if not fill or r is None:
            continue
        if r.width < 0.4 * width or r.height < 8 or r.height > 40:
            continue
        lum = 0.299 * fill[0] + 0.587 * fill[1] + 0.114 * fill[2] if len(fill) >= 3 else fill[0]
        if lum >= 0.88:         # white / near-white cards are not bands
            continue
        bands.append(r)
    return bands


def _attach_drop_caps(raw, body_size):
    """A huge single initial ("M" + "ARCUS ...") is glued back onto its line."""
    if not body_size:
        return raw
    caps = [l for l in raw if len(l.text) == 1 and l.text.isalpha()
            and l.size >= 2.2 * body_size]
    if not caps:
        return raw
    remaining = [l for l in raw if l not in caps]
    for cap in caps:
        # lines beside the initial: inside its vertical span, right of its left edge
        candidates = [l for l in remaining
                      if cap.y0 - 3 <= l.y0 <= cap.y1
                      and l.x0 > cap.x0 + 0.25 * (cap.x1 - cap.x0)]
        if candidates:
            target = min(candidates, key=lambda l: (l.y0, l.x0))
            target.text = cap.text + target.text
    return remaining


def _merge_rows(raw):
    """Merge lines that share a baseline (e.g. a title and its right-aligned date)."""
    raw = sorted(raw, key=lambda l: ((l.y0 + l.y1) / 2, l.x0))
    rows = []
    for ln in raw:
        mid = (ln.y0 + ln.y1) / 2
        h = max(ln.y1 - ln.y0, 1)
        if rows:
            ref = rows[-1][0]
            ref_mid = (ref.y0 + ref.y1) / 2
            ref_h = max(ref.y1 - ref.y0, 1)
            if abs(mid - ref_mid) <= 0.45 * min(h, ref_h):
                rows[-1].append(ln)
                continue
        rows.append([ln])

    merged = []
    for row in rows:
        row.sort(key=lambda l: l.x0)
        lead = row[0]
        merged.append(Line(
            page=lead.page,
            x0=min(l.x0 for l in row), y0=min(l.y0 for l in row),
            x1=max(l.x1 for l in row), y1=max(l.y1 for l in row),
            text=" ".join(l.text for l in row),
            size=lead.size, bold=lead.bold,
        ))
    return merged


def _normalise(text):
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", text.lower())).strip()


def _body_size(pages):
    weights = Counter()
    for lines in pages:
        for l in lines:
            weights[l.size] += len(l.text)
    return weights.most_common(1)[0][0] if weights else 0.0


def _extract(doc):
    """-> list of pages, each a list of Line in reading order, furniture removed."""
    page_h = {}
    raw_pages = []
    for pno, page in enumerate(doc, start=1):
        page_h[pno] = page.rect.height
        raw_pages.append((page, _raw_lines(page, pno)))

    # Furniture = the same (digit-normalised) text at the same vertical position
    # in a page margin on several pages (running headers, footers, page numbers).
    margin = {}
    for page, raw in raw_pages:
        for l in raw:
            h = page_h[l.page]
            if l.y1 < TOP_ZONE * h or l.y0 > (1 - BOTTOM_ZONE) * h:
                margin.setdefault(_normalise(l.text), []).append(l)
    needed = 2 if len(raw_pages) <= 2 else 3
    furniture_ids = set()
    for key, found in margin.items():
        if not key:
            continue
        ys = sorted(l.y0 for l in found)
        median = ys[len(ys) // 2]
        near = [l for l in found if abs(l.y0 - median) <= 3]
        if len({l.page for l in near}) >= needed:
            furniture_ids.update(id(l) for l in near)

    cleaned = [(page, [l for l in raw if id(l) not in furniture_ids])
               for page, raw in raw_pages]

    body = _body_size([k for _, k in cleaned])

    pages = []
    for page, kept in cleaned:
        kept = _attach_drop_caps(kept, body)
        lines = _merge_rows(kept)
        bands = _bands(page)
        for l in lines:
            mid = (l.y0 + l.y1) / 2
            l.in_band = any(b.y0 - 2 <= mid <= b.y1 + 2 and l.x0 >= b.x0 - 4
                            and l.x1 <= b.x1 + 4 for b in bands)
        prev = None
        for l in lines:
            l.gap_before = (l.y0 - prev.y1) if prev else 1e9
            prev = l
        pages.append(lines)
    return pages, _body_size(pages)


# ------------------------------------------------------------ 2. headings
def _classify(lines_by_page, body):
    for lines in lines_by_page:
        for l in lines:
            txt = l.text.strip()
            words = len(txt.split())
            if not txt or len(txt) > 120 or words > 14:
                continue
            if txt.endswith(":") or BULLET_RE.match(txt):
                continue                        # labels and list items
            ratio = l.size / body if body else 1.0
            ends_sentence = txt.endswith((".", ",", ";"))

            if l.in_band:
                l.heading_class = "band"
            elif ratio >= 1.4:
                l.heading_class = "large"      # "KODY TECHNOLAB LTD." is still a title
            elif ends_sentence:
                continue
            elif ratio >= 1.15 and l.bold >= 0.5:
                l.heading_class = "medium"
            elif l.bold >= 0.9 and l.gap_before >= 0.45 * body:
                l.heading_class = "bold"


CLASS_ORDER = {"large": 0, "band": 1, "medium": 2, "bold": 3}
FAMILY = {"large": "size", "medium": "size", "band": "band", "bold": "bold"}


def _group_headings(lines_by_page, body):
    """
    Merge consecutive heading lines (a multi-line title) into one heading and
    return [(page, text, signature, line_index_range)] in reading order.
    """
    items = []   # ("heading", page, text, sig) | ("line", Line)
    for lines in lines_by_page:
        i = 0
        while i < len(lines):
            l = lines[i]
            if l.heading_class:
                group = [l]
                j = i + 1
                while (j < len(lines) and lines[j].heading_class
                       and FAMILY[lines[j].heading_class] == FAMILY[l.heading_class]
                       and lines[j].gap_before < 1.0 * max(l.size, body)):
                    group.append(lines[j])
                    j += 1
                best = min(group, key=lambda g: (CLASS_ORDER[g.heading_class], -g.size))
                sig = (best.heading_class,
                       round(best.size / 1.0) if best.heading_class in ("large", "medium") else 0)
                items.append(("heading", l.page, " ".join(g.text for g in group), sig))
                i = j
            else:
                items.append(("line", l))
                i += 1
    return items


def _level_map(items):
    sigs = {it[3] for it in items if it[0] == "heading"}
    ordered = sorted(sigs, key=lambda s: (CLASS_ORDER[s[0]], -s[1]))
    return {sig: n + 1 for n, sig in enumerate(ordered)}


# ---------------------------------------------------------------- 3. tree
def _is_new_paragraph(prev, cur):
    if cur.gap_before >= 0.45 * max(cur.size, 1) and cur.page == prev.page:
        return True
    if BULLET_RE.match(cur.text):
        return True
    if cur.page != prev.page:       # continuation across a page break?
        return prev.text.rstrip().endswith(SENTENCE_END) or not cur.text[:1].islower()
    return False


def _join(a, b):
    if re.search(r"[A-Za-z]-$", a) and b[:1].islower():
        return a[:-1] + b                       # de-hyphenate a wrapped word
    return a + " " + b


def _paragraphs(lines):
    paras, cur, prev = [], [], None
    for l in lines:
        if prev is not None and _is_new_paragraph(prev, l):
            paras.append(cur)
            cur = []
        cur.append(l)
        prev = l
    if cur:
        paras.append(cur)

    blocks = []
    for p in paras:
        items, buf = [], None
        for l in p:
            if BULLET_RE.match(l.text):
                if buf is not None:
                    items.append(buf)
                buf = l.text
            elif buf is None:
                buf = l.text
            else:
                buf = _join(buf, l.text)
        if buf is not None:
            items.append(buf)
        blocks.append(Block("\n".join(items), p[0].page))
    return blocks


def _build_tree(items, levels):
    root = Node(None, 0, 1)
    stack = [root]
    pending = []

    def flush():
        if pending:
            stack[-1].blocks.extend(_paragraphs(pending))
            pending.clear()

    for it in items:
        if it[0] == "line":
            pending.append(it[1])
            continue
        flush()
        _, page, text, sig = it
        level = levels[sig]
        while stack[-1].level >= level:
            stack.pop()
        node = Node(text, level, page)
        stack[-1].children.append(node)
        stack.append(node)
    flush()
    return root


# -------------------------------------------------------------- 4. chunks
def _total_len(node):
    n = len(node.title or "") + sum(len(b.text) + 2 for b in node.blocks)
    return n + sum(_total_len(c) + 2 for c in node.children)


def _render_inline(node, with_title=False):
    parts = []
    if with_title and node.title:
        parts.append(node.title)
    parts.extend(b.text for b in node.blocks)
    for c in node.children:
        parts.append(_render_inline(c, with_title=True))
    return "\n\n".join(p for p in parts if p)


def _first_page(node):
    if node.blocks:
        return node.blocks[0].page
    for c in node.children:
        return _first_page(c)
    return node.page


def _split_long(text):
    """Split an over-long paragraph on sentence (then word) boundaries."""
    if len(text) <= MAX_CHARS:
        return [text]
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out, cur = [], ""
    for s in sentences:
        while len(s) > MAX_CHARS:                       # pathological: no punctuation
            cut = s.rfind(" ", 0, MAX_CHARS)
            cut = cut if cut > 0 else MAX_CHARS
            if cur:
                out.append(cur)
                cur = ""
            out.append(s[:cut])
            s = s[cut:].lstrip()
        if cur and len(cur) + 1 + len(s) > MAX_CHARS:
            out.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        out.append(cur)
    return out


def _split_block(text):
    """A block is split only if it alone exceeds MAX_CHARS (bullets stay together)."""
    if len(text) <= MAX_CHARS:
        return [text]
    if "\n" not in text:
        return _split_long(text)
    out, cur = [], ""
    for line in text.split("\n"):
        for part in _split_long(line):
            if cur and len(cur) + 1 + len(part) > MAX_CHARS:
                out.append(cur)
                cur = part
            else:
                cur = f"{cur}\n{part}" if cur else part
    if cur:
        out.append(cur)
    return out


def _pack(blocks, trail):
    """Pack consecutive paragraphs into pieces no larger than MAX_CHARS."""
    pieces, cur, cur_page, size = [], [], None, 0
    for b in blocks:
        for part in _split_block(b.text):
            if cur and size + len(part) + 2 > MAX_CHARS:
                pieces.append(Piece([(list(trail), "\n\n".join(cur))], cur_page))
                cur, size, cur_page = [], 0, None
            if cur_page is None:
                cur_page = b.page
            cur.append(part)
            size += len(part) + 2
    if cur:
        pieces.append(Piece([(list(trail), "\n\n".join(cur))], cur_page))
    return pieces


def _pieces(node, trail):
    parent_trail = trail
    trail = trail + [node.title] if node.title else trail
    if not node.blocks and not node.children and node.title:
        # heading with no text under it: keep its words as content, never drop them
        return [Piece([(parent_trail, node.title)], node.page)]
    if _total_len(node) <= MAX_CHARS:
        body = _render_inline(node)
        return [Piece([(trail, body)], _first_page(node))] if body.strip() else []
    out = _pack(node.blocks, trail) if node.blocks else []
    for c in node.children:
        out.extend(_pieces(c, trail))
    return out


def _common(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def _merge(a, b):
    return Piece(a.segments + b.segments, a.page)


def _is_ancestor(a, b):
    """a's trail is a prefix of b's trail (a = a section, b = inside it)."""
    return b.trail[:len(a.trail)] == a.trail


def _related(a, b):
    """Same section family: siblings, or one inside the other."""
    ta, tb = a.trail, b.trail
    cp = _common(ta, tb)
    siblings = len(ta) == len(tb) and cp == len(ta) - 1
    nested = cp == min(len(ta), len(tb))
    return siblings or nested


def _merge_small(pieces):
    # Pass A: a small section intro joins its own first sub-section.
    out, i = [], 0
    while i < len(pieces):
        p = pieces[i]
        if (i + 1 < len(pieces) and p.size() < MIN_CHARS
                and _is_ancestor(p, pieces[i + 1])
                and p.size() + pieces[i + 1].size() + 2 <= MERGE_MAX_CHARS):
            pieces[i + 1] = _merge(p, pieces[i + 1])
            i += 1
            continue
        out.append(p)
        i += 1

    # Pass B: remaining small pieces join a related neighbour; tiny ones join
    # any neighbour (never leave an orphan fragment).
    merged = []
    for p in out:
        if merged:
            a = merged[-1]
            small = min(a.size(), p.size())
            if (a.size() + p.size() + 2 <= MERGE_MAX_CHARS
                    and (small < TINY_CHARS or (small < MIN_CHARS and _related(a, p)))):
                merged[-1] = _merge(a, p)
                continue
        merged.append(p)
    return merged


def _to_chunks(pieces):
    chunks = []
    for p in pieces:
        text = p.render().strip()
        if not text:
            continue
        content = (" > ".join(p.trail) + "\n\n" + text) if p.trail else text
        chunks.append({"content": content, "page_number": p.page})
    return chunks


# ------------------------------------------------------------- public API
def analyze_pdf(file_path):
    """Return (chunks, headings) -- headings are (level, page, text), for debugging."""
    doc = pymupdf.open(file_path)
    try:
        pages, body = _extract(doc)
    finally:
        doc.close()

    if sum(len(l.text) for p in pages for l in p) < 20:
        return [], []

    _classify(pages, body)
    items = _group_headings(pages, body)
    levels = _level_map(items)
    root = _build_tree(items, levels)
    chunks = _to_chunks(_merge_small(_pieces(root, [])))
    headings = [(levels[it[3]], it[1], it[2]) for it in items if it[0] == "heading"]
    return chunks, headings


def chunk_pdf(file_path):
    """
    Structure-aware chunks: [{"content": str, "page_number": int}, ...]
    Falls back to the original page-based pipeline if anything goes wrong.
    """
    try:
        chunks, _ = analyze_pdf(file_path)
        if chunks:
            return chunks
        logger.warning("Structure-aware chunking produced no chunks; using fallback")
    except Exception:
        logger.exception("Structure-aware chunking failed; using fallback")

    from app.services.documents import extract_pages_from_pdf
    from app.services.chunking import split_pages
    return split_pages(extract_pages_from_pdf(file_path))


if __name__ == "__main__":
    # Preview without Supabase/Redis:  python -m app.services.structured_chunking file.pdf
    import sys

    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.services.structured_chunking <file.pdf>")

    found_chunks, found_headings = analyze_pdf(sys.argv[1])
    print(f"\nHEADINGS ({len(found_headings)}):")
    for lvl, pg, text in found_headings:
        print(f"  {'  ' * (lvl - 1)}L{lvl} p{pg}  {text[:90]}")
    print(f"\nCHUNKS ({len(found_chunks)}):")
    for n, ch in enumerate(found_chunks):
        flat = ch["content"].replace("\n", " / ")
        print(f"  [{n:03d}] page {ch['page_number']:>3}  {len(ch['content']):>4} chars  {flat[:110]}")
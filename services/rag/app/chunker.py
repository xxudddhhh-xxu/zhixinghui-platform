"""面向中文的文本切片: 优先按段落聚合,超长段落按句子切分,保留重叠上下文。"""

from . import config


def _split_sentences(text: str) -> list[str]:
    import re

    parts = re.split(r"(?<=[。!?!?;;\n])", text)
    return [p for p in parts if p.strip()]


def chunk_text(text: str, chunk_size: int = None, overlap: int = None) -> list[str]:
    chunk_size = chunk_size or config.CHUNK_SIZE
    overlap = overlap if overlap is not None else config.CHUNK_OVERLAP

    text = text.strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""

    def flush():
        nonlocal buf
        if buf.strip():
            chunks.append(buf.strip())
        buf = ""

    for para in paragraphs:
        if len(para) > chunk_size:
            # 超长段落先落盘缓冲,再按句子切
            flush()
            sent_buf = ""
            for sent in _split_sentences(para):
                if len(sent_buf) + len(sent) > chunk_size and sent_buf:
                    chunks.append(sent_buf.strip())
                    # 保留重叠
                    sent_buf = sent_buf[-overlap:] if overlap else ""
                sent_buf += sent
            if sent_buf.strip():
                chunks.append(sent_buf.strip())
        elif len(buf) + len(para) + 2 > chunk_size:
            flush()
            buf = para
        else:
            buf = f"{buf}\n\n{para}" if buf else para
    flush()

    if overlap:
        # 相邻切片补充尾部重叠,提升召回连续性
        overlapped = []
        for i, c in enumerate(chunks):
            if i > 0:
                prev_tail = chunks[i - 1][-overlap:]
                c = f"{prev_tail}...{c}"
            overlapped.append(c)
        chunks = overlapped

    return [c for c in chunks if len(c.strip()) >= 8]

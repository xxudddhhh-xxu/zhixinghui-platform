"""BM25 关键词检索: jieba 分词,索引按需从 Qdrant 重建并进程内缓存。"""

import logging
import threading

import jieba
from rank_bm25 import BM25Okapi

from . import vectorstore

logger = logging.getLogger("rag.bm25")

_cache: dict[str, tuple[BM25Okapi, list[dict]]] = {}
_lock = threading.Lock()


def invalidate(kb_id: str):
    with _lock:
        _cache.pop(kb_id, None)


def _tokenize(text: str) -> list[str]:
    return [t.strip().lower() for t in jieba.cut_for_search(text) if t.strip()]


def _build(kb_id: str) -> tuple[BM25Okapi, list[dict]] | None:
    docs = vectorstore.scroll_all(kb_id)
    if not docs:
        return None
    corpus = [_tokenize(d["text"]) for d in docs]
    return BM25Okapi(corpus), docs


def search(kb_id: str, query: str, top_k: int) -> list[dict]:
    with _lock:
        index = _cache.get(kb_id)
    if index is None:
        built = _build(kb_id)
        if built is None:
            return []
        with _lock:
            _cache[kb_id] = built
        index = built

    bm25, docs = index
    scores = bm25.get_scores(_tokenize(query))
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [
        {**docs[i], "bm25Score": float(scores[i])}
        for i in ranked
        if scores[i] > 0
    ]

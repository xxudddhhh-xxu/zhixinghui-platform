"""混合检索 + 重排序: Embedding 向量检索与 BM25 关键词检索并行,
RRF(Reciprocal Rank Fusion)融合排序,单路失败自动降级。"""

import logging
import concurrent.futures as cf

from . import config, bm25_store, embeddings, vectorstore

logger = logging.getLogger("rag.hybrid")


def _vector_search(kb_id: str, query: str, top_k: int) -> list[dict]:
    vec = embeddings.embed_query(query)
    return vectorstore.search(kb_id, vec, top_k * 3)


def _bm25_search(kb_id: str, query: str, top_k: int) -> list[dict]:
    return bm25_store.search(kb_id, query, top_k * 3)


def search_kb(kb_id: str, query: str, top_k: int) -> list[dict]:
    """单知识库混合检索,返回 RRF 融合后的 top_k 结果"""
    vector_hits: list[dict] = []
    bm25_hits: list[dict] = []

    with cf.ThreadPoolExecutor(max_workers=2) as pool:
        fv = pool.submit(_vector_search, kb_id, query, top_k)
        fb = pool.submit(_bm25_search, kb_id, query, top_k)
        try:
            vector_hits = fv.result(timeout=config.VECTOR_TIMEOUT + 5)
        except Exception as e:
            logger.warning("向量检索失败(kb=%s, 降级 BM25): %s: %s", kb_id, type(e).__name__, e)
        try:
            bm25_hits = fb.result(timeout=config.VECTOR_TIMEOUT + 5)
        except Exception as e:
            logger.warning("BM25 检索失败(kb=%s, 降级向量): %s: %s", kb_id, type(e).__name__, e)

    if not vector_hits and not bm25_hits:
        return []

    # RRF 融合
    scores: dict[str, float] = {}
    merged: dict[str, dict] = {}
    for hits in (vector_hits, bm25_hits):
        for rank, h in enumerate(hits):
            key = h["id"]
            scores[key] = scores.get(key, 0.0) + 1.0 / (config.RRF_K + rank + 1)
            if key not in merged:
                merged[key] = {**h, "vectorScore": h.get("vectorScore", 0.0)}
            else:
                merged[key]["vectorScore"] = max(
                    merged[key]["vectorScore"], h.get("vectorScore", 0.0)
                )

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
    # 按本批最大 RRF 归一化到 0-1, 头条命中即为 100% 相关度
    max_rrf = ranked[0][1] if ranked else 0.0
    results = []
    for key, rrf in ranked:
        h = merged[key]
        results.append(
            {
                "id": h["id"],
                "kbId": h.get("kbId", kb_id),
                "docId": h.get("docId", ""),
                "text": h["text"],
                "source": h.get("source", ""),
                "metadata": h.get("metadata", {}),
                "score": round(rrf / max_rrf, 4) if max_rrf > 0 else 0.0,
                "vectorScore": round(h.get("vectorScore", 0.0), 4),
            }
        )
    return results


def search_multi(kb_ids: list[str], query: str, top_k: int) -> list[dict]:
    results: list[dict] = []
    for kb_id in kb_ids:
        try:
            results.extend(search_kb(kb_id, query, top_k))
        except Exception as e:
            logger.error("知识库 %s 检索异常: %s", kb_id, e)
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_k]

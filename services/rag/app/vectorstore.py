"""Qdrant 向量库封装: 每个知识库一个 collection,天然隔离、可整库删除。"""

import logging
import re
import uuid

import logging
import re
import uuid

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from . import config
from .embeddings import embedding_dim

logger = logging.getLogger("rag.vectorstore")

# trust_env=False: 禁用系统代理,避免 localhost:6333 被代理拦截返回 502
client = QdrantClient(
    url=config.QDRANT_URL,
    timeout=config.VECTOR_TIMEOUT,
    check_compatibility=False,
    trust_env=False,
)

_SAFE = re.compile(r"[^a-zA-Z0-9_-]")


def collection_name(kb_id: str) -> str:
    return "kb_" + _SAFE.sub("", kb_id)[:48]


def ensure_collection(kb_id: str) -> str:
    name = collection_name(kb_id)
    dim = embedding_dim()
    if dim is None:
        raise RuntimeError("向量维度未知,请先完成一次向量化")
    if not client.collection_exists(name):
        client.create_collection(
            collection_name=name,
            vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
        )
        logger.info("创建 collection: %s (dim=%s)", name, dim)
    return name


def upsert(kb_id: str, points: list[dict]) -> int:
    name = ensure_collection(kb_id)
    client.upsert(
        collection_name=name,
        points=[
            qm.PointStruct(
                id=p["id"] if _is_uuid(p["id"]) else str(uuid.uuid5(uuid.NAMESPACE_URL, str(p["id"]))),
                vector=p["vector"],
                payload={
                    "text": p["text"],
                    "doc_id": p["doc_id"],
                    "source": p.get("source", ""),
                    "chunk_index": p.get("chunk_index", 0),
                    "metadata": p.get("metadata", {}),
                },
            )
            for p in points
        ],
    )
    return len(points)


def search(kb_id: str, vector: list[float], top_k: int) -> list[dict]:
    name = collection_name(kb_id)
    if not client.collection_exists(name):
        return []
    hits = client.query_points(
        collection_name=name, query=vector, limit=top_k
    ).points
    return [_hit_to_dict(kb_id, h) for h in hits]


def scroll_all(kb_id: str) -> list[dict]:
    """全量拉取(重建 BM25 索引用)"""
    name = collection_name(kb_id)
    if not client.collection_exists(name):
        return []
    results, offset = [], None
    while True:
        points, offset = client.scroll(
            collection_name=name, limit=256, offset=offset, with_payload=True
        )
        results.extend(points)
        if offset is None:
            break
    return [_hit_to_dict(kb_id, p) for p in results]


def delete_doc(kb_id: str, doc_id: str) -> None:
    name = collection_name(kb_id)
    if not client.collection_exists(name):
        return
    client.delete(
        collection_name=name,
        points_selector=qm.FilterSelector(
            filter=qm.Filter(must=[qm.FieldCondition(key="doc_id", match=qm.MatchValue(value=doc_id))])
        ),
    )


def delete_kb(kb_id: str) -> None:
    name = collection_name(kb_id)
    if client.collection_exists(name):
        client.delete_collection(name)


def _hit_to_dict(kb_id: str, p) -> dict:
    payload = p.payload or {}
    return {
        "id": str(p.id),
        "kbId": kb_id,
        "docId": payload.get("doc_id", ""),
        "text": payload.get("text", ""),
        "source": payload.get("source", ""),
        "metadata": payload.get("metadata", {}),
        # scroll 返回的点没有 score(仅查询命中才有)
        "vectorScore": getattr(p, "score", None) or 0.0,
    }


def _is_uuid(v) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except Exception:
        return False

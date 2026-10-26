"""向量化客户端: 优先 OpenAI 兼容远程接口(EMBEDDING_ID),
远程不可用/无该模型时自动降级为本地哈希向量(jieba 分词 + 字符二元组特征哈希),
保证向量链路离线可用; 与 BM25 混合检索互补, 保证召回质量。"""

import hashlib
import logging
import math

from openai import OpenAI

from . import config

logger = logging.getLogger("rag.embeddings")

_client = OpenAI(
    base_url=config.GLM_BASE_URL,
    api_key=config.GLM_API_KEY,
    timeout=config.EMBED_TIMEOUT,
    max_retries=1,
)

BATCH = 16
LOCAL_DIM = 1024
_dim_cache: int | None = None
_remote_alive = True  # 远程失败后置 False, 之后请求直接走本地, 定期探测恢复


def _tokens(text: str) -> list[str]:
    import jieba

    toks = [t for t in jieba.lcut(text) if t.strip()]
    # 字符二元组: 缓解未登录词/OOV, 中文检索的关键补充
    chars = "".join(toks)
    toks.extend(chars[i : i + 2] for i in range(len(chars) - 1))
    return toks


def _hash_embed(text: str) -> list[float]:
    """确定性特征哈希向量: token -> 哈希桶累加, L2 归一化。"""
    vec = [0.0] * LOCAL_DIM
    for tok in _tokens(text[:4000]):
        h = int.from_bytes(hashlib.md5(tok.encode("utf-8")).digest()[:8], "big")
        idx = h % LOCAL_DIM
        sign = 1.0 if (h >> 62) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _remote_embed(texts: list[str]) -> list[list[float]] | None:
    try:
        vectors: list[list[float]] = []
        for i in range(0, len(texts), BATCH):
            batch = [t[:4000] for t in texts[i : i + BATCH]]
            resp = _client.embeddings.create(model=config.EMBEDDING_ID, input=batch)
            vectors.extend([d.embedding for d in resp.data])
        return vectors
    except Exception as e:  # 模型不存在/网络失败等
        logger.warning("远程 embedding 不可用(%s: %s), 降级本地哈希向量", type(e).__name__, str(e)[:200])
        return None


def embed_texts(texts: list[str]) -> list[list[float]]:
    global _dim_cache, _remote_alive
    if not texts:
        return []
    vectors = None
    if _remote_alive:
        vectors = _remote_embed(texts)
        if vectors is None:
            _remote_alive = False
    if vectors is None:  # 本地兜底(每 50 次请求重试一次远程)
        _remote_alive = False
        vectors = [_hash_embed(t) for t in texts]
        embed_texts._local_count = getattr(embed_texts, "_local_count", 0) + 1
        if embed_texts._local_count % 50 == 0:
            _remote_alive = True
    if vectors and _dim_cache is None:
        _dim_cache = len(vectors[0])
        logger.info("向量维度: %s (模式: %s)", _dim_cache, "remote" if _remote_alive else "local-fallback")
    return vectors


def embed_query(query: str) -> list[float]:
    return embed_texts([query])[0]


def embedding_dim() -> int | None:
    return _dim_cache


def embedding_mode() -> str:
    return "remote" if _remote_alive else "local-fallback"

"""智星惠 RAG 服务: 文本切片 / 向量化入库 / BM25+向量混合检索 / 文件解析"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

from . import bm25_store, chunker, embeddings, hybrid, parser, vectorstore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("rag.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from . import config

    logger.info(
        "RAG 服务启动: qdrant=%s embedding=%s@%s",
        config.QDRANT_URL,
        config.EMBEDDING_ID,
        config.GLM_BASE_URL,
    )
    yield


app = FastAPI(title="zhixinghui-rag", lifespan=lifespan)


class Point(BaseModel):
    id: str
    docId: str
    text: str
    source: str = ""
    metadata: dict = {}


class UpsertBody(BaseModel):
    points: list[Point]


class SearchBody(BaseModel):
    kb_ids: list[str]
    query: str
    top_k: int = 5


@app.get("/health")
def health():
    ok = True
    try:
        vectorstore.client.get_collections()
    except Exception:
        ok = False
    return {"status": "ok", "qdrant": ok, "embedding": embeddings.embedding_mode()}


@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "文件超过 20MB 限制")
    try:
        text = parser.extract_text(file.filename or "", data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"text": text, "chars": len(text)}


@app.post("/kb/{kb_id}/upsert")
def upsert(kb_id: str, body: UpsertBody):
    """切片 → 向量化 → 入库, 返回切片数量"""
    chunks_payload = []
    flat_texts = []
    for p in body.points:
        chunks = chunker.chunk_text(p.text)
        if not chunks:
            chunks = [p.text[:1000]] if p.text.strip() else []
        for i, c in enumerate(chunks):
            chunks_payload.append(
                {
                    "id": f"{p.id}:{i}",
                    "doc_id": p.id,
                    "text": c,
                    "source": p.source or p.metadata.get("title", ""),
                    "chunk_index": i,
                    "metadata": p.metadata,
                    "_vector_index": len(flat_texts),
                }
            )
            flat_texts.append(c)

    if not flat_texts:
        return {"upserted": 0}

    vectors = embeddings.embed_texts(flat_texts)
    points = [
        {**c, "vector": vectors[c["_vector_index"]]}
        for c in chunks_payload
    ]
    upserted = vectorstore.upsert(kb_id, points)
    bm25_store.invalidate(kb_id)
    return {"upserted": upserted, "chunks": len(chunks_payload)}


@app.post("/kb/search")
def search(body: SearchBody):
    if not body.kb_ids:
        raise HTTPException(400, "kb_ids 不能为空")
    if not body.query.strip():
        return {"results": []}
    try:
        results = hybrid.search_multi(body.kb_ids, body.query, body.top_k)
    except Exception as e:
        logger.exception("混合检索失败")
        raise HTTPException(502, f"检索失败: {e}")
    return {"results": results}


@app.delete("/kb/{kb_id}")
def delete_kb(kb_id: str):
    vectorstore.delete_kb(kb_id)
    bm25_store.invalidate(kb_id)
    return {"deleted": True}


@app.delete("/kb/{kb_id}/doc/{doc_id}")
def delete_doc(kb_id: str, doc_id: str):
    vectorstore.delete_doc(kb_id, doc_id)
    bm25_store.invalidate(kb_id)
    return {"deleted": True}

import os
from pathlib import Path


def _load_env():
    """轻量 .env 加载: KEY=VALUE,注释以 # 开头"""
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_env()

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")

GLM_BASE_URL = os.getenv("GLM_BASE_URL", "https://yun.youanapp.com/v1")
GLM_API_KEY = os.getenv("GLM_API_KEY", "")
EMBEDDING_ID = os.getenv("EMBEDDING_ID", "embedding-3")

# 切片参数
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "480"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "80"))

# 混合检索
RRF_K = 60
VECTOR_TIMEOUT = float(os.getenv("VECTOR_TIMEOUT", "12"))
EMBED_TIMEOUT = float(os.getenv("EMBED_TIMEOUT", "30"))

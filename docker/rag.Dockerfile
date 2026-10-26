# RAG 服务(FastAPI): 切片/向量化/混合检索/文件解析
FROM python:3.11-slim

WORKDIR /srv

COPY services/rag/requirements.txt ./
# pip 源可按网络环境覆盖: docker build --build-arg PIP_INDEX_URL=http://mirrors.aliyun.com/pypi/simple/ --build-arg PIP_TRUSTED_HOST=mirrors.aliyun.com
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} ${PIP_TRUSTED_HOST:+--trusted-host ${PIP_TRUSTED_HOST}} -r requirements.txt

COPY services/rag/app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

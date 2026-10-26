#!/usr/bin/env bash
# 单容器双进程:NestJS(对外)+ FastAPI RAG(仅容器内)
# 任一进程退出即终止容器,交给托管平台重启,避免半死状态
set -u

cd /app/services/rag
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
RAG_PID=$!

cd /app
node apps/backend/dist/main.js &
NEST_PID=$!

wait -n "$RAG_PID" "$NEST_PID"
EXIT_CODE=$?
kill "$RAG_PID" "$NEST_PID" 2>/dev/null || true
exit "$EXIT_CODE"

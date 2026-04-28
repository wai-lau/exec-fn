FROM golang:1.24-alpine AS rmapi-builder
RUN apk add --no-cache git
RUN git clone https://github.com/ddvk/rmapi.git /src && cd /src && go build -o /rmapi .

FROM python:3.12-slim
RUN apt-get update && apt-get install -y curl git fonts-dejavu-core cron && rm -rf /var/lib/apt/lists/*
COPY --from=rmapi-builder /rmapi /usr/local/bin/rmapi
RUN chmod +x /usr/local/bin/rmapi
ENV RMAPI_FORCE_SCHEMA_VERSION=4
WORKDIR /app
COPY api/requirements.txt .
RUN pip install -r requirements.txt && \
    sed -i 's/        assert block_id == CrdtId(0, 0)/        # assert block_id == CrdtId(0, 0)  # relaxed: firmware changed this/' \
    /usr/local/lib/python3.12/site-packages/rmscene/scene_stream.py
COPY api/ .
COPY web/ /app/static/
COPY fonts/ /app/static/fonts/
RUN chmod +x /app/morning_cron.sh
COPY api/exec-fn.cron /etc/cron.d/exec-fn
RUN chmod 0644 /etc/cron.d/exec-fn
COPY api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
CMD ["/usr/local/bin/entrypoint.sh"]

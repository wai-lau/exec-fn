FROM python:3.12-slim
RUN apt-get update && apt-get install -y curl git fonts-dejavu-core cron && rm -rf /var/lib/apt/lists/*
RUN curl -sL https://github.com/ddvk/rmapi/releases/download/v0.0.32/rmapi-linux-amd64.tar.gz -o /tmp/rmapi.tar.gz \
    && tar -xzf /tmp/rmapi.tar.gz -C /usr/local/bin/ \
    && chmod +x /usr/local/bin/rmapi \
    && rm /tmp/rmapi.tar.gz
WORKDIR /app
COPY api/requirements.txt .
RUN pip install -r requirements.txt && \
    sed -i 's/        assert block_id == CrdtId(0, 0)/        # assert block_id == CrdtId(0, 0)  # relaxed: firmware changed this/' \
    /usr/local/lib/python3.12/site-packages/rmscene/scene_stream.py
COPY api/ .
COPY web/ /app/static/
COPY nightfall-incident/ /app/nightfall/
RUN chmod +x /app/morning_cron.sh
COPY api/exec-fn.cron /etc/cron.d/exec-fn
RUN chmod 0644 /etc/cron.d/exec-fn
COPY api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
CMD ["/usr/local/bin/entrypoint.sh"]

FROM python:3.12-slim
# git stays: api/tarot/scripts/download_cards.py shells out to `git clone` to fetch
# the card images. curl is morning_cron.sh's POST to /api/morning; fonts-dejavu-core
# backs reportlab/PIL text rendering.
RUN apt-get update && apt-get install -y curl git fonts-dejavu-core cron && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY api/requirements.txt .
RUN pip install -r requirements.txt
COPY api/ .
COPY web/ /app/static/
RUN chmod +x /app/morning_cron.sh
COPY api/exec-fn.cron /etc/cron.d/exec-fn
RUN chmod 0644 /etc/cron.d/exec-fn
COPY api/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
CMD ["/usr/local/bin/entrypoint.sh"]

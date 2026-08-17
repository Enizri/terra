FROM python:3.12-slim-bookworm
WORKDIR /app
COPY backend/analyzer/pyproject.toml ./backend/analyzer/
COPY backend/analyzer/terra_analyzer/ ./backend/analyzer/terra_analyzer/
RUN pip install --no-cache-dir ./backend/analyzer
EXPOSE 8010
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/healthz')"
CMD ["uvicorn", "terra_analyzer.app:app", "--host", "0.0.0.0", "--port", "8010"]

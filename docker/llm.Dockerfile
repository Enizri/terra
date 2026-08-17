# Optional local GGUF OpenAI-compatible server (compose profile: llm).
# Not started by default. llama-cpp-python has no usable prebuilt wheel, so
# the image compiles it — build deps go in, and the toolchain stays because
# stripping it would need a second stage for little gain on an opt-in image.
FROM python:3.12-slim-bookworm
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential cmake \
	&& rm -rf /var/lib/apt/lists/*
COPY analyzer/pyproject.toml ./analyzer/
COPY analyzer/terra_analyzer/ ./analyzer/terra_analyzer/
COPY analyzer/terra_local_llm/ ./analyzer/terra_local_llm/
# GGML_NATIVE=OFF: with -mcpu=native, Debian's gcc 12 compiles the fp16 NEON
# intrinsics in a translation unit that was not given the matching +fp16 arch
# flag, and every vaddq_f16/vfmaq_f16 fails to inline. A generic build has no
# such mismatch, and the CPU path here is a fallback anyway.
ENV CMAKE_ARGS="-DGGML_NATIVE=OFF"
RUN pip install --no-cache-dir './analyzer[local]'
# hf_transfer is retired upstream; Xet is what huggingface_hub uses now.
ENV HF_XET_HIGH_PERFORMANCE=1
EXPOSE 8020
# Model download + load can take a few minutes on first start.
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8020/healthz')"
CMD ["uvicorn", "terra_local_llm.server:app", "--host", "0.0.0.0", "--port", "8020"]

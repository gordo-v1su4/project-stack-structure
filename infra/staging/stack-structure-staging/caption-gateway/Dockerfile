FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN uv pip install --system -r requirements.txt
COPY app.py ./app.py

EXPOSE 18091
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "18091"]

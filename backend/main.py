from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import os
import shutil
import json
import asyncio

from rag.loader import load_pdf, load_text
from rag.splitter import split_text
from rag.embeddings import get_embeddings
from rag.store import create_store, get_store

from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------
# Upload Document Endpoint
# -------------------------
@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    file_path = f"temp_{file.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Load text
    if file.filename.endswith(".pdf"):
        text = load_pdf(file_path)
    else:
        text = load_text(file_path)

    # Split into chunks
    chunks = split_text(text)

    # Tag every chunk with where it came from, so we can cite it later
    metadatas = [{"source": file.filename, "chunk": i} for i in range(len(chunks))]

    embeddings = get_embeddings()

    # Embedding + FAISS indexing is CPU/network-bound and blocking; run it in
    # a thread so it doesn't freeze the event loop for other requests.
    await asyncio.to_thread(create_store, chunks, embeddings, metadatas)

    os.remove(file_path)

    return {
        "message": f"'{file.filename}' uploaded and indexed successfully 🚀",
        "chunks": len(chunks),
    }


# -------------------------
# Ask Question Endpoint (streaming + citations)
# -------------------------
@app.get("/ask")
async def ask(q: str, history: str = Query(default="[]")):
    """
    Server-Sent Events stream.

    Each event is a JSON payload:
      {"token": "..."}                       -> one chunk of the answer
      {"done": true, "sources": [...]}        -> final event with citation list
      {"error": "..."}                        -> sent if no documents are indexed
    """
    embeddings = get_embeddings()
    store = await asyncio.to_thread(get_store, embeddings)

    if store is None:
        async def error_stream():
            yield f"data: {json.dumps({'error': 'No documents uploaded yet'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    docs = await asyncio.to_thread(store.similarity_search, q, 4)

    # Build numbered sources so the model can cite them as [1], [2], etc.
    sources = []
    context_blocks = []
    for i, d in enumerate(docs, start=1):
        src_name = d.metadata.get("source", "unknown")
        sources.append({"id": i, "source": src_name, "snippet": d.page_content[:200]})
        context_blocks.append(f"[{i}] (source: {src_name})\n{d.page_content}")

    context = "\n\n".join(context_blocks)

    # Optional client-supplied conversation history (server itself is stateless)
    try:
        past_turns = json.loads(history)
    except json.JSONDecodeError:
        past_turns = []

    history_text = ""
    for turn in past_turns[-5:]:
        history_text += f"User: {turn.get('question', '')}\nAssistant: {turn.get('answer', '')}\n"

    prompt = f"""You are a research assistant. Use ONLY the numbered context below to answer.
Cite sources inline using the matching bracket number, e.g. [1], [2]. If the context doesn't
contain the answer, say so honestly instead of guessing.

Conversation so far:
{history_text}

Context:
{context}

Question: {q}

Answer clearly and concisely, with inline citations.
"""

    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0)

    async def event_stream():
        async for chunk in llm.astream(prompt):
            token = chunk.content or ""
            if token:
                yield f"data: {json.dumps({'token': token})}\n\n"

        yield f"data: {json.dumps({'done': True, 'sources': sources})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
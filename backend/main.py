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

    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            print("Cleanup failed:", e)

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

    try:
        store = await asyncio.to_thread(get_store, embeddings)

        if store is None:
            async def error_stream():
                yield f"data: {json.dumps({'error': 'No documents uploaded yet'})}\n\n"
            return StreamingResponse(error_stream(), media_type="text/event-stream")

        docs = await asyncio.to_thread(store.similarity_search, q, 4)
    except Exception as e:
        # Catches network blips (DNS failures, connection drops) or embedding
        # API errors that happen before we ever start the LLM stream.
        error_message = str(e)
        if "getaddrinfo failed" in error_message or "ConnectError" in error_message:
            friendly_msg = "Couldn't reach the embedding service — check your internet connection and try again."
        elif "429" in error_message or "RESOURCE_EXHAUSTED" in error_message:
            friendly_msg = "Gemini API rate limit reached. Please wait a moment and try again."
        else:
            friendly_msg = "Something went wrong while searching your document."

        async def error_stream():
            yield f"data: {json.dumps({'error': friendly_msg})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

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

    prompt = f"""You are a research assistant with access to both an uploaded document and
your own general knowledge.

Rules for answering:
1. Write in natural prose. Do NOT insert bracket numbers, footnote markers, or any citation
   syntax into the answer itself — the source list is handled separately, outside your reply.
2. If the numbered context below answers the question (fully or partly), ground your answer
   in it.
3. If the context does NOT contain the answer, or only partially covers it, answer the rest
   using your own general knowledge, and briefly make that clear (e.g. "Your document
   doesn't cover this, but generally speaking...").
4. If this question is a follow-up (asking for more detail, clarification, or a different
   angle), build on what you already said instead of repeating it — add new detail,
   examples, or structure rather than restating the same sentences.

Conversation so far:
{history_text}

Context:
{context}

Question: {q}

Answer clearly and concisely, in plain prose with no citation markers.
"""

    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0)

    async def event_stream():
        try:
            async for chunk in llm.astream(prompt):
                token = chunk.content or ""
                if token:
                    yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            # Catches rate limits (429), quota errors, network issues, etc.
            # so the stream ends cleanly instead of crashing with a 500.
            error_message = str(e)
            if "429" in error_message or "RESOURCE_EXHAUSTED" in error_message:
                friendly_msg = "Gemini API rate limit reached. Please wait a moment and try again."
            else:
                friendly_msg = "Something went wrong while generating the answer."
            yield f"data: {json.dumps({'error': friendly_msg})}\n\n"
            return

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
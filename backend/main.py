from fastapi import FastAPI, UploadFile, File
from dotenv import load_dotenv
import os
import shutil

from rag.loader import load_pdf, load_text
from rag.splitter import split_text
from rag.embeddings import get_embeddings
from rag.store import create_store, get_store

from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()

app = FastAPI()


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

    # Create vector store
    embeddings = get_embeddings()
    create_store(chunks, embeddings)

    os.remove(file_path)

    return {
        "message": "Document uploaded and indexed successfully 🚀",
        "chunks": len(chunks)
    }


# -------------------------
# Ask Question Endpoint
# -------------------------
@app.get("/ask")
def ask(q: str):
    embeddings = get_embeddings()
    store = get_store(embeddings)

    if store is None:
        return {"error": "No documents uploaded yet"}

    docs = store.similarity_search(q, k=3)
    context = "\n\n".join([d.page_content for d in docs])

    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0)  # ✅ use this


    response = llm.predict(
        f"""
You are a research assistant.

Use the context below to answer the question.

Context:
{context}

Question: {q}

Answer clearly and concisely.
"""
    )

    return {
        "answer": response,
        "sources": len(docs)
    }
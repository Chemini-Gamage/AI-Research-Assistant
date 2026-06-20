# 🧠 AI Research Assistant

An AI-powered research assistant that lets you upload documents and ask questions with **grounded, cited answers**, using Retrieval-Augmented Generation (RAG).

Built with **Next.js** (frontend), **FastAPI** (backend), and **Google Gemini**, it streams answers token-by-token like ChatGPT and cites the exact source passages it used — no hallucinated claims without a paper trail.

---

## 🚀 Features

- 📄 Upload PDF or plain text documents
- 🔎 Semantic search over your documents via FAISS
- 📚 Multi-document support — upload several files, FAISS accumulates a combined index
- 💬 Real-time streaming answers via Server-Sent Events (SSE)
- 🔢 Inline citations (`[1]`, `[2]`) tied to a numbered source list
- 🧵 Lightweight conversation memory (client sends recent turns, server stays stateless)
- ⚡ Non-blocking embedding/indexing — heavy work runs off the event loop via `asyncio.to_thread`
- 🤖 Powered by Google Gemini (`gemini-2.5-flash` + `gemini-embedding-001`)

---

## 🏗️ Architecture

```
Frontend (Next.js)
      │  fetch + SSE stream
      ▼
Backend (FastAPI)
      │
      ├── /upload  → load → split → embed → FAISS index (persisted to disk)
      │
      └── /ask     → similarity search → build numbered context
                    → Gemini streams tokens → SSE → frontend renders + cites
```

---

## 📁 Project Structure

```
AI-Research-Assistant/
│
├── frontend/
│   └── research-assistant/      # Next.js chat UI
│       └── app/
│           └── layout.tsx
│
├── backend/
│   ├── main.py                  # FastAPI app: /upload and /ask endpoints
│   ├── requirements.txt
│   └── rag/
│       ├── loader.py            # PDF / text extraction
│       ├── splitter.py          # Chunking via RecursiveCharacterTextSplitter
│       ├── embeddings.py        # Gemini embedding model wrapper
│       └── store.py             # FAISS index create / load / persist
│
├── .gitignore
└── README.md
```

---

## ⚙️ Tech Stack

| Layer       | Tools |
|-------------|-------|
| Frontend    | Next.js, React |
| Backend     | FastAPI, Python, Server-Sent Events |
| Vector store| FAISS (local, disk-persisted) |
| AI / ML     | Google Gemini (`gemini-2.5-flash`, `gemini-embedding-001`), LangChain |

---

## 🧠 How It Works

1. You upload a document (PDF or `.txt`)
2. Backend extracts text and splits it into ~1000-character overlapping chunks
3. Each chunk is embedded and tagged with its source filename
4. Chunks are added to a FAISS index, persisted to disk (`faiss_index/`)
5. You ask a question
6. The top matching chunks are retrieved and numbered (`[1]`, `[2]`, ...)
7. Gemini streams an answer back, citing sources inline using those numbers
8. The frontend renders tokens as they arrive, plus a source list once streaming finishes

---

## 📦 Installation

### 1. Clone the repo

```bash
git clone https://github.com/your-username/AI-Research-Assistant.git
cd AI-Research-Assistant
```

### 2. Backend setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate # macOS / Linux

pip install -r requirements.txt
```

Create a `.env` file inside `backend/`:

```
GOOGLE_API_KEY=your_gemini_api_key_here
```

Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

Run the server:

```bash
uvicorn main:app --reload
```

Backend runs at `http://127.0.0.1:8000`.

### 3. Frontend setup

```bash
cd frontend/research-assistant
npm install
npm run dev
```

Frontend runs at `http://localhost:3000` (or the next available port).

---

## 🌐 Environment Variables

**Backend (`backend/.env`)**

```
GOOGLE_API_KEY=your_key_here
```

**Frontend** — currently the API base URL is hardcoded to `http://127.0.0.1:8000` in the fetch calls. To make it configurable, add a `.env.local` in `frontend/research-assistant/`:

```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

and reference it as `process.env.NEXT_PUBLIC_API_URL` in your fetch calls instead of hardcoding the URL.

---

## ⚠️ Free Tier Limits

Gemini's free tier caps `gemini-2.5-flash` at **20 requests per day** per Google account/project. For active development, consider:

- Enabling billing on your Google Cloud project for higher limits, or
- Rotating between a couple of free-tier API keys during testing

---

## 🔮 Roadmap

- [ ] Web search integration for hybrid local + live answers
- [ ] Persistent chat history / user accounts
- [ ] Drag-and-drop multi-file upload UI
- [ ] Source highlighting in the original document view
- [ ] Swap FAISS for a hosted vector DB (e.g. Pinecone, Qdrant) for production deployments

---

## 📸 Demo

_(Add a screenshot or GIF of the chat interface here)_

---

## 🚀 Deployment Notes

- **Frontend** → Vercel works well for Next.js out of the box
- **Backend** → Render or Railway for FastAPI; ensure `faiss_index/` is either persisted via a volume or rebuilt on startup, since most platforms wipe ephemeral disk on redeploy
- Update CORS `allow_origins` in `main.py` to your deployed frontend domain before going live

---

## ⭐ Contributing

Issues and PRs welcome — this is an active learning project, contributions and suggestions are appreciated.

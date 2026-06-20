from langchain_community.vectorstores import FAISS
import os

INDEX_PATH = "faiss_index"


def create_store(texts, embeddings):
    store = FAISS.from_texts(texts, embeddings)
    store.save_local(INDEX_PATH)
    return store


def get_store(embeddings):
    if not os.path.exists(INDEX_PATH):
        return None
    return FAISS.load_local(INDEX_PATH, embeddings, allow_dangerous_deserialization=True)
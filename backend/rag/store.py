from langchain_community.vectorstores import FAISS
import os

INDEX_PATH = "faiss_index"


def create_store(texts, embeddings, metadatas=None):
    """
    Adds texts to the existing FAISS index if one exists (so multiple
    uploaded documents accumulate instead of overwriting each other),
    otherwise creates a new index. Always persists to disk.
    """
    if os.path.exists(INDEX_PATH):
        store = FAISS.load_local(
            INDEX_PATH, embeddings, allow_dangerous_deserialization=True
        )
        store.add_texts(texts, metadatas=metadatas)
    else:
        store = FAISS.from_texts(texts, embeddings, metadatas=metadatas)

    store.save_local(INDEX_PATH)
    return store


def get_store(embeddings):
    if not os.path.exists(INDEX_PATH):
        return None
    return FAISS.load_local(
        INDEX_PATH, embeddings, allow_dangerous_deserialization=True
    )
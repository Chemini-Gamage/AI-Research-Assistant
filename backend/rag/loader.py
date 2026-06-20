from pypdf import PdfReader

def load_pdf(file_path: str):
    reader = PdfReader(file_path)
    text = ""

    for page in reader.pages:
        text += page.extract_text() or ""

    return text


def load_text(file_path: str):
    """
    Reads a text file, tolerating common encodings beyond strict UTF-8.
    Tries UTF-8 first (most common), then Windows-1252 (common on Windows-saved
    files), then falls back to Latin-1, which can decode any byte sequence
    (though it may mangle non-Latin characters in rare edge cases).
    """
    encodings_to_try = ["utf-8", "cp1252", "latin-1"]

    for encoding in encodings_to_try:
        try:
            with open(file_path, "r", encoding=encoding) as f:
                return f.read()
        except UnicodeDecodeError:
            continue

    # Last resort: decode ignoring undecodable bytes entirely
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()
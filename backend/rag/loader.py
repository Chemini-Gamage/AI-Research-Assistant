from pypdf import PdfReader

def load_pdf(file_path: str):
    reader = PdfReader(file_path)
    text = ""

    for page in reader.pages:
        text += page.extract_text() or ""

    return text


def load_text(file_path: str):
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()
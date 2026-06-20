"use client";

import { useState } from "react";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);

  // -------------------------
  // Upload document
  // -------------------------
  const uploadFile = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("http://127.0.0.1:8000/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    alert(data.message);
  };

  // -------------------------
  // Ask question
  // -------------------------
  const askQuestion = async () => {
    if (!question) return;

    const userMessage = { role: "user", text: question };
    setMessages((prev) => [...prev, userMessage]);

    const res = await fetch(
      `http://127.0.0.1:8000/ask?q=${encodeURIComponent(question)}`
    );

    const data = await res.json();

    const aiMessage = { role: "ai", text: data.answer };

    setMessages((prev) => [...prev, aiMessage]);
    setQuestion("");
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
      <h1>📚 AI Research Assistant</h1>

      {/* Upload Section */}
      <div style={{ marginBottom: 20 }}>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <button onClick={uploadFile} style={{ marginLeft: 10 }}>
          Upload
        </button>
      </div>

      {/* Chat Box */}
      <div
        style={{
          border: "1px solid #ccc",
          padding: 10,
          height: 400,
          overflowY: "scroll",
        }}
      >
        {messages.map((msg, i) => (
          <div key={i} style={{ margin: "10px 0" }}>
            <b>{msg.role === "user" ? "You" : "AI"}:</b> {msg.text}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{ marginTop: 10 }}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask something..."
          style={{ width: "80%" }}
        />
        <button onClick={askQuestion} style={{ marginLeft: 10 }}>
          Send
        </button>
      </div>
    </div>
  );
}
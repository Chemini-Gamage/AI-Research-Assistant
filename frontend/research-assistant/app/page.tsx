"use client";

import { useState, useRef, useEffect } from "react";

type Message = { role: "user" | "ai"; text: string };
type UploadState = "idle" | "uploading" | "ready" | "error";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [isAsking, setIsAsking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

  // -------------------------
  // Upload document
  // -------------------------
  const uploadFile = async () => {
    if (!file) return;
    setUploadState("uploading");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://127.0.0.1:8000/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Upload failed");
      setUploadState("ready");
    } catch (err) {
      setUploadState("error");
    }
  };

  // -------------------------
  // Ask question (SSE streaming)
  // -------------------------
  const askQuestion = async () => {
    if (!question.trim() || isAsking) return;

    const userMessage: Message = { role: "user", text: question };

    // Build a short history payload from prior turns for conversation memory
    const history = messages.reduce<{ question: string; answer: string }[]>(
      (acc, msg, i, arr) => {
        if (msg.role === "user" && arr[i + 1]?.role === "ai") {
          acc.push({ question: msg.text, answer: arr[i + 1].text });
        }
        return acc;
      },
      []
    );

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setIsAsking(true);

    // Placeholder AI message we will fill in as tokens stream in
    setMessages((prev) => [...prev, { role: "ai", text: "" }]);

    try {
      const params = new URLSearchParams({
        q: userMessage.text,
        history: JSON.stringify(history),
      });

      const res = await fetch(`http://127.0.0.1:8000/ask?${params}`);

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let answer = "";
      let buffer = ""; // carries incomplete data across reads
      let sawError = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete trailing line for next read

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const jsonStr = trimmed.slice("data: ".length);
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.error) {
              sawError = true;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "ai", text: data.error };
                return next;
              });
            } else if (data.token) {
              answer += data.token;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "ai", text: answer };
                return next;
              });
            } else if (data.done) {
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "ai",
                  text: answer || next[next.length - 1].text,
                };
                return next;
              });
            }
          } catch (e) {
            console.error("Parse error on SSE chunk:", jsonStr, e);
          }
        }
      }

      if (!answer && !sawError) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "ai",
            text: "I couldn't find an answer to that.",
          };
          return next;
        });
      }
    } catch (err) {
      console.error("askQuestion failed:", err);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "ai",
          text: "Something went wrong reaching the assistant. Please try again.",
        };
        return next;
      });
    } finally {
      setIsAsking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") askQuestion();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] || null);
    setUploadState("idle");
  };

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1A] flex flex-col">
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap");

        .font-display {
          font-family: "Source Serif 4", Georgia, serif;
        }
        .font-body {
          font-family: "Inter", system-ui, sans-serif;
        }
        .font-mono {
          font-family: "JetBrains Mono", ui-monospace, monospace;
        }
        .thread::-webkit-scrollbar {
          width: 8px;
        }
        .thread::-webkit-scrollbar-thumb {
          background: #e5e3dc;
          border-radius: 4px;
        }
        .thread::-webkit-scrollbar-track {
          background: transparent;
        }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        .typing-dot {
          animation: dotPulse 1.2s infinite ease-in-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .typing-dot { animation: none; }
        }
      `}</style>

      <div className="font-body w-full max-w-2xl mx-auto px-5 sm:px-6 py-10 flex flex-col flex-1 min-h-screen">
        {/* Header */}
        <header className="mb-8">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#8C8A82] mb-2">
            Research Assistant
          </p>
          <h1 className="font-display text-[28px] sm:text-[32px] font-medium leading-tight text-[#1C1C1A]">
            Ask your document anything.
          </h1>
        </header>

        {/* Reference card */}
        <div className="mb-6">
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${uploadState === "ready"
              ? "border-[#C9D4C1] bg-[#F3F6F1]"
              : uploadState === "error"
                ? "border-[#E3BFB8] bg-[#FBF3F1]"
                : "border-[#E5E3DC] bg-white"
              }`}
          >
            <span
              className={`shrink-0 w-2 h-2 rounded-full ${uploadState === "ready"
                ? "bg-[#7A8B6F]"
                : uploadState === "uploading"
                  ? "bg-[#3B4F8A] animate-pulse"
                  : uploadState === "error"
                    ? "bg-[#B85C4A]"
                    : "bg-[#D8D5CC]"
                }`}
              aria-hidden
            />

            <div className="flex-1 min-w-0">
              {file ? (
                <p className="font-mono text-[13px] truncate text-[#1C1C1A]">
                  {file.name}
                </p>
              ) : (
                <p className="font-mono text-[13px] text-[#8C8A82]">
                  No document selected
                </p>
              )}
              <p className="text-[12px] text-[#8C8A82] mt-0.5">
                {uploadState === "ready"
                  ? "Ready — ask a question below"
                  : uploadState === "uploading"
                    ? "Uploading…"
                    : uploadState === "error"
                      ? "Upload failed — try again"
                      : "Select a file, then upload it as your reference"}
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
              id="file-input"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 font-body text-[13px] font-medium px-3 py-1.5 rounded-md border border-[#E5E3DC] bg-white hover:bg-[#F4F3EF] transition-colors"
            >
              Choose file
            </button>
            <button
              onClick={uploadFile}
              disabled={!file || uploadState === "uploading"}
              className="shrink-0 font-body text-[13px] font-medium px-3 py-1.5 rounded-md bg-[#3B4F8A] text-white hover:bg-[#324375] disabled:bg-[#D8D5CC] disabled:cursor-not-allowed transition-colors"
            >
              {uploadState === "uploading" ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>

        {/* Chat thread */}
        <div className="thread flex-1 overflow-y-auto rounded-lg border border-[#E5E3DC] bg-white px-5 py-5 min-h-[340px] max-h-[480px]">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16">
              <p className="font-display text-[17px] text-[#1C1C1A] mb-1.5">
                Nothing asked yet
              </p>
              <p className="text-[13px] text-[#8C8A82] max-w-[280px]">
                Upload a document above, then ask a question to get an answer grounded in its contents.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                    <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-[#8C8A82] px-1">
                      {msg.role === "user" ? "You" : "Assistant"}
                    </span>
                    <div
                      className={`rounded-xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${msg.role === "user"
                        ? "bg-[#3B4F8A] text-white rounded-tr-sm"
                        : "bg-[#F4F3EF] text-[#1C1C1A] rounded-tl-sm"
                        }`}
                    >
                      {msg.text}
                      {msg.role === "ai" && msg.text === "" && isAsking && i === messages.length - 1 && (
                        <span className="inline-flex gap-1 items-center">
                          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#8C8A82] inline-block" style={{ animationDelay: "0ms" }} />
                          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#8C8A82] inline-block" style={{ animationDelay: "150ms" }} />
                          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#8C8A82] inline-block" style={{ animationDelay: "300ms" }} />
                        </span>
                      )}
                    </div>

                  </div>
                </div>
              ))}
              <div ref={threadEndRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="mt-4 flex items-center gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask something about your document…"
            className="flex-1 font-body text-[14px] rounded-lg border border-[#E5E3DC] bg-white px-4 py-3 outline-none focus:border-[#3B4F8A] focus:ring-2 focus:ring-[#3B4F8A]/15 transition-shadow placeholder:text-[#ACA99F]"
          />
          <button
            onClick={askQuestion}
            disabled={!question.trim() || isAsking}
            className="shrink-0 font-body text-[14px] font-medium px-5 py-3 rounded-lg bg-[#1C1C1A] text-white hover:bg-[#333230] disabled:bg-[#D8D5CC] disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
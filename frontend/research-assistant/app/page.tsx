"use client";

import { useState, useRef, useEffect, type ReactElement } from "react";
import { useTheme } from "next-themes";

type Message = { role: "user" | "ai"; text: string };
type UploadState = "idle" | "uploading" | "ready" | "error";
type ThemeChoice = "light" | "dark" | "system";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const options: { value: ThemeChoice; label: string; icon: ReactElement }[] = [
    {
      value: "light",
      label: "Light",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ),
    },
    {
      value: "dark",
      label: "Dark",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ),
    },
    {
      value: "system",
      label: "System",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      ),
    },
  ];

  if (!mounted) {
    return <div className="h-8 w-[108px] rounded-md bg-[#F0F2F5] dark:bg-[#141B2C]" />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-[#E2E5EA] dark:border-[#243049] bg-[#F0F2F5] dark:bg-[#141B2C]"
    >
      {options.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={`flex items-center justify-center w-7 h-7 rounded-[5px] transition-colors ${
              active
                ? "bg-white dark:bg-[#243049] text-[#1E3A8A] dark:text-[#9DBBF5] shadow-[0_0_0_1px_rgba(30,58,138,0.08)]"
                : "text-[#94A0B3] dark:text-[#5C6B8A] hover:text-[#1E3A8A] dark:hover:text-[#9DBBF5]"
            }`}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

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
    <div className="min-h-screen bg-white dark:bg-[#0B0F19] text-[#1A2230] dark:text-[#E6EAF2] flex flex-col transition-colors">
      <div className="w-full max-w-2xl mx-auto px-5 sm:px-6 py-10 flex flex-col flex-1 min-h-screen">
        {/* Header / wordmark */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2 mb-2">
              <h1 className="font-display italic text-[26px] sm:text-[30px] font-medium leading-none text-[#1E3A8A] dark:text-[#9DBBF5]">
                Intellexar
              </h1>
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[#94A0B3] dark:text-[#5C6B8A]">
                research
              </span>
            </div>
            <p className="text-[13px] text-[#5B6576] dark:text-[#8A95AC]">
              Ask your document anything. Every answer points back to the page it came from.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* Reference card */}
        <div className="mb-6">
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
              uploadState === "ready"
                ? "border-[#BFD3FB] dark:border-[#2A3D6B] bg-[#F0F5FF] dark:bg-[#0F1A2E]"
                : uploadState === "error"
                ? "border-[#E3BFB8] dark:border-[#4A352F] bg-[#FBF3F1] dark:bg-[#241915]"
                : "border-[#E2E5EA] dark:border-[#243049] bg-white dark:bg-[#101626]"
            }`}
          >
            <span
              className={`shrink-0 w-2 h-2 rounded-full ${
                uploadState === "ready"
                  ? "bg-[#2563EB]"
                  : uploadState === "uploading"
                  ? "bg-[#1E3A8A] dark:bg-[#7DA8F2] animate-pulse"
                  : uploadState === "error"
                  ? "bg-[#B85C4A]"
                  : "bg-[#D5DAE2] dark:bg-[#33405C]"
              }`}
              aria-hidden
            />

            <div className="flex-1 min-w-0">
              {file ? (
                <p className="font-mono text-[13px] truncate">{file.name}</p>
              ) : (
                <p className="font-mono text-[13px] text-[#94A0B3] dark:text-[#5C6B8A]">
                  No document selected
                </p>
              )}
              <p className="text-[12px] text-[#94A0B3] dark:text-[#5C6B8A] mt-0.5">
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
              className="shrink-0 text-[13px] font-medium px-3 py-1.5 rounded-md border border-[#E2E5EA] dark:border-[#243049] bg-white dark:bg-[#101626] hover:bg-[#F0F2F5] dark:hover:bg-[#161E32] transition-colors"
            >
              Choose file
            </button>
            <button
              onClick={uploadFile}
              disabled={!file || uploadState === "uploading"}
              className="shrink-0 text-[13px] font-medium px-3 py-1.5 rounded-md bg-[#1E3A8A] dark:bg-[#3B5BA9] text-white hover:bg-[#16306F] dark:hover:bg-[#4A6BC0] disabled:bg-[#D5DAE2] dark:disabled:bg-[#243049] disabled:text-[#94A0B3] disabled:cursor-not-allowed transition-colors"
            >
              {uploadState === "uploading" ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>

        {/* Chat thread — marginalia rail signature element */}
        <div className="thread flex-1 overflow-y-auto rounded-lg border border-[#E2E5EA] dark:border-[#243049] bg-white dark:bg-[#101626] px-5 py-5 min-h-[340px] max-h-[480px] transition-colors">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-16">
              <p className="font-display italic text-[18px] text-[#1E3A8A] dark:text-[#9DBBF5] mb-1.5">
                Nothing asked yet
              </p>
              <p className="text-[13px] text-[#5B6576] dark:text-[#8A95AC] max-w-[280px]">
                Upload a document above, then ask a question to get an answer grounded in its contents.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((msg, i) => (
                <div key={i} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  {msg.role === "user" ? (
                    <div className="max-w-[85%] flex flex-col gap-1 items-end">
                      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-[#94A0B3] dark:text-[#5C6B8A] px-1">
                        You
                      </span>
                      <div className="rounded-xl rounded-tr-sm px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap bg-[#1E3A8A] dark:bg-[#3B5BA9] text-white">
                        {msg.text}
                      </div>
                    </div>
                  ) : (
                    // Marginalia rail: a thin ink-blue rule stands in the margin beside
                    // each AI answer, like a pen mark next to an annotated passage.
                    <div className="max-w-[85%] flex flex-col gap-1 items-start w-full">
                      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-[#94A0B3] dark:text-[#5C6B8A] px-1">
                        Intellexar
                      </span>
                      <div className="flex gap-3 w-full">
                        <span
                          className="shrink-0 w-[3px] rounded-full bg-[#BFD3FB] dark:bg-[#2A3D6B] mt-0.5 mb-0.5"
                          aria-hidden
                        />
                        <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-[#1A2230] dark:text-[#E6EAF2] py-0.5">
                          {msg.text}
                          {msg.text === "" && isAsking && i === messages.length - 1 && (
                            <span className="inline-flex gap-1 items-center">
                              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#2563EB] inline-block" style={{ animationDelay: "0ms" }} />
                              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#2563EB] inline-block" style={{ animationDelay: "150ms" }} />
                              <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#2563EB] inline-block" style={{ animationDelay: "300ms" }} />
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
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
            className="flex-1 text-[14px] rounded-lg border border-[#E2E5EA] dark:border-[#243049] bg-white dark:bg-[#101626] px-4 py-3 outline-none focus:border-[#2563EB] dark:focus:border-[#7DA8F2] focus:ring-2 focus:ring-[#2563EB]/15 dark:focus:ring-[#7DA8F2]/20 transition-shadow placeholder:text-[#A7AEBB] dark:placeholder:text-[#465272]"
          />
          <button
            onClick={askQuestion}
            disabled={!question.trim() || isAsking}
            className="shrink-0 text-[14px] font-medium px-5 py-3 rounded-lg bg-[#1E3A8A] dark:bg-[#3B5BA9] text-white hover:bg-[#16306F] dark:hover:bg-[#4A6BC0] disabled:bg-[#D5DAE2] dark:disabled:bg-[#243049] disabled:text-[#94A0B3] disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
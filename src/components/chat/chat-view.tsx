"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, ListTree, LoaderCircle, MapPin, Square, Volume2 } from "lucide-react";
import { CROPS } from "@config/crops";
import type { LanguageId } from "@config/languages";
import type { AgentEvent, TraceStep } from "@/core/agent/types";
import type { GuardrailReport } from "@/core/guardrails/grounding";
import { daysBetween, istDateKey } from "@/core/lib/format";
import type { FarmerContext } from "@/core/profile/types";
import type { Citation } from "@/core/tools/types";
import { speak, stopSpeaking } from "@/lib/speech-client";
import { postEventStream } from "@/lib/sse-client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useApp } from "../app-context";
import { TracePanel, type TurnMeta } from "../trace/trace-panel";
import { AnswerText } from "./answer-text";
import { Composer } from "./composer";
import { SourceChips } from "./source-chips";

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      status: "streaming" | "done" | "error";
      citations: Citation[];
      guardrail?: GuardrailReport;
      language: LanguageId;
      translation?: { text: string; language: LanguageId; visible: boolean };
    };

const CONVERSATION_KEY = "khetmitra.conversationId";

function useFarmerProfile(farmerId: string | null) {
  const [farmer, setFarmer] = useState<FarmerContext | null>(null);
  useEffect(() => {
    if (!farmerId) return;
    let cancelled = false;
    fetch(`/api/profile?id=${encodeURIComponent(farmerId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ profile: FarmerContext }>) : null))
      .then((data) => {
        if (!cancelled) setFarmer(data?.profile ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [farmerId]);
  return farmerId ? farmer : null;
}

export function ChatView() {
  const { t, language, farmerId } = useApp();
  const farmer = useFarmerProfile(farmerId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [meta, setMeta] = useState<TurnMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      conversationId.current = window.sessionStorage.getItem(CONVERSATION_KEY);
    } catch {
      conversationId.current = null;
    }
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const updateAssistant = useCallback(
    (
      id: string,
      patch: (
        m: Extract<ChatMessage, { role: "assistant" }>,
      ) => Partial<Extract<ChatMessage, { role: "assistant" }>>,
    ) => {
      setMessages((all) =>
        all.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...patch(m) } : m)),
      );
    },
    [],
  );

  const playAnswer = useCallback(async (id: string, text: string, lang: LanguageId) => {
    setSpeakingId(id);
    const used = await speak(text, lang, () =>
      setSpeakingId((cur) => (cur === id ? null : cur)),
    ).catch(() => "none" as const);
    if (used === "none") setSpeakingId(null);
  }, []);

  const send = useCallback(
    async (question: string, fromVoice: boolean) => {
      if (busy) return;
      const turnLanguage = language;
      const assistantId = crypto.randomUUID();
      setMessages((all) => [
        ...all,
        { id: crypto.randomUUID(), role: "user", text: question },
        {
          id: assistantId,
          role: "assistant",
          text: "",
          status: "streaming",
          citations: [],
          language: turnLanguage,
        },
      ]);
      setSteps([]);
      setMeta(null);
      setBusy(true);
      const abort = new AbortController();
      abortRef.current = abort;
      let finalText: string | null = null;

      try {
        await postEventStream<AgentEvent>(
          "/api/chat",
          {
            message: question,
            language: turnLanguage,
            conversationId: conversationId.current ?? undefined,
            farmerId: farmerId ?? undefined,
          },
          (event) => {
            switch (event.type) {
              case "turn_start":
                setMeta({
                  turnId: event.turnId,
                  model: event.model,
                  promptVersion: event.promptVersion,
                });
                if (event.conversationId) {
                  conversationId.current = event.conversationId;
                  try {
                    window.sessionStorage.setItem(CONVERSATION_KEY, event.conversationId);
                  } catch {
                    // storage unavailable: conversation continues only for this page view
                  }
                }
                break;
              case "step":
                setSteps((s) => [...s, event.step]);
                break;
              case "text_delta":
                updateAssistant(assistantId, (m) => ({ text: m.text + event.text }));
                break;
              case "text_reset":
                updateAssistant(assistantId, () => ({ text: "" }));
                break;
              case "final":
                finalText = event.answer;
                updateAssistant(assistantId, () => ({
                  text: event.answer,
                  status: "done",
                  citations: event.citations,
                  guardrail: event.guardrail,
                }));
                break;
              case "error":
                updateAssistant(assistantId, () => ({ text: event.message, status: "error" }));
                break;
            }
          },
          abort.signal,
        );
      } catch {
        if (!abort.signal.aborted) {
          updateAssistant(assistantId, () => ({ text: t.networkError, status: "error" }));
        }
      } finally {
        setBusy(false);
        updateAssistant(assistantId, (m) =>
          m.status === "streaming"
            ? { status: m.text ? "done" : "error", text: m.text || t.networkError }
            : {},
        );
      }
      // Asked by voice → answer by voice, so the farmer doesn't have to read.
      if (fromVoice && finalText) void playAnswer(assistantId, finalText, turnLanguage);
    },
    [busy, language, farmerId, t, updateAssistant, playAnswer],
  );

  const toggleTranslation = async (m: Extract<ChatMessage, { role: "assistant" }>) => {
    if (m.translation) {
      updateAssistant(m.id, (x) => ({
        translation: x.translation && { ...x.translation, visible: !x.translation.visible },
      }));
      return;
    }
    const to: LanguageId = m.language === "hi" ? "en" : "hi";
    const res = await fetch("/api/speech/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: m.text, from: m.language, to }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { text: string }) : null;
    updateAssistant(m.id, () => ({
      translation: { text: data?.text ?? t.networkError, language: to, visible: true },
    }));
  };

  const onCite = (id: string) => {
    setHighlight(id);
    document.getElementById(`cite-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const today = istDateKey();
  const trace = <TracePanel steps={steps} meta={meta} busy={busy} />;

  return (
    <div className="flex flex-1 gap-6 pt-4">
      <div className="flex min-w-0 flex-1 flex-col">
        {farmer && (
          <p className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            {farmer.locationName}
            {farmer.district ? `, ${farmer.district}` : ""} ·{" "}
            {farmer.crops
              .map(
                (c) => `${CROPS[c.crop].names[language]} (${daysBetween(c.sowingDate, today)} d)`,
              )
              .join(", ")}
          </p>
        )}

        <div className="flex-1 space-y-4 pb-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="py-6">
              <h1 className="text-2xl font-semibold">KhetMitra</h1>
              <p className="mt-1 text-muted-foreground">{t.tagline}</p>
              {!farmerId && (
                <p className="mt-4 rounded-lg border border-dashed p-3 text-sm">
                  {t.noProfileHint}{" "}
                  <Link href="/profile" className="font-medium text-primary underline">
                    {t.addProfile}
                  </Link>
                </p>
              )}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {t.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s, false)}
                    className="rounded-xl border bg-card p-3 text-left text-sm hover:border-primary hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-primary-foreground">
                  {m.text}
                </p>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start">
                <div
                  className={
                    m.status === "error"
                      ? "max-w-[92%] rounded-2xl rounded-bl-sm border border-red-300 bg-red-50 px-4 py-3 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
                      : "max-w-[92%] rounded-2xl rounded-bl-sm border bg-card px-4 py-3"
                  }
                >
                  {m.text ? (
                    <AnswerText text={m.text} onCite={onCite} />
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      {steps.at(-1)?.summary ?? t.thinking}
                    </p>
                  )}
                  {m.translation?.visible && (
                    <div className="mt-3 rounded-lg bg-muted p-2 text-sm">
                      <AnswerText text={m.translation.text} onCite={onCite} />
                    </div>
                  )}
                  {m.status === "done" && (
                    <>
                      <SourceChips
                        citations={m.citations}
                        highlighted={highlight}
                        language={m.language}
                      />
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (speakingId === m.id) {
                              stopSpeaking();
                              setSpeakingId(null);
                            } else void playAnswer(m.id, m.text, m.language);
                          }}
                        >
                          {speakingId === m.id ? (
                            <Square className="size-4" />
                          ) : (
                            <Volume2 className="size-4" />
                          )}
                          {speakingId === m.id ? t.stop : t.listen}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggleTranslation(m)}>
                          <Languages className="size-4" />
                          {m.language === "hi" ? "View in English" : "हिन्दी में देखें"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-16 z-10 bg-background pb-2 md:bottom-0">
          <div className="mb-2 lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <ListTree className="size-4" />
                  {t.traceOpen}
                  {steps.length > 0 ? ` (${steps.length})` : ""}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[75dvh] overflow-y-auto p-4">
                <SheetHeader className="p-0">
                  <SheetTitle>{t.traceTitle}</SheetTitle>
                </SheetHeader>
                {trace}
              </SheetContent>
            </Sheet>
          </div>
          <Composer disabled={busy} onSend={(text, fromVoice) => void send(text, fromVoice)} />
        </div>
      </div>

      <aside className="sticky top-20 hidden h-[calc(100dvh-6rem)] w-96 shrink-0 overflow-y-auto rounded-xl border bg-muted/30 p-3 lg:block">
        {trace}
      </aside>
    </div>
  );
}

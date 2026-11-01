"use client";

import { useCallback, useState } from "react";
import { LoaderCircle, Mic, SendHorizontal, Square } from "lucide-react";
import type { SpeechFailure } from "@/lib/speech-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useApp } from "../app-context";
import { useVoiceInput } from "./use-voice-input";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string, fromVoice: boolean) => void;
}) {
  const { t, language, health } = useApp();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const onVoiceText = useCallback(
    (spoken: string) => {
      setNotice(null);
      // Voice-first: send straight away; the transcript appears as the user's message.
      onSend(spoken, true);
    },
    [onSend],
  );
  const onVoiceError = useCallback(
    (reason: SpeechFailure | "switched-to-browser") => {
      const messages: Record<typeof reason, string> = {
        "mic-denied": t.micDenied,
        "mic-unavailable": t.micUnavailable,
        "no-speech": t.noSpeech,
        unsupported: t.voiceUnsupported,
        "server-failed": t.voiceServerFailed,
        "switched-to-browser": t.voiceServerFailed,
      };
      setNotice(messages[reason]);
    },
    [t],
  );

  const voice = useVoiceInput({
    language,
    serverAvailable: health?.checks.sarvam?.ok ?? false,
    onText: onVoiceText,
    onError: onVoiceError,
  });

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value, false);
    setText("");
  };

  return (
    <div className="border-t bg-background pt-3">
      {(notice || voice.state !== "idle") && (
        <p className="mb-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          {voice.state === "recording"
            ? t.listening
            : voice.state === "transcribing"
              ? t.transcribing
              : notice}
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Button
          type="button"
          size="icon-lg"
          variant={voice.state === "recording" ? "destructive" : "default"}
          className={cn(
            "size-12 shrink-0 rounded-full",
            voice.state === "recording" && "animate-pulse",
          )}
          onClick={() => void voice.toggle()}
          disabled={disabled || voice.state === "transcribing"}
          aria-label={voice.state === "recording" ? t.micStop : t.micStart}
          title={voice.supported ? t.micStart : t.voiceUnsupported}
        >
          {voice.state === "transcribing" ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : voice.state === "recording" ? (
            <Square className="size-5" />
          ) : (
            <Mic className="size-5" />
          )}
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t.placeholder}
          rows={1}
          maxLength={1000}
          className="min-h-12 resize-none text-base"
          aria-label={t.placeholder}
        />
        <Button
          type="submit"
          size="icon-lg"
          className="size-12 shrink-0"
          disabled={disabled || !text.trim()}
          aria-label={t.send}
        >
          <SendHorizontal className="size-5" />
        </Button>
      </form>
    </div>
  );
}

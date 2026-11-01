/**
 * Probe: Sarvam AI translate, text-to-speech and speech-to-text.
 * STT is tested with the audio TTS just produced (a real round trip, no stored audio).
 */
import { assert, http, probe, requireKey, runIfMain, type ProbeResult } from "./_probe";

const BASE = "https://api.sarvam.ai";

export async function probeSarvam(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  results.push(
    await probe("Sarvam translate (sarvam-translate:v1, en→hi)", async () => {
      const key = requireKey("SARVAM_API_KEY");
      const r = await http(`${BASE}/translate`, {
        method: "POST",
        headers: { "api-subscription-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          input: "Heavy rain is expected tomorrow [S1]. Postpone fertiliser application.",
          source_language_code: "en-IN",
          target_language_code: "hi-IN",
          model: "sarvam-translate:v1",
          mode: "formal",
        }),
      });
      assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
      const translated = (r.json as { translated_text?: string }).translated_text ?? "";
      assert(translated.includes("[S1]"), `citation marker lost: ${translated}`);
      return `${r.ms} ms; ${translated}`;
    }),
  );

  let wavBase64: string | undefined;
  results.push(
    await probe("Sarvam text-to-speech (bulbul:v3, hi-IN)", async () => {
      const key = requireKey("SARVAM_API_KEY");
      const r = await http(`${BASE}/text-to-speech`, {
        method: "POST",
        headers: { "api-subscription-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text: "कल भारी बारिश की संभावना है, खाद डालना टाल दें।",
          language_code: "hi-IN",
          model: "bulbul:v3",
          speaker: "priya",
          output_audio_codec: "wav",
          speech_sample_rate: 16000,
        }),
      });
      assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
      const audios = (r.json as { audios?: string[] }).audios ?? [];
      assert(audios.length > 0, "no audios in response");
      wavBase64 = audios.join("");
      return `${r.ms} ms; ${audios.length} clip(s), ${Math.round((wavBase64.length * 3) / 4 / 1024)} KB wav`;
    }),
  );

  results.push(
    await probe("Sarvam speech-to-text (saaras:v4, round trip)", async () => {
      const key = requireKey("SARVAM_API_KEY");
      assert(wavBase64, "needs the TTS probe to succeed first");
      const form = new FormData();
      form.append(
        "file",
        new Blob([Buffer.from(wavBase64, "base64")], { type: "audio/wav" }),
        "probe.wav",
      );
      form.append("model", "saaras:v4");
      form.append("language_code", "hi-IN");
      const r = await http(`${BASE}/speech-to-text`, {
        method: "POST",
        headers: { "api-subscription-key": key },
        body: form,
      });
      assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
      return `${r.ms} ms; ${r.text.slice(0, 240)}`;
    }),
  );
  return results;
}

runIfMain(import.meta.url, probeSarvam);

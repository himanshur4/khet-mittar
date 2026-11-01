# External API verification (1 Nov 2026)

Every client in `src/core/tools` and `src/core/speech` was written against these observed
responses. Re-run with `npm run probe` after adding keys to `.env`.

| Service | How verified | Result |
|---|---|---|
| Open-Meteo geocoding | Real call (`name=Nashik`) | 200, fields `name, latitude, longitude, admin1 (state), admin2 (district), admin3, population, timezone`. Devanagari queries return 0 results, so the agent must transliterate place names to Latin script. |
| Open-Meteo forecast | Real call (7 days, daily + hourly) | 200 in under 1 s. Daily `weather_code, temperature_2m_max/min, precipitation_sum, precipitation_probability_max, wind_speed_10m_max, wind_gusts_10m_max, et0_fao_evapotranspiration`, timezone `Asia/Kolkata`. |
| ISRIC SoilGrids v2.0 | Real call | **503 Service Temporarily Unavailable** (the service is documented as beta with occasional downtime, fair use 5 calls/min). The soil tool therefore caches per ~1 km cell for 30 days and always includes the farmer's own Soil Health Card values. |
| data.gov.in mandi (resource `9ef84268-d588-465a-a308-a864a43d0070`) | Real calls | Endpoint is live: 400 "Key not authorised" without a key, 403 with an invalid key, 429 with the shared public sample key (exhausted). **Record shape needs your own key:** run `npm run probe`. Fields per data.gov.in docs: `state, district, market, commodity, variety, grade, arrival_date, min_price, max_price, modal_price` (Rs/quintal). |
| data.gov.in historical (resource `35985678-0d79-46b4-9ed6-6f13308a1d24`) | Same | Same status. Used best-effort for the price trend; KhetMitra also keeps its own history of every real price row it fetches. |
| Sarvam STT | Official API reference | `POST https://api.sarvam.ai/speech-to-text`, header `api-subscription-key`, multipart `file` (WAV/MP3/OGG/WebM…, ≤30 s), `model=saaras:v4`, `language_code` (`hi-IN`, `en-IN`, `unknown`), optional `keyterms`. Response `{ request_id, transcript, language_code }`. |
| Sarvam TTS | Official API reference | `POST /text-to-speech` JSON `{ text (≤2500 chars), language_code, model: "bulbul:v3", speaker (lowercase, e.g. "priya"), output_audio_codec, speech_sample_rate }`. Response `{ request_id, audios: [base64] }`. |
| Sarvam translate | Official guide | `POST /translate` JSON `{ input, source_language_code ("auto" ok), target_language_code, model: "mayura:v1" (≤1000 chars) }`. Response field `translated_text`. |
| Gemini | Google model catalogue + installed `@ai-sdk/google` 4.0.109 | Stable: `gemini-3.8-flash` (primary), `gemini-3.5-flash-lite` (fallback). Embeddings: `gemini-embedding-2`, 3072 dims by default, `outputDimensionality: 768` auto-normalised, 8192-token input, uses task prefixes instead of `taskType`. |
| OpenAI | OpenAI model docs + installed `@ai-sdk/openai` 4.0.106 | `gpt-6.1-terra` (fast), `gpt-6-luna` (efficient), both support function calling. Embeddings `text-embedding-3-small` with `dimensions: 768`. |
| Advisory PDFs (11) | Real download + `unpdf` text extraction | All reachable with extractable text: IMD national agromet bulletin (23 pages, current week), ICAR-DWR wheat guide (41), PAU Rabi (184), PAU Kharif (208), PAU Vegetables (208), NIPHM IPM packages for wheat (83), rice (53), onion (60), tomato (94), potato (76) and mustard (59). Dropped: IMD state bulletins (served as 0-byte PDFs), Vikaspedia (client-rendered), DOGR and TNAU (TLS errors). |

## Thresholds used by the alert rules (official definitions)

- IMD 24-hour rainfall classes: moderate 15.6–64.4 mm, heavy 64.5–115.5 mm, very heavy 115.6–204.4 mm, extremely heavy ≥ 204.5 mm ([IMD RSMC New Delhi](https://rsmcnewdelhi.imd.gov.in/uploads/archive/8/8_051ce4_hrainfall.pdf)).
- IMD heat wave (plains): maximum temperature ≥ 40 °C baseline; ≥ 45 °C regardless of departure from normal.
- IMD cold wave (plains, by actual value): minimum temperature ≤ 4 °C.
- Strong wind: gusts ≥ 39 km/h (Beaufort force 6 "strong breeze", WMO), the point at which spraying drifts and lodging risk rises.

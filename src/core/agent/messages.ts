import type { LanguageId } from "@config/languages";

/** Fixed, farmer-facing fallback replies (used when the model can't produce an answer). */
export const AGENT_MESSAGES: Record<"incomplete" | "llmUnavailable", Record<LanguageId, string>> = {
  incomplete: {
    en: "I could not finish gathering the information for this question. Please try again, or contact your local Krishi Vigyan Kendra or the Kisan Call Centre (1800-180-1551).",
    hi: "इस सवाल की पूरी जानकारी इकट्ठा नहीं हो सकी। कृपया फिर से पूछें, या अपने नज़दीकी कृषि विज्ञान केंद्र या किसान कॉल सेंटर (1800-180-1551) से संपर्क करें।",
  },
  llmUnavailable: {
    en: "The advisory service is not available right now. Please try again in a minute, or call the Kisan Call Centre (1800-180-1551).",
    hi: "सलाह सेवा अभी उपलब्ध नहीं है। कृपया एक मिनट बाद फिर कोशिश करें, या किसान कॉल सेंटर (1800-180-1551) पर कॉल करें।",
  },
};

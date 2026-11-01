/**
 * Fallback alert text used when the LLM is unavailable. Only the forecast numbers vary, and
 * they come from the real forecast; the actions are standard weather-based precautions.
 */
import { CROPS, type CropId } from "@config/crops";
import type { LanguageId } from "@config/languages";
import type { RiskEvent, RiskKind } from "./rules";

const TITLES: Record<RiskKind, Record<LanguageId, string>> = {
  heavy_rain: { en: "Heavy rain expected", hi: "भारी बारिश की संभावना" },
  rain_before_inputs: {
    en: "Rain expected: hold fertiliser and sprays",
    hi: "बारिश की संभावना: खाद और छिड़काव रोकें",
  },
  heat_stress: { en: "High temperature expected", hi: "तेज़ गर्मी की संभावना" },
  cold_stress: { en: "Cold night expected", hi: "ठंडी रात की संभावना" },
  strong_wind: { en: "Strong winds expected", hi: "तेज़ हवा की संभावना" },
};

const ACTIONS: Record<RiskKind, Record<LanguageId, string>> = {
  heavy_rain: {
    en: "Clear field drainage channels, postpone fertiliser and pesticide application, and keep harvested produce under cover.",
    hi: "खेत की नालियां साफ़ रखें, खाद और कीटनाशक का छिड़काव टाल दें, और कटी हुई उपज को ढककर रखें।",
  },
  rain_before_inputs: {
    en: "Postpone fertiliser top-dressing, pesticide sprays and irrigation until the rain passes, so they are not washed away.",
    hi: "बारिश निकल जाने तक खाद, कीटनाशक छिड़काव और सिंचाई टाल दें, ताकि वे बह न जाएं।",
  },
  heat_stress: {
    en: "Irrigate lightly in the evening or early morning and avoid spraying in the afternoon heat.",
    hi: "शाम या सुबह जल्दी हल्की सिंचाई करें और दोपहर की गर्मी में छिड़काव न करें।",
  },
  cold_stress: {
    en: "Give a light irrigation in the evening to protect against frost, and watch young plants closely.",
    hi: "पाले से बचाव के लिए शाम को हल्की सिंचाई करें और छोटे पौधों पर नज़र रखें।",
  },
  strong_wind: {
    en: "Avoid spraying (drift), and support tall crops or stakes where needed.",
    hi: "छिड़काव न करें (दवा उड़ जाएगी), और ज़रूरत हो तो लंबी फसल को सहारा दें।",
  },
};

export function alertTitle(kind: RiskKind, crop: CropId, language: LanguageId): string {
  return `${TITLES[kind][language]} · ${CROPS[crop].names[language]}`;
}

export function templateAlertMessage(
  risk: RiskEvent,
  crop: CropId,
  language: LanguageId,
  citationId: string,
): string {
  const m = risk.metric;
  const facts =
    language === "hi"
      ? `${risk.date} को ${m.name === "rainfall" ? "बारिश" : m.name === "wind gusts" ? "हवा के झोंके" : "तापमान"} ${m.value} ${m.unit} का पूर्वानुमान है [${citationId}].`
      : `Forecast for ${risk.date}: ${m.name} ${m.value} ${m.unit} [${citationId}].`;
  return `${facts} ${ACTIONS[risk.kind][language]}`;
}

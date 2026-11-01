/**
 * Crops KhetMitra supports end to end (advisory documents ingested, mandi names mapped).
 * These are identifiers and display names only; every number the app shows comes from a
 * live source.
 */
export const CROP_IDS = ["wheat", "rice", "onion", "tomato", "potato", "mustard"] as const;
export type CropId = (typeof CROP_IDS)[number];

export interface CropInfo {
  id: CropId;
  names: { en: string; hi: string };
  /**
   * Commodity names as spelled in Agmarknet / data.gov.in, tried in order.
   * Agmarknet uses its own spellings (e.g. paddy is "Paddy(Dhan)(Common)").
   */
  agmarknetNames: string[];
  season: "rabi" | "kharif" | "rabi/kharif";
}

export const CROPS: Record<CropId, CropInfo> = {
  wheat: {
    id: "wheat",
    names: { en: "Wheat", hi: "गेहूं" },
    agmarknetNames: ["Wheat"],
    season: "rabi",
  },
  rice: {
    id: "rice",
    names: { en: "Rice (paddy)", hi: "धान" },
    agmarknetNames: ["Paddy(Dhan)(Common)", "Paddy(Common)", "Rice"],
    season: "kharif",
  },
  onion: {
    id: "onion",
    names: { en: "Onion", hi: "प्याज" },
    agmarknetNames: ["Onion"],
    season: "rabi/kharif",
  },
  tomato: {
    id: "tomato",
    names: { en: "Tomato", hi: "टमाटर" },
    agmarknetNames: ["Tomato"],
    season: "rabi/kharif",
  },
  potato: {
    id: "potato",
    names: { en: "Potato", hi: "आलू" },
    agmarknetNames: ["Potato"],
    season: "rabi",
  },
  mustard: {
    id: "mustard",
    names: { en: "Mustard", hi: "सरसों" },
    agmarknetNames: ["Mustard"],
    season: "rabi",
  },
};

export function isCropId(value: string): value is CropId {
  return (CROP_IDS as readonly string[]).includes(value);
}

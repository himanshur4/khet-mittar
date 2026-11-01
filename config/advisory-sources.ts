/**
 * Official advisory documents for retrieval (RAG). This file holds URLs and metadata only;
 * `npm run ingest` fetches the live documents, so nothing here is advisory content.
 *
 * Every URL was checked with a real request on 1 Nov 2026 (see scripts/probe/advisories.ts).
 */
import type { CropId } from "./crops";

export interface AdvisorySource {
  /** Stable key; re-ingesting the same id replaces that document's chunks. */
  id: string;
  title: string;
  publisher: string;
  url: string;
  format: "pdf" | "html";
  crops: CropId[] | "all";
  /** Geography the recommendations were written for, shown in citations. */
  region: string;
  language: "en" | "hi";
  /** "weekly" sources are re-fetched on every ingest; unchanged content is skipped by hash. */
  refresh: "static" | "weekly";
  /**
   * For large multi-crop books: only these PDF page ranges (1-based, inclusive) are ingested,
   * each tagged with its crop. Page numbers are PDF pages, not printed page numbers.
   */
  sections?: AdvisorySection[];
}

export interface AdvisorySection {
  label: string;
  pages: [from: number, to: number];
  crops: CropId[];
}

export const ADVISORY_SOURCES: AdvisorySource[] = [
  {
    id: "imd-national-agromet-current",
    title: "National Agromet Advisory Bulletin (current)",
    publisher: "India Meteorological Department (IMD), Agromet Advisory Services",
    url: "https://mausam.imd.gov.in/imd_latest/contents/agromet/agromet-data/national/current/current-pdf/national_current.pdf",
    format: "pdf",
    crops: "all",
    region: "India",
    language: "en",
    refresh: "weekly",
  },
  {
    id: "icar-dwr-wheat-cultivation",
    title: "Wheat Cultivation in India: Pocket Guide (Extension Bulletin 52)",
    publisher: "ICAR – Directorate of Wheat Research, Karnal (via NITI for States)",
    url: "https://www.nitiforstates.gov.in/public-assets/Best_Practices/compendiums_all/WheatCultivationinIndiaPDF.pdf",
    format: "pdf",
    crops: ["wheat"],
    region: "India",
    language: "en",
    refresh: "static",
  },
  {
    id: "pau-pop-rabi",
    title: "Package of Practices for Crops of Punjab: Rabi",
    publisher: "Punjab Agricultural University, Ludhiana",
    url: "https://www.pau.edu/content/ccil/pf/pp_rabi.pdf",
    format: "pdf",
    crops: ["wheat", "mustard"],
    region: "Punjab",
    language: "en",
    refresh: "static",
    sections: [
      { label: "Wheat", pages: [9, 30], crops: ["wheat"] },
      { label: "Rapeseed and Mustard", pages: [55, 65], crops: ["mustard"] },
      { label: "Additional guidelines for wheat", pages: [179, 184], crops: ["wheat"] },
    ],
  },
  {
    id: "pau-pop-kharif",
    title: "Package of Practices for Crops of Punjab: Kharif",
    publisher: "Punjab Agricultural University, Ludhiana",
    url: "https://www.pau.edu/content/ccil/pf/pp_kharif.pdf",
    format: "pdf",
    crops: ["rice"],
    region: "Punjab",
    language: "en",
    refresh: "static",
    sections: [
      { label: "Rice, Basmati rice and Direct Seeded Rice", pages: [9, 35], crops: ["rice"] },
    ],
  },
  {
    id: "pau-pop-vegetables",
    title: "Package of Practices for Cultivation of Vegetables",
    publisher: "Punjab Agricultural University, Ludhiana",
    url: "https://www.pau.edu/content/ccil/pf/pp_veg.pdf",
    format: "pdf",
    crops: ["onion", "tomato", "potato"],
    region: "Punjab",
    language: "en",
    refresh: "static",
    sections: [
      { label: "Tomato", pages: [41, 49], crops: ["tomato"] },
      { label: "Onion", pages: [76, 82], crops: ["onion"] },
      { label: "Potato", pages: [115, 125], crops: ["potato"] },
    ],
  },
  ...(
    [
      ["wheat", "Wheat"],
      ["rice", "Rice"],
      ["onion", "Onion"],
      ["tomato", "Tomato"],
      ["potato", "Potato"],
      ["mustard", "Mustard"],
    ] as const
  ).map(([crop, name]): AdvisorySource => ({
    id: `niphm-ipm-${crop}`,
    title: `Integrated Pest Management Package for ${name}`,
    publisher:
      "National Institute of Plant Health Management (NIPHM), Dept. of Agriculture & Farmers Welfare, Govt. of India",
    url: `https://www.niphm.gov.in/IPMPackages/${name}.pdf`,
    format: "pdf",
    crops: [crop],
    region: "India",
    language: "en",
    refresh: "static",
  })),
];

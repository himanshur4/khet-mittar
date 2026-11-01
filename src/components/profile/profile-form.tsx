"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, MapPin, Plus, Search, Trash2 } from "lucide-react";
import { CROP_IDS, CROPS, type CropId } from "@config/crops";
import { LANGUAGES, LANGUAGE_IDS, type LanguageId } from "@config/languages";
import { istDateKey } from "@/core/lib/format";
import type { FarmerContext, SoilHealthCard } from "@/core/profile/types";
import type { Place } from "@/core/tools/geocode/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "../app-context";

interface CropRow {
  crop: CropId;
  sowingDate: string;
  areaAcres: string;
}

const SOIL_FIELDS: Array<{ key: Exclude<keyof SoilHealthCard, "testedOn">; label: string }> = [
  { key: "ph", label: "pH" },
  { key: "ec", label: "EC (dS/m)" },
  { key: "organicCarbon", label: "Organic carbon (%)" },
  { key: "nitrogen", label: "N (kg/ha)" },
  { key: "phosphorus", label: "P (kg/ha)" },
  { key: "potassium", label: "K (kg/ha)" },
  { key: "sulphur", label: "S (ppm)" },
  { key: "zinc", label: "Zn (ppm)" },
  { key: "iron", label: "Fe (ppm)" },
  { key: "boron", label: "B (ppm)" },
];

export function ProfileForm() {
  const { t, farmerId, setFarmerId, language: uiLanguage } = useApp();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<LanguageId>(uiLanguage);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [crops, setCrops] = useState<CropRow[]>([{ crop: "wheat", sowingDate: "", areaAcres: "" }]);
  const [soil, setSoil] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!farmerId) return;
    fetch(`/api/profile?id=${encodeURIComponent(farmerId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ profile: FarmerContext }>) : null))
      .then((data) => {
        const p = data?.profile;
        if (!p) return;
        setName(p.name ?? "");
        setLanguage(p.language);
        setPlace({
          name: p.locationName,
          district: p.district,
          state: p.state,
          latitude: p.latitude,
          longitude: p.longitude,
          population: null,
        });
        setCrops(
          p.crops.map((c) => ({
            crop: c.crop,
            sowingDate: c.sowingDate,
            areaAcres: c.areaAcres ? String(c.areaAcres) : "",
          })),
        );
        if (p.soilCard) {
          setSoil(Object.fromEntries(Object.entries(p.soilCard).map(([k, v]) => [k, String(v)])));
        }
      })
      .catch(() => undefined);
  }, [farmerId]);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      const data = (await res.json()) as { places?: Place[] };
      setPlaces(data.places ?? []);
    } catch {
      setPlaces([]);
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    setStatus(null);
    if (!place) {
      setStatus({ kind: "error", text: t.searchPlace });
      return;
    }
    const soilCard: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(soil)) {
      if (v.trim() === "") continue;
      soilCard[k] = k === "testedOn" ? v : Number(v);
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: farmerId ?? undefined,
          name: name.trim() || undefined,
          language,
          locationName: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          state: place.state ?? undefined,
          district: place.district ?? undefined,
          crops: crops
            .filter((c) => c.sowingDate)
            .map((c) => ({
              crop: c.crop,
              sowingDate: c.sowingDate,
              ...(c.areaAcres ? { areaAcres: Number(c.areaAcres) } : {}),
            })),
          ...(Object.keys(soilCard).length > 0 ? { soilCard } : {}),
        }),
      });
      const body = (await res.json()) as {
        profile?: FarmerContext;
        error?: { message: string; issues?: string[] };
      };
      if (!res.ok || !body.profile) {
        setStatus({
          kind: "error",
          text:
            [body.error?.message, ...(body.error?.issues ?? [])].filter(Boolean).join(" · ") ||
            t.networkError,
        });
        return;
      }
      setFarmerId(body.profile.id);
      setStatus({ kind: "ok", text: t.saved });
    } catch {
      setStatus({ kind: "error", text: t.networkError });
    } finally {
      setSaving(false);
    }
  };

  const today = istDateKey();

  return (
    <form
      className="mx-auto w-full max-w-2xl space-y-6 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1 className="text-xl font-semibold">{t.profileTitle}</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t.name}</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label>{t.language}</Label>
          <Select value={language} onValueChange={(v) => setLanguage(v as LanguageId)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {LANGUAGES[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <Label htmlFor="place">{t.location}</Label>
        {place && (
          <p className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
            <MapPin className="size-4" aria-hidden />
            {place.name}
            {place.district ? `, ${place.district}` : ""}
            {place.state ? `, ${place.state}` : ""}
            <span className="text-xs opacity-70">
              ({place.latitude.toFixed(3)}, {place.longitude.toFixed(3)})
            </span>
          </p>
        )}
        <div className="flex gap-2">
          <Input
            id="place"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="e.g. Lasalgaon, Karnal, Ludhiana"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void search()}
            disabled={searching}
          >
            {searching ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            {searching ? t.searching : t.searchPlace}
          </Button>
        </div>
        {places && places.length === 0 && (
          <p className="text-sm text-muted-foreground">{t.noPlaces}</p>
        )}
        {places && places.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {places.map((p) => (
              <li key={`${p.latitude},${p.longitude}`}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setPlace(p);
                    setPlaces(null);
                  }}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">
                    {p.district ? `, ${p.district}` : ""}
                    {p.state ? `, ${p.state}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t.crops}</legend>
        {crops.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end"
          >
            <div className="space-y-1.5">
              <Label>{t.crop}</Label>
              <Select
                value={row.crop}
                onValueChange={(v) =>
                  setCrops((all) => all.map((c, j) => (j === i ? { ...c, crop: v as CropId } : c)))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CROP_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {CROPS[id].names[uiLanguage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`sow-${i}`}>{t.sowingDate}</Label>
              <Input
                id={`sow-${i}`}
                type="date"
                max={today}
                required
                value={row.sowingDate}
                onChange={(e) =>
                  setCrops((all) =>
                    all.map((c, j) => (j === i ? { ...c, sowingDate: e.target.value } : c)),
                  )
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`area-${i}`}>{t.area}</Label>
              <Input
                id={`area-${i}`}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={row.areaAcres}
                onChange={(e) =>
                  setCrops((all) =>
                    all.map((c, j) => (j === i ? { ...c, areaAcres: e.target.value } : c)),
                  )
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={crops.length === 1}
              onClick={() => setCrops((all) => all.filter((_, j) => j !== i))}
              aria-label={t.remove}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {crops.length < CROP_IDS.length && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setCrops((all) => [
                ...all,
                {
                  crop: CROP_IDS.find((id) => !all.some((c) => c.crop === id)) ?? "wheat",
                  sowingDate: "",
                  areaAcres: "",
                },
              ])
            }
          >
            <Plus className="size-4" /> {t.addCrop}
          </Button>
        )}
      </fieldset>

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t.soilCard}</summary>
        <p className="mt-2 text-xs text-muted-foreground">{t.soilCardHint}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="soil-testedOn">{t.testedOn}</Label>
            <Input
              id="soil-testedOn"
              type="date"
              max={today}
              value={soil.testedOn ?? ""}
              onChange={(e) => setSoil((s) => ({ ...s, testedOn: e.target.value }))}
            />
          </div>
          {SOIL_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`soil-${f.key}`}>{f.label}</Label>
              <Input
                id={`soil-${f.key}`}
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={soil[f.key] ?? ""}
                onChange={(e) => setSoil((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </details>

      {status && (
        <p
          role="status"
          className={
            status.kind === "ok"
              ? "text-sm text-emerald-700 dark:text-emerald-300"
              : "text-sm text-red-700 dark:text-red-300"
          }
        >
          {status.text}
        </p>
      )}
      <Button type="submit" size="lg" disabled={saving} className="w-full sm:w-auto">
        {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {saving ? t.saving : t.save}
      </Button>
    </form>
  );
}

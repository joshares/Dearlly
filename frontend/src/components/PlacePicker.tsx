"use client";

import { useEffect, useMemo, useState } from "react";

import { hint, input, label } from "@/components/write-kit";
import { getMessages } from "@/i18n";
import { api, peek, remember } from "@/lib/api";

const t = getMessages().date;

type Vibe = keyof typeof t.vibes;
const VIBES = Object.keys(t.vibes) as Vibe[];

export type City = { key: string; name: string; place_count: number };
export type Place = {
  key: string;
  name: string;
  area: string;
  address: string | null;
  kind: string;
  vibes: Vibe[];
  price: number | null;
  price_note: string | null;
  sources: { publisher: string; title: string; url: string; published: string | null; rank: number | null }[];
};

export type PlaceChoice = {
  city: string;
  placeKey: string; // "" = typed in
  placeName: string;
  placeArea: string;
  placeAddress: string;
};

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** City → vibe → one of our curated places (with the guides that recommend it), or type your own. */
export function PlacePicker({
  value,
  onChange,
}: {
  value: PlaceChoice;
  onChange: (changes: Partial<PlaceChoice>) => void;
}) {
  const [cities, setCities] = useState<City[]>(() => peek<City[]>("/cities") ?? []);
  const path = `/cities/${encodeURIComponent(value.city)}/places`;
  const [places, setPlaces] = useState<Place[] | null>(() => peek<Place[]>(path) ?? null);
  const [failed, setFailed] = useState(false);
  const [vibe, setVibe] = useState<Vibe | "all">("all");
  const [typing, setTyping] = useState(value.placeKey === "" && value.placeName !== "");

  useEffect(() => {
    api<City[]>("/cities")
      .then((found) => {
        remember("/cities", found);
        setCities(found);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let current = true;
    api<Place[]>(path)
      .then((found) => {
        remember(path, found);
        if (current) {
          setPlaces(found);
          setFailed(false);
        }
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [path]);

  const shown = useMemo(
    () => (places ?? []).filter((p) => vibe === "all" || p.vibes.includes(vibe)),
    [places, vibe],
  );

  function choose(place: Place) {
    onChange({ placeKey: place.key, placeName: place.name, placeArea: place.area, placeAddress: place.address ?? "" });
  }

  function typeOwn() {
    setTyping(true);
    onChange({ placeKey: "", placeName: "", placeArea: "", placeAddress: "" });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className={label}>
        {t.cityLabel}
        <select className={input} name="city" value={value.city}
          onChange={(e) => onChange({ city: e.target.value, placeKey: "", placeName: "", placeArea: "", placeAddress: "" })}>
          {(cities.length ? cities : [{ key: value.city, name: value.city, place_count: 0 }]).map((c) => (
            <option key={c.key} value={c.key}>{c.name}</option>
          ))}
        </select>
      </label>

      {typing || failed ? (
        <div className="flex flex-col gap-4">
          {failed && <p role="alert" className="text-sm font-semibold">{t.placesFailed}</p>}
          <label className={label}>
            {t.placeNameLabel}
            <input className={input} name="place_name" maxLength={80} required value={value.placeName}
              onChange={(e) => onChange({ placeKey: "", placeName: e.target.value })} />
          </label>
          <label className={label}>
            {t.placeAreaLabel}
            <input className={input} name="place_area" maxLength={60} value={value.placeArea}
              onChange={(e) => onChange({ placeArea: e.target.value })} />
          </label>
          <label className={label}>
            {t.placeAddressLabel}
            <input className={input} name="place_address" maxLength={120} value={value.placeAddress}
              onChange={(e) => onChange({ placeAddress: e.target.value })} />
          </label>
          {!failed && (
            <button type="button" className="self-start font-bold underline" onClick={() => setTyping(false)}>
              {t.fromList}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{t.vibesLabel}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t.vibesLabel}>
            {(["all", ...VIBES] as const).map((v) => (
              <button key={v} type="button" aria-pressed={vibe === v} onClick={() => setVibe(v)}
                className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${
                  vibe === v ? "border-fg bg-fg text-bg" : "border-line"}`}>
                {v === "all" ? t.allVibes : t.vibes[v]}
              </button>
            ))}
          </div>
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border-2 border-dashed border-line p-2"
            aria-busy={places === null}>
            {places === null && <li className="p-3 text-sm text-muted">{t.loadingPlaces}</li>}
            {places !== null && shown.length === 0 && <li className="p-3 text-sm text-muted">{t.noPlaces}</li>}
            {shown.map((place) => (
              <PlaceRow key={place.key} place={place} chosen={value.placeKey === place.key} onChoose={() => choose(place)} />
            ))}
          </ul>
          <button type="button" className="self-start font-bold underline" onClick={typeOwn}>
            {t.somewhereElse}
          </button>
        </div>
      )}
    </div>
  );
}

function PlaceRow({ place, chosen, onChoose }: { place: Place; chosen: boolean; onChoose: () => void }) {
  const count = place.sources.length;
  return (
    <li className={`flex flex-col gap-2 rounded border-2 bg-surface p-3 ${chosen ? "border-stamp" : "border-transparent"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm">
          <strong className="block text-base">{place.name}</strong>
          <span className="block text-muted">{place.area}</span>
          <span className="block font-semibold">
            {count === 1 ? t.featuredOne : fill(t.featuredMany, { count })}
          </span>
          {place.price_note && <span className={`block ${hint}`}>{place.price_note}</span>}
        </span>
        <button type="button" aria-pressed={chosen} onClick={onChoose}
          className={`min-h-10 shrink-0 rounded-md border-2 px-3 text-sm font-bold ${
            chosen ? "border-stamp bg-stamp text-paper" : "border-fg"}`}>
          {chosen ? t.chosen : t.choose}
        </button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold underline">{t.sourcesToggle}</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {place.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                {s.rank ? fill(t.rankIn, { rank: s.rank, publisher: s.publisher }) : fill(t.listedIn, { publisher: s.publisher })}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

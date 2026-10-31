import type { MetadataRoute } from "next";

import { serverGet } from "@/lib/server-api";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";

// Made when asked for (the city list comes from the API, which isn't there while building).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const cities = (await serverGet<{ key: string }[]>("/cities")) ?? [];
  return [
    ...PUBLIC_PAGES.map((path) => ({
      url: `${SITE_URL}${path === "/" ? "" : path}`,
      priority: path === "/" ? 1 : 0.7,
    })),
    ...cities.map((city) => ({ url: `${SITE_URL}/date-ideas/${city.key}`, priority: 0.7 })),
  ];
}

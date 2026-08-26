import type { MetadataRoute } from "next";

import { brand } from "@/config/brand";

const BASE = `https://${brand.domain}`;

/** Public marketing routes only — everything behind auth (trainer/client/
 *  admin) has nothing for a search engine to index and is kept out via
 *  robots.ts instead. */
const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/for-companies", priority: 0.9, changeFrequency: "monthly" },
  { path: "/for-experts", priority: 0.9, changeFrequency: "monthly" },
  { path: "/services", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" },
  { path: "/security", priority: 0.7, changeFrequency: "monthly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/resources", priority: 0.6, changeFrequency: "weekly" },
  { path: "/apply", priority: 0.7, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/security/sub-processors", priority: 0.4, changeFrequency: "monthly" },
  { path: "/status", priority: 0.4, changeFrequency: "daily" },
  { path: "/legal/sla", priority: 0.4, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/cookies", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}

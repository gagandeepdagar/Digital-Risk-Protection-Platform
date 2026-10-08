import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";

const listSchema = z.array(z.string().trim().min(1).max(320)).max(40).default([]);
const profileSchema = z.object({
  companyName: z.string().trim().max(120).default(""),
  logoDataUrl: z.string().max(1_500_000).default(""),
  logoUrl: z.string().max(2048).default(""),
  officialDomains: listSchema,
  officialHandles: listSchema,
  officialApps: listSchema,
  officialPublishers: listSchema,
  identifiers: listSchema,
}).partial().default({});
const scanSchema = z.object({
  brand: z.string().trim().min(1).max(120),
  profile: profileSchema.optional(),
});

type SearchResult = { title: string; url: string; snippet: string };
type SourceState = "available" | "partial" | "blocked" | "unavailable";
type SourceStatus = { id: string; label: string; state: SourceState; note: string; resultCount: number; url?: string };
type Finding = { id: string; category: "social" | "app" | "website"; title: string; subtitle: string; platform: string; url: string; riskScore: number; confidence: number; signals: string[]; evidence: string; source: string };
type SocialHandle = { id: string; platform: string; handle: string; title: string; url: string; snippet: string; confidence: number; sourceUrl: string; excluded: boolean; likelyOfficial?: boolean };
type AppCandidate = { id: string; title: string; developer: string; description: string; url: string; artwork?: string; store: string; confidence: number; excluded: boolean; likelyOfficial?: boolean; independentIntegration?: boolean };
type WebsiteCandidate = { id: string; title: string; host: string; url: string; snippet: string; classification: "likely-official" | "review" | "possible-lookalike"; confidence: number; excluded: boolean };

const searchTimeoutMs = 10_000;
const resultMaxBytes = 400_000;
const suspiciousWords = ["support", "helpdesk", "help-desk", "customer-care", "customer care", "verify", "verification", "refund", "wallet", "giveaway", "claim", "secure", "security", "login", "recovery", "prize", "reward"];
const platforms = [
  { name: "Instagram", host: "instagram.com", query: "official profile" },
  { name: "Facebook", host: "facebook.com", query: "official company page" },
  { name: "X", host: "x.com", query: "official account" },
  { name: "LinkedIn", host: "linkedin.com", query: "company page" },
  { name: "TikTok", host: "tiktok.com", query: "official profile" },
  { name: "YouTube", host: "youtube.com", query: "official channel" },
];
const blockedHandles = new Set(["p", "reel", "reels", "stories", "explore", "hashtag", "search", "watch", "video", "videos", "posts", "share", "login", "about", "help", "privacy", "terms", "directory", "intent", "home", "i", "company", "feed"]);

function stableId(value: string) { return createHash("sha1").update(value).digest("hex").slice(0, 16); }
function decodeHtml(text: string) {
  return text.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)));
}
function stripHtml(text: string) { return decodeHtml(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); }
function norm(value: string) { return value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]/g, ""); }
function slug(value: string) { return norm(value).replace(/(official|incorporated|inc|company|corporation|corp|limited|ltd|group|global|the)$/g, ""); }
function unwrapBingUrl(value: string) {
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().endsWith("bing.com")) return url;
    const token = url.searchParams.get("u");
    if (!token) return null;
    const decoded = token.startsWith("a1") ? Buffer.from(token.slice(2), "base64url").toString("utf8") : token;
    return new URL(decoded);
  } catch { return null; }
}
function similarity(a: string, b: string) {
  const left = norm(a), right = norm(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = prev[0]; prev[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const old = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return Math.max(0, 1 - prev[right.length] / Math.max(left.length, right.length));
}
function containsBrand(text: string, brand: string, identifiers: string[]) {
  const normalized = norm(text);
  const name = norm(brand);
  return (!!name && normalized.includes(name)) || identifiers.some(item => norm(item).length >= 3 && normalized.includes(norm(item)));
}
function isIndependentIntegration(title: string, description: string, brand: string, identifiers: string[]) {
  const text = `${title} ${description}`;
  if (!containsBrand(text, brand, identifiers)) return false;
  const normalized = norm(text), name = norm(brand);
  const contextual = [ `for${name}`, `with${name}`, `within${name}`, `foryour${name}`, `connectsto${name}`, `integrateswith${name}` ].some(phrase => !!name && normalized.includes(phrase));
  const functional = /\b(widget|companion|integration|extension|client|task|tasks|to-do|todo|note|notes|entry)\b/i.test(text);
  const disclosure = /\b(not affiliated with|third[- ]party|independent app|not endorsed by)\b/i.test(text);
  const titleHasRiskTerm = suspiciousWords.some(word => norm(title).includes(norm(word)));
  return !titleHasRiskTerm && (disclosure || (functional && contextual));
}
function parseBingResults(html: string, limit = 8): SearchResult[] {
  const blocks = [...html.matchAll(/<li\b(?=[^>]*\bclass=["'][^"']*\bb_algo\b[^"']*["'])[^>]*>([\s\S]*?)<\/li>/gi)].map(match => match[1]).slice(0, limit);
  const results: SearchResult[] = [];
  for (const block of blocks) {
    const match = block.match(/<h2\b[^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!match) continue;
    const url = unwrapBingUrl(decodeHtml(match[1]));
    if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password) continue;
    const paragraph = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
    results.push({ title: stripHtml(match[2]).slice(0, 220), url: url.toString(), snippet: stripHtml(paragraph).slice(0, 600) });
  }
  return results;
}
async function fetchText(url: string, timeout = searchTimeoutMs): Promise<{ ok: boolean; status: number; text: string; blocked: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36", Accept: "text/html,application/json;q=0.9,*/*;q=0.8" }, redirect: "follow" });
    const reader = response.body?.getReader();
    let text = "";
    if (reader) {
      const decoder = new TextDecoder(); let size = 0;
      while (size < resultMaxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value.subarray(0, Math.max(0, resultMaxBytes - size));
        size += chunk.byteLength; text += decoder.decode(chunk, { stream: true });
        if (size >= resultMaxBytes) { void reader.cancel(); break; }
      }
      text += decoder.decode();
    }
    const blocked = response.status === 202 || response.status === 403 || response.status === 429 || /captcha|unusual traffic|verify you are human/i.test(text.slice(0, 10_000));
    return { ok: response.ok && !blocked, status: response.status, text, blocked, ...(blocked ? { error: "The public source is rate-limiting or challenging automated requests." } : {}) };
  } catch (error) {
    return { ok: false, status: 0, text: "", blocked: false, error: error instanceof Error && error.name === "AbortError" ? "The source timed out." : "The source could not be reached." };
  } finally { clearTimeout(timer); }
}
function bingUrl(query: string) { return `https://www.bing.com/search?${new URLSearchParams({ q: query, count: "8", setlang: "en-US" })}`; }
async function searchBing(query: string) {
  const url = bingUrl(query);
  const result = await fetchText(url);
  return { url, result, items: result.ok ? parseBingResults(result.text) : [] };
}
type WikidataIdentity = { state: SourceState; note: string; searchUrl: string; entityUrl?: string; handles: SocialHandle[]; websites: WebsiteCandidate[] };
async function searchWikidata(brand: string, officialHandles: string[], officialDomains: string[]): Promise<WikidataIdentity> {
  const searchUrl = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbsearchentities", search: brand, language: "en", format: "json", limit: "8" })}`;
  const empty = (state: SourceState, note: string): WikidataIdentity => ({ state, note, searchUrl, handles: [], websites: [] });
  const search = await fetchText(searchUrl, 8000);
  if (!search.ok) return empty(search.blocked ? "blocked" : "unavailable", search.error ?? `HTTP ${search.status}`);
  try {
    const payload = JSON.parse(search.text) as { search?: Array<{ id: string; label: string; description?: string }> };
    const candidates = (payload.search ?? []).filter(item => item.id && item.label && similarity(item.label, brand) >= 0.82);
    candidates.sort((a, b) => {
      const rank = (item: { label: string; description?: string }) => (norm(item.label) === norm(brand) ? 2 : 0) + (/company|brand|platform|software|service|retailer|corporation|manufacturer|organization|organisation/i.test(item.description ?? "") ? 1 : 0) - (/given name|mythology|person|city|award|song|film/i.test(item.description ?? "") ? 3 : 0);
      return rank(b) - rank(a) || similarity(b.label, brand) - similarity(a.label, brand);
    });
    const identity = candidates[0];
    if (!identity) return empty("partial", "Registry responded; no close brand entity was found");
    const entityUrl = `https://www.wikidata.org/wiki/${encodeURIComponent(identity.id)}`;
    const entityResponse = await fetchText(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(identity.id)}.json`, 8000);
    if (!entityResponse.ok) return { ...empty("partial", entityResponse.error ?? "Brand entity found, but its public properties are unavailable"), entityUrl };
    const entityPayload = JSON.parse(entityResponse.text) as { entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }> };
    const claims = entityPayload.entities?.[identity.id]?.claims ?? {};
    const values = (property: string) => (claims[property] ?? []).map(statement => statement.mainsnak?.datavalue?.value).filter((value): value is string => typeof value === "string" && !!value.trim()).map(value => value.trim());
    const mappings = [
      { property: "P2003", platform: "Instagram", host: "instagram.com", prefix: "@" },
      { property: "P2013", platform: "Facebook", host: "facebook.com", prefix: "@" },
      { property: "P2002", platform: "X", host: "x.com", prefix: "@" },
      { property: "P4264", platform: "LinkedIn", host: "linkedin.com", prefix: "@" },
      { property: "P7085", platform: "TikTok", host: "tiktok.com", prefix: "@" },
      { property: "P2397", platform: "YouTube", host: "youtube.com", prefix: "" },
    ];
    const confidence = Math.round(82 + similarity(identity.label, brand) * 10);
    const handles = mappings.flatMap(mapping => values(mapping.property).slice(0, 3).map(value => {
      const clean = value.replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?[^/]+\//i, "").replace(/\/$/, "");
      if (!clean || clean.length > 180 || /[\r\n<>]/.test(clean)) return null;
      const path = mapping.platform === "LinkedIn" ? `/company/${encodeURIComponent(clean)}` : mapping.platform === "YouTube" ? `/channel/${encodeURIComponent(clean)}` : mapping.platform === "TikTok" ? `/@${encodeURIComponent(clean)}` : `/${encodeURIComponent(clean)}`;
      const url = `https://www.${mapping.host}${path}`;
      return { id: stableId(`wikidata:${mapping.platform}:${clean}`), platform: mapping.platform, handle: `${mapping.prefix}${clean}`, title: `${identity.label} · ${mapping.platform} profile`, url, snippet: `${identity.description || "Brand record"}. This account is listed in Wikidata item ${identity.id}; it is not a live platform verification.`, confidence, sourceUrl: entityUrl, excluded: isTrustedHandle(url, officialHandles), likelyOfficial: true };
    }).filter((item): item is NonNullable<typeof item> => !!item));
    const websites = values("P856").slice(0, 3).flatMap(value => {
      try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) return [];
        const host = hostOf(url.toString());
        if (!host) return [];
        return [{ id: stableId(`wikidata-web:${url.href}`), title: `${identity.label} official website (Wikidata)`, host, url: url.toString(), snippet: `Listed as an official website in Wikidata item ${identity.id}; verify the current owner and destination.`, classification: "likely-official" as const, confidence, excluded: isTrustedHost(host, officialDomains) }];
      } catch { return []; }
    });
    return { state: handles.length || websites.length ? "available" : "partial", note: `${identity.label} entity matched; ${handles.length} social link${handles.length === 1 ? "" : "s"} and ${websites.length} official site${websites.length === 1 ? "" : "s"} listed`, searchUrl, entityUrl, handles, websites };
  } catch { return empty("partial", "Registry responded, but its entity data could not be normalized"); }
}
function hostOf(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function isTrustedHost(candidate: string, domains: string[]) {
  return domains.some(entry => {
    const trusted = hostOf(entry) || entry.toLowerCase().replace(/^https?:\/\//, "").split(/[/:?#]/)[0]?.replace(/^www\./, "");
    return !!trusted && (candidate === trusted || candidate.endsWith(`.${trusted}`));
  });
}
function isTrustedHandle(url: string, rawHandles: string[]) {
  let parsed: URL; try { parsed = new URL(url); } catch { return false; }
  const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
  return rawHandles.some(raw => {
    const input = raw.trim(); if (!input) return false;
    if (input.startsWith("@")) return path.split("/").filter(Boolean)[0]?.replace(/^@/, "") === input.slice(1).toLowerCase().replace(/^@/, "");
    try {
      const candidate = new URL(input.includes("://") ? input : `https://${input.replace(/^@/, "")}`);
      const inputPath = candidate.pathname.replace(/\/$/, "").toLowerCase();
      return candidate.hostname.replace(/^www\./, "") === parsed.hostname.replace(/^www\./, "") && inputPath === path;
    } catch { return false; }
  });
}
function platformFromUrl(url: string) {
  let u: URL; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const spec = platforms.find(p => host === p.host || host.endsWith(`.${p.host}`) || (p.name === "X" && (host === "twitter.com" || host.endsWith(".twitter.com"))));
  if (!spec) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0].replace(/^@/, "").toLowerCase();
  if ((blockedHandles.has(first) && !(spec.name === "LinkedIn" && ["company", "in"].includes(first))) || /^\d+$/.test(first)) return null;
  if (spec.name === "LinkedIn" && !["company", "in"].includes(first)) return null;
  if (spec.name === "YouTube" && !(first.startsWith("@") || ["channel", "c", "user"].includes(first))) return null;
  if (spec.name === "TikTok" && !parts[0].startsWith("@")) return null;
  const canonicalHost = spec.name === "X" && host.includes("twitter.com") ? "twitter.com" : spec.host;
  const canonicalPath = `/${parts.map(part => encodeURIComponent(decodeURIComponent(part))).join("/")}`;
  return { platform: spec.name, handle: `@${parts[0].replace(/^@/, "")}`, url: `https://${canonicalHost}${canonicalPath}` };
}
function confidenceFromSimilarity(value: number, title: string, position: number) {
  const officialCue = /\bofficial\b|\bverified\b/i.test(title) ? 7 : 0;
  return Math.max(25, Math.min(91, Math.round(34 + value * 44 + officialCue + Math.max(0, 5 - position))));
}
function isSuspiciousHost(host: string, brand: string) {
  const first = host.split(".")[0] ?? "";
  const brandSlug = slug(brand);
  if (!brandSlug || !first) return false;
  const sim = similarity(first, brandSlug);
  const riskWord = suspiciousWords.some(word => first.includes(norm(word)));
  const brandInside = first.includes(brandSlug) && first !== brandSlug;
  return (brandInside && riskWord) || (sim >= 0.62 && sim < 1 && first.length >= 4) || (riskWord && first.startsWith(brandSlug));
}
function scanConfidence(title: string, brand: string, snippet: string) {
  return Math.min(92, Math.max(28, Math.round(40 + similarity(title, brand) * 25 + (containsBrand(snippet, brand, []) ? 9 : 0))));
}
function resultSourceStatus(id: string, label: string, source: Awaited<ReturnType<typeof searchBing>>, count: number): SourceStatus {
  if (source.result.ok) return { id, label, state: count ? "available" : "partial", note: count ? `${count} indexed result${count === 1 ? "" : "s"}` : "Search responded; no matching indexed results", resultCount: count, url: source.url };
  return { id, label, state: source.result.blocked ? "blocked" : "unavailable", note: source.result.error ?? `HTTP ${source.result.status}`, resultCount: 0, url: source.url };
}
function makeFinding(value: Omit<Finding, "id">): Finding { return { id: stableId(`${value.category}:${value.url}`), ...value }; }

async function performScan(brand: string, profileInput: z.infer<typeof profileSchema>) {
  const parsedProfile = profileSchema.parse(profileInput);
  const profile = {
    companyName: parsedProfile.companyName ?? "", logoDataUrl: parsedProfile.logoDataUrl ?? "", logoUrl: parsedProfile.logoUrl ?? "",
    officialDomains: parsedProfile.officialDomains ?? [], officialHandles: parsedProfile.officialHandles ?? [],
    officialApps: parsedProfile.officialApps ?? [], officialPublishers: parsedProfile.officialPublishers ?? [], identifiers: parsedProfile.identifiers ?? [],
  };
  const officialDomains = profile.officialDomains.map(value => hostOf(value) || value.toLowerCase().replace(/^https?:\/\//, "").split(/[/:?#]/)[0]).filter(Boolean);
  const knownApps = profile.officialApps.map(norm).filter(Boolean);
  const knownPublishers = profile.officialPublishers.map(norm).filter(Boolean);
  const identifiers = profile.identifiers;
  const sourceStatuses: SourceStatus[] = [];
  const findings: Finding[] = [];
  const handles: SocialHandle[] = [];
  const apps: AppCandidate[] = [];
  const websites: WebsiteCandidate[] = [];

  const [identity, platformResponses] = await Promise.all([
    searchWikidata(brand, profile.officialHandles, officialDomains),
    Promise.all(platforms.map(platform => searchBing(`"${brand}" ${platform.name} ${platform.query}`))),
  ]);
  sourceStatuses.push({ id: "wikidata-brand", label: "Wikidata brand registry", state: identity.state, note: identity.note, resultCount: identity.handles.length, url: identity.entityUrl ?? identity.searchUrl });
  for (const handle of identity.handles) if (!handles.some(existing => existing.url === handle.url)) handles.push(handle);
  for (const site of identity.websites) if (!websites.some(existing => existing.host === site.host)) websites.push(site);
  for (let index = 0; index < platforms.length; index++) {
    const platform = platforms[index]; const response = platformResponses[index];
    const matches = response.items.flatMap((item, position) => {
      const parsed = platformFromUrl(item.url);
      if (!parsed || parsed.platform !== platform.name) return [];
      const excluded = isTrustedHandle(parsed.url, profile.officialHandles);
      const likelyOfficial = handles.some(existing => existing.url === parsed.url && existing.likelyOfficial);
      const sim = Math.max(similarity(parsed.handle, brand), similarity(item.title, brand));
      const confidence = confidenceFromSimilarity(sim, item.title, position);
      const key = stableId(`${platform.name}:${parsed.url}`);
      const handle: SocialHandle = { id: key, platform: platform.name, handle: parsed.handle, title: item.title || parsed.handle, url: parsed.url, snippet: item.snippet, confidence, sourceUrl: response.url, excluded, likelyOfficial };
      const text = `${item.title} ${parsed.handle} ${item.snippet}`.toLowerCase();
      const riskTerms = suspiciousWords.filter(word => text.includes(word));
      if (!excluded && !likelyOfficial && sim >= 0.42 && riskTerms.length > 0) {
        const score = Math.min(92, Math.round(34 + sim * 28 + Math.min(22, riskTerms.length * 8)));
        findings.push(makeFinding({ category: "social", title: item.title || parsed.handle, subtitle: item.snippet.slice(0, 120), platform: platform.name, url: parsed.url, riskScore: score, confidence, signals: ["Brand-name similarity", ...riskTerms.slice(0, 2).map(word => `Risk wording: ${word}`)], evidence: item.snippet || "Indexed public profile result. Open the source and verify ownership before escalation.", source: "Bing public index" }));
      }
      return [handle];
    });
    for (const item of matches) if (!handles.some(existing => existing.url === item.url)) handles.push(item);
    sourceStatuses.push(resultSourceStatus(`social-${norm(platform.name)}`, `${platform.name} search`, response, matches.length));
  }

  const appleUrl = `https://itunes.apple.com/search?${new URLSearchParams({ term: brand, entity: "software", limit: "15", country: "us" })}`;
  const apple = await fetchText(appleUrl);
  if (apple.ok) {
    try {
      const payload = JSON.parse(apple.text) as { results?: Array<Record<string, unknown>>; resultCount?: number };
      const items = Array.isArray(payload.results) ? payload.results : [];
      for (const item of items) {
        const title = String(item.trackName ?? "").slice(0, 220);
        const developer = String(item.sellerName ?? item.artistName ?? "").slice(0, 180);
        const description = String(item.description ?? "").slice(0, 650);
        const url = String(item.trackViewUrl ?? "");
        if (!title || !/^https:\/\//.test(url)) continue;
        const appSim = Math.max(similarity(title, brand), title.toLowerCase().includes(brand.toLowerCase()) ? 0.8 : 0);
        const developerKnown = knownPublishers.some(value => norm(developer) === value || (value.length >= 4 && norm(developer).includes(value)));
        const exactApp = knownApps.includes(norm(title));
        const excluded = exactApp || developerKnown || profile.officialApps.some(name => norm(name) === norm(title));
        const likelyOfficial = !excluded && containsBrand(developer, brand, identifiers);
        const hasBrand = appSim >= 0.30 || containsBrand(description, brand, identifiers);
        if (!hasBrand) continue;
        const independentIntegration = !likelyOfficial && isIndependentIntegration(title, description, brand, identifiers);
        const confidence = Math.min(92, Math.max(31, Math.round(37 + Math.min(appSim, independentIntegration ? 0.55 : 1) * 42 + (developer ? 5 : 0))));
        const storeResult: AppCandidate = { id: stableId(`apple:${String(item.trackId ?? url)}`), title, developer, description, url, artwork: String(item.artworkUrl100 ?? ""), store: "Apple App Store", confidence, excluded, likelyOfficial, independentIntegration };
        if (!apps.some(existing => existing.url === url)) apps.push(storeResult);
        if (!excluded && !likelyOfficial && !independentIntegration && appSim >= 0.50) {
          const signals = [`App-name similarity ${Math.round(appSim * 100)}%`];
          if (knownPublishers.length > 0 && !developerKnown) signals.push("Publisher is not on the trusted list");
          if (!developer) signals.push("Publisher is not listed");
          if (suspiciousWords.some(word => `${title} ${description}`.toLowerCase().includes(word))) signals.push("Promotional or account-related wording");
          const score = Math.min(89, Math.round(31 + appSim * 32 + (knownPublishers.length > 0 && !developerKnown ? 19 : 0)));
          findings.push(makeFinding({ category: "app", title, subtitle: developer, platform: "Apple App Store", url, riskScore: score, confidence, signals, evidence: description.slice(0, 240) || "Search catalogue metadata matched the brand query.", source: "Apple iTunes Search API" }));
        }
      }
      sourceStatuses.push({ id: "apple-store", label: "Apple App Store", state: "available", note: `${apps.length} catalogue result${apps.length === 1 ? "" : "s"}`, resultCount: apps.length, url: `https://apps.apple.com/us/search?${new URLSearchParams({ term: brand })}` });
    } catch {
      sourceStatuses.push({ id: "apple-store", label: "Apple App Store", state: "partial", note: "Catalogue responded, but its data could not be normalized", resultCount: 0, url: `https://apps.apple.com/us/search?${new URLSearchParams({ term: brand })}` });
    }
  } else {
    sourceStatuses.push({ id: "apple-store", label: "Apple App Store", state: apple.blocked ? "blocked" : "unavailable", note: apple.error ?? `HTTP ${apple.status}`, resultCount: 0, url: `https://apps.apple.com/us/search?${new URLSearchParams({ term: brand })}` });
  }

  const playQuery = await searchBing(`"${brand}" Google Play app`);
  const playApps: AppCandidate[] = [];
  for (const item of playQuery.items) {
    let url: URL; try { url = new URL(item.url); } catch { continue; }
    if (!url.hostname.endsWith("play.google.com") || !url.pathname.includes("/store/apps/details")) continue;
    const id = url.searchParams.get("id") ?? item.url;
    const excluded = knownApps.some(name => norm(item.title) === name) || knownPublishers.some(name => norm(item.snippet).includes(name));
    const confidence = scanConfidence(item.title, brand, item.snippet);
    const independentIntegration = isIndependentIntegration(item.title, item.snippet, brand, identifiers);
    const app: AppCandidate = { id: stableId(`play:${id}`), title: item.title || id, developer: "Publisher details on Google Play", description: item.snippet, url: item.url, store: "Google Play · public index", confidence, excluded, independentIntegration };
    if (!playApps.some(existing => existing.url === app.url)) playApps.push(app);
  }
  apps.push(...playApps.filter(item => !apps.some(existing => existing.url === item.url)));
  sourceStatuses.push(resultSourceStatus("google-play", "Google Play index", playQuery, playApps.length));
  for (const app of playApps) {
    const appSim = similarity(app.title, brand);
    const knownPublisherAvailable = knownPublishers.length > 0;
    if (!app.excluded && !app.independentIntegration && (appSim >= 0.45 || containsBrand(`${app.title} ${app.description}`, brand, identifiers))) {
      const publisherMismatch = knownPublisherAvailable && !knownPublishers.some(value => norm(app.description).includes(value));
      const signals = [`App-name similarity ${Math.round(appSim * 100)}%`];
      if (publisherMismatch) signals.push("Publisher is not on the trusted list");
      signals.push("Store listing found through a public search index");
      findings.push(makeFinding({ category: "app", title: app.title, subtitle: app.developer, platform: "Google Play", url: app.url, riskScore: Math.min(82, Math.round(28 + appSim * 30 + (publisherMismatch ? 17 : 0))), confidence: app.confidence, signals, evidence: app.description || "Open the Google Play listing and compare its publisher and details.", source: "Bing public index → Google Play" }));
    }
  }

  const websiteQueries = await Promise.all([
    searchBing(`"${brand}" official website`),
    searchBing(`"${brand}" login support scam fake website`),
  ]);
  const combinedResults = websiteQueries.flatMap(query => query.items.map(item => ({ ...item, sourceUrl: query.url })));
  const seenHosts = new Set<string>(websites.map(site => site.host));
  const probableDomains = officialDomains;
  for (const item of combinedResults) {
    const host = hostOf(item.url);
    if (!host || seenHosts.has(host) || host === "bing.com" || host.endsWith(".bing.com")) continue;
    seenHosts.add(host);
    const excluded = isTrustedHost(host, probableDomains);
    const risky = isSuspiciousHost(host, brand);
    const likelyOfficial = /official website|home page/i.test(item.title) && containsBrand(item.title, brand, identifiers) && !risky;
    const classification: WebsiteCandidate["classification"] = risky ? "possible-lookalike" : likelyOfficial ? "likely-official" : "review";
    const confidence = scanConfidence(item.title, brand, item.snippet);
    const candidate: WebsiteCandidate = { id: stableId(`web:${item.url}`), title: item.title || host, host, url: item.url, snippet: item.snippet, classification: excluded ? "likely-official" : classification, confidence, excluded };
    websites.push(candidate);
    const riskText = `${item.title} ${item.snippet} ${host}`.toLowerCase();
    const relevantRiskTerms = suspiciousWords.filter(word => riskText.includes(word));
    if (!excluded && risky) {
      const signals = ["Hostname resembles the brand", ...(relevantRiskTerms.slice(0, 2).map(word => `Risk wording: ${word}`))];
      const score = Math.min(94, Math.round(41 + similarity(host.split(".")[0], brand) * 22 + Math.min(24, relevantRiskTerms.length * 8)));
      findings.push(makeFinding({ category: "website", title: item.title || host, subtitle: host, platform: "Public web index", url: item.url, riskScore: score, confidence, signals, evidence: item.snippet || "Indexed public website result; inspect the destination and ownership before action.", source: "Bing public index" }));
    }
  }
  const totalWebResults = websiteQueries.reduce((count, query) => count + query.items.length, 0);
  sourceStatuses.push({
    id: "web-search", label: "Website discovery", state: websiteQueries.some(query => query.result.ok) ? (websiteQueries.every(query => query.result.ok) && totalWebResults > 0 ? "available" : "partial") : websiteQueries.some(query => query.result.blocked) ? "blocked" : "unavailable",
    note: totalWebResults ? `${totalWebResults} indexed result${totalWebResults === 1 ? "" : "s"}` : websiteQueries.find(query => !query.result.ok)?.result.error ?? "No matching indexed pages",
    resultCount: totalWebResults, url: websiteQueries[0].url,
  });

  if (officialDomains.length > 0) {
    const root = officialDomains[0];
    const certUrl = `https://api.certspotter.com/v1/issuances?${new URLSearchParams({ domain: root, include_subdomains: "true", expand: "dns_names" })}`;
    const certificates = await fetchText(certUrl, 8000);
    if (certificates.ok) {
      try {
        const certData = JSON.parse(certificates.text) as Array<{ dns_names?: string[] }>;
        const hostCount = new Set(certData.flatMap(entry => entry.dns_names ?? []).map(name => name.toLowerCase().replace(/^\*\./, ""))).size;
        sourceStatuses.push({ id: "cert-transparency", label: "Certificate records", state: "available", note: `${hostCount} certificate hostnames for configured domain`, resultCount: hostCount, url: certUrl });
      } catch {
        sourceStatuses.push({ id: "cert-transparency", label: "Certificate records", state: "partial", note: "Certificate source responded, but records could not be normalized", resultCount: 0, url: certUrl });
      }
    } else sourceStatuses.push({ id: "cert-transparency", label: "Certificate records", state: certificates.blocked ? "blocked" : "unavailable", note: certificates.error ?? `HTTP ${certificates.status}`, resultCount: 0, url: certUrl });
  } else {
    sourceStatuses.push({ id: "cert-transparency", label: "Certificate records", state: "unavailable", note: "Add an official domain to check its public certificate records", resultCount: 0 });
  }

  findings.sort((a, b) => b.riskScore - a.riskScore);
  return {
    brand,
    searchedAt: new Date().toISOString(),
    sources: sourceStatuses,
    handles: handles.sort((a, b) => b.confidence - a.confidence).slice(0, 24),
    apps: apps.sort((a, b) => b.confidence - a.confidence).slice(0, 20),
    websites: websites.sort((a, b) => (a.classification === "possible-lookalike" ? -1 : 0) - (b.classification === "possible-lookalike" ? -1 : 0)).slice(0, 18),
    findings: findings.slice(0, 40),
    summary: {
      social: findings.filter(item => item.category === "social").length,
      apps: findings.filter(item => item.category === "app").length,
      websites: findings.filter(item => item.category === "website").length,
      sourcesAvailable: sourceStatuses.filter(item => item.state === "available" || item.state === "partial").length,
      sourcesTotal: sourceStatuses.length,
    },
  };
}

const requestWindows = new Map<string, number[]>();
export function createMonitoringRouter() {
  const router = Router();
  router.post("/scan", async (req, res) => {
    const address = String(req.ip ?? "unknown").split(":").slice(-1)[0];
    const now = Date.now();
    const recent = (requestWindows.get(address) ?? []).filter(time => now - time < 60_000);
    if (recent.length >= 8) {
      res.status(429).json({ error: "Please wait a minute before starting another scan." });
      return;
    }
    recent.push(now); requestWindows.set(address, recent);
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a brand name up to 120 characters and use a valid brand profile." });
      return;
    }
    try {
      const profile = profileSchema.parse(parsed.data.profile ?? {});
      const result = await performScan(parsed.data.brand, profile);
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      console.error("[Monitor] Scan failed", error);
      res.status(502).json({ error: "Public-source discovery could not complete. Check your connection and try again." });
    }
  });
  return router;
}

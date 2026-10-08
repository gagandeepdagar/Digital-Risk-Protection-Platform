export type SourceState = "available" | "partial" | "blocked" | "unavailable";

export type BrandProfile = {
  companyName: string;
  logoDataUrl: string;
  logoUrl: string;
  officialDomains: string[];
  officialHandles: string[];
  officialApps: string[];
  officialPublishers: string[];
  identifiers: string[];
};

export type ScanSource = {
  id: string;
  label: string;
  state: SourceState;
  note: string;
  resultCount: number;
  url?: string;
};

export type SocialHandle = {
  id: string;
  platform: string;
  handle: string;
  title: string;
  url: string;
  snippet: string;
  confidence: number;
  sourceUrl: string;
  excluded: boolean;
  likelyOfficial?: boolean;
};

export type AppCandidate = {
  id: string;
  title: string;
  developer: string;
  description: string;
  url: string;
  artwork?: string;
  store: string;
  confidence: number;
  excluded: boolean;
  likelyOfficial?: boolean;
  logoSimilarity?: number;
  independentIntegration?: boolean;
};

export type WebsiteCandidate = {
  id: string;
  title: string;
  host: string;
  url: string;
  snippet: string;
  classification: "likely-official" | "review" | "possible-lookalike";
  confidence: number;
  excluded: boolean;
};

export type Finding = {
  id: string;
  category: "social" | "app" | "website";
  title: string;
  subtitle: string;
  platform: string;
  url: string;
  riskScore: number;
  confidence: number;
  signals: string[];
  evidence: string;
  source: string;
};

export type ScanResponse = {
  brand: string;
  searchedAt: string;
  sources: ScanSource[];
  handles: SocialHandle[];
  apps: AppCandidate[];
  websites: WebsiteCandidate[];
  findings: Finding[];
  summary: { social: number; apps: number; websites: number; sourcesAvailable: number; sourcesTotal: number };
};

export const EMPTY_PROFILE: BrandProfile = {
  companyName: "",
  logoDataUrl: "",
  logoUrl: "",
  officialDomains: [],
  officialHandles: [],
  officialApps: [],
  officialPublishers: [],
  identifiers: [],
};

const PROFILE_KEY = "watchtower.brand.profile.v1";
const SCAN_KEY = "watchtower.last.scan.v1";

export function readProfile(): BrandProfile {
  try {
    const value = localStorage.getItem(PROFILE_KEY);
    if (!value) return EMPTY_PROFILE;
    const parsed = JSON.parse(value) as Partial<BrandProfile>;
    return {
      ...EMPTY_PROFILE,
      ...parsed,
      officialDomains: Array.isArray(parsed.officialDomains) ? parsed.officialDomains : [],
      officialHandles: Array.isArray(parsed.officialHandles) ? parsed.officialHandles : [],
      officialApps: Array.isArray(parsed.officialApps) ? parsed.officialApps : [],
      officialPublishers: Array.isArray(parsed.officialPublishers) ? parsed.officialPublishers : [],
      identifiers: Array.isArray(parsed.identifiers) ? parsed.identifiers : [],
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function saveProfile(profile: BrandProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function readLastScan(): ScanResponse | null {
  try {
    const value = localStorage.getItem(SCAN_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as ScanResponse;
    return parsed && Array.isArray(parsed.findings) && Array.isArray(parsed.sources) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLastScan(scan: ScanResponse): void {
  try {
    localStorage.setItem(SCAN_KEY, JSON.stringify(scan));
  } catch {
    // Keeping the current investigation visible is more important than browser quota persistence.
  }
}

export function parseLines(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export async function scanBrand(brand: string, profile: BrandProfile): Promise<ScanResponse> {
  const response = await fetch("/api/monitor/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand, profile }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "The scan could not be completed.");
  }
  return payload as ScanResponse;
}

function loadComparisonImage(src: string, timeoutMs = 3500): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => { window.clearTimeout(timer); resolve(image); };
    image.onerror = () => { window.clearTimeout(timer); resolve(null); };
    image.src = src;
  });
}

function imageHash(image: HTMLImageElement): boolean[] | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 9;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 9, 8);
    const pixels = context.getImageData(0, 0, 9, 8).data;
    const luminance: number[] = [];
    for (let pixel = 0; pixel < 72; pixel++) {
      const offset = pixel * 4;
      luminance.push((pixels[offset] * 299 + pixels[offset + 1] * 587 + pixels[offset + 2] * 114) / 1000);
    }
    const hash: boolean[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash.push(luminance[y * 9 + x] > luminance[y * 9 + x + 1]);
    return hash;
  } catch { return null; }
}

export async function compareLogoToApps(logoDataUrl: string, scan: ScanResponse): Promise<ScanResponse> {
  const artworkApps = scan.apps.filter(app => !!app.artwork).slice(0, 12);
  if (!artworkApps.length) {
    return { ...scan, sources: [...scan.sources, { id: "logo-visual", label: "Brand-logo comparison", state: "unavailable", note: "No comparable app artwork was available", resultCount: 0 }] };
  }
  const logoImage = await loadComparisonImage(logoDataUrl);
  if (!logoImage) {
    return { ...scan, sources: [...scan.sources, { id: "logo-visual", label: "Brand-logo comparison", state: "unavailable", note: "The uploaded logo could not be decoded in this browser", resultCount: 0 }] };
  }
  const baseHash = imageHash(logoImage);
  if (!baseHash) return { ...scan, sources: [...scan.sources, { id: "logo-visual", label: "Brand-logo comparison", state: "unavailable", note: "Browser image comparison is unavailable", resultCount: 0 }] };
  const compared = await Promise.all(artworkApps.map(async app => {
    const image = app.artwork ? await loadComparisonImage(app.artwork) : null;
    const hash = image ? imageHash(image) : null;
    if (!hash) return app;
    const matches = hash.reduce((total, bit, index) => total + Number(bit === baseHash[index]), 0);
    return { ...app, logoSimilarity: Math.round((matches / hash.length) * 100) };
  }));
  const byId = new Map(compared.map(app => [app.id, app]));
  const apps = scan.apps.map(app => byId.get(app.id) ?? app);
  const visualFindings: Finding[] = compared
    .filter(app => (app.logoSimilarity ?? 0) >= 90 && !app.excluded && !app.likelyOfficial)
    .map(app => ({
      id: `logo-${app.id}`,
      category: "app",
      title: app.title,
      subtitle: app.developer || "Publisher not listed",
      platform: app.store,
      url: app.url,
      riskScore: Math.min(88, 67 + Math.floor(((app.logoSimilarity ?? 90) - 90) / 2)),
      confidence: app.logoSimilarity ?? 90,
      signals: [`App artwork resembles the configured logo (${app.logoSimilarity}%)`, ...(app.developer ? [`Publisher: ${app.developer}`] : ["Publisher is not listed"])],
      evidence: "An in-browser perceptual image hash found a close visual match to the saved brand logo. Review the image and publisher manually; resemblance alone does not establish impersonation.",
      source: "Browser-side app artwork comparison",
    }));
  const loaded = compared.filter(app => app.logoSimilarity !== undefined).length;
  const visualStatus: ScanSource = {
    id: "logo-visual",
    label: "Brand-logo comparison",
    state: loaded === compared.length ? "available" : loaded ? "partial" : "unavailable",
    note: loaded ? `${loaded} app artwork${loaded === 1 ? "" : "s"} compared in this browser; close matches are review leads` : "Store artwork could not be compared in this browser",
    resultCount: loaded,
  };
  const findings = [...scan.findings, ...visualFindings].sort((a, b) => b.riskScore - a.riskScore);
  return { ...scan, apps, findings, sources: [...scan.sources, visualStatus], summary: { ...scan.summary, apps: scan.summary.apps + visualFindings.length } };
}

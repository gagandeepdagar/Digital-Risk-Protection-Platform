import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, BadgeCheck, Bell, Building2, Check,
  ChevronDown, CircleHelp, Clock3, ExternalLink, Eye, FileSearch, Filter, Globe2,
  LayoutDashboard, LoaderCircle, Menu, Network, Plus, Search, Shield, ShieldAlert,
  ShieldCheck, Smartphone, Sparkles, UsersRound, X,
} from "lucide-react";
import ArchitecturePanel from "@/components/ArchitecturePanel";
import BrandProfileDialog from "@/components/BrandProfileDialog";
import {
  EMPTY_PROFILE, compareLogoToApps, readLastScan, readProfile, saveLastScan, saveProfile, scanBrand,
  type BrandProfile, type Finding, type ScanResponse, type SourceState,
} from "@/lib/monitoring";
import "../watchtower.css";

type View = "overview" | "social" | "apps" | "websites" | "profile" | "architecture";
const NAV: { id: View; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "MONITOR" },
  { id: "social", label: "Social profiles", icon: UsersRound, group: "MONITOR" },
  { id: "apps", label: "Apps & stores", icon: Smartphone, group: "MONITOR" },
  { id: "websites", label: "Web & domains", icon: Globe2, group: "MONITOR" },
  { id: "profile", label: "Brand profile", icon: Building2, group: "CONFIGURE" },
  { id: "architecture", label: "How it works", icon: Network, group: "CONFIGURE" },
];
function normalizeBrand(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, ""); }
function stateLabel(state: SourceState) { return state === "available" ? "Available" : state === "partial" ? "Partial" : state === "blocked" ? "Blocked" : "Unavailable"; }

export default function Watchtower() {
  const [profile, setProfile] = useState<BrandProfile>(() => readProfile());
  const [scan, setScan] = useState<ScanResponse | null>(() => readLastScan());
  const [brandInput, setBrandInput] = useState(() => readLastScan()?.brand ?? readProfile().companyName);
  const [view, setView] = useState<View>("overview");
  const [isScanning, setIsScanning] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const [notice, setNotice] = useState("");
  const inputProfileMatches = !!profile.companyName && normalizeBrand(profile.companyName) === normalizeBrand(brandInput || scan?.brand || "");
  const scanProfileMatches = !!profile.companyName && normalizeBrand(profile.companyName) === normalizeBrand(scan?.brand ?? "");

  useEffect(() => { document.title = "Watchtower — Digital Risk Protection"; }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleFindings = useMemo(() => {
    if (!scan) return [];
    if (view === "social") return scan.findings.filter(item => item.category === "social");
    if (view === "apps") return scan.findings.filter(item => item.category === "app");
    if (view === "websites") return scan.findings.filter(item => item.category === "website");
    return scan.findings;
  }, [scan, view]);

  const startScan = async (event?: FormEvent, suggested?: string) => {
    event?.preventDefault();
    const query = (suggested ?? brandInput).trim();
    if (!query) { setScanError("Enter a company or brand name to begin."); return; }
    if (query.length > 120) { setScanError("Brand names must be 120 characters or fewer."); return; }
    setBrandInput(query);
    setScanError("");
    setIsScanning(true);
    setView("overview");
    const applicableProfile = normalizeBrand(profile.companyName) === normalizeBrand(query) ? profile : EMPTY_PROFILE;
    try {
      const rawScan = await scanBrand(query, applicableProfile);
      const result = applicableProfile.logoDataUrl ? await compareLogoToApps(applicableProfile.logoDataUrl, rawScan) : rawScan;
      setScan(result);
      saveLastScan(result);
      setNotice(`Scan complete · ${result.findings.length} review candidate${result.findings.length === 1 ? "" : "s"}`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "The scan could not be completed. Please try again.");
    } finally { setIsScanning(false); }
  };

  const handleSaveProfile = (next: BrandProfile) => {
    saveProfile(next);
    setProfile(next);
    setProfileOpen(false);
    if (!brandInput.trim() || normalizeBrand(brandInput) === normalizeBrand(next.companyName)) setBrandInput(next.companyName);
    setNotice("Brand profile saved in this browser");
  };

  const addToAllowlist = (finding: Finding) => {
    const next: BrandProfile = scanProfileMatches ? { ...profile } : { ...EMPTY_PROFILE, companyName: scan?.brand ?? brandInput };
    if (finding.category === "social") next.officialHandles = Array.from(new Set([...next.officialHandles, finding.url]));
    if (finding.category === "app") {
      next.officialApps = Array.from(new Set([...next.officialApps, finding.title]));
      if (finding.subtitle) next.officialPublishers = Array.from(new Set([...next.officialPublishers, finding.subtitle]));
    }
    if (finding.category === "website") {
      try { next.officialDomains = Array.from(new Set([...next.officialDomains, new URL(finding.url).hostname])); } catch { /* invalid URL is not allowlisted */ }
    }
    try { saveProfile(next); setProfile(next); setNotice("Added to known-good assets. Re-scan to apply the exclusion."); }
    catch { setNotice("Could not save this asset in browser storage."); }
  };

  const activeNav = NAV.find(item => item.id === view);
  const showFindings = view === "overview" || view === "social" || view === "apps" || view === "websites";
  const findingHeading = view === "social" ? "Social profile candidates" : view === "apps" ? "Application candidates" : view === "websites" ? "Website candidates" : "Prioritized review queue";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup"><div className="watchtower-mark"><span /><i /></div><div className="wordmark">WATCHTOWER<span>EXTERNAL RISK</span></div><button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
        <div className="workspace-switcher"><div className="workspace-avatar">{(profile.companyName || "W").slice(0, 1).toUpperCase()}</div><div className="workspace-copy"><strong>{profile.companyName || "Workspace"}</strong><small>{profile.companyName ? "Brand workspace" : "No brand configured"}</small></div><ChevronDown size={14} className="muted-icon" /></div>
        <nav className="side-nav" aria-label="Main navigation">
          {NAV.map((item, index) => { const Icon = item.icon; const showGroup = index === 0 || item.group !== NAV[index - 1].group; return <div key={item.id}>{showGroup && <div className="nav-group-label">{item.group}</div>}<button className={`nav-item ${view === item.id ? "nav-active" : ""}`} onClick={() => { setView(item.id); setMobileNavOpen(false); if (item.id === "profile") setProfileOpen(true); }}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.id === "overview" && scan?.findings.length ? <span className="nav-count">{scan.findings.length}</span> : null}</button></div>; })}
        </nav>
        <div className="sidebar-bottom"><div className="coverage-card"><div className="coverage-icon"><Activity size={15} /></div><div><strong>Public-source coverage</strong><span>Best-effort · not exhaustive</span></div><CircleHelp size={14} /></div><button className="sidebar-help" onClick={() => setView("architecture")}><CircleHelp size={16} />About this prototype<ArrowUpRight size={13} /></button><div className="sidebar-footer"><span className="status-pulse" />Prototype active <span className="footer-version">v0.1</span></div></div>
      </aside>
      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <main className="main-content">
        <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><div className="breadcrumbs"><span>Exposure</span><span className="crumb-slash">/</span><strong>{activeNav?.label ?? "Overview"}</strong></div><div className="topbar-right"><div className="public-badge"><span className="public-dot" />PUBLIC SOURCES</div><button className="icon-button topbar-notice" aria-label="Source coverage notes" onClick={() => setView("architecture")}><Bell size={17} /></button><div className="user-avatar">WT</div></div></header>
        <div className="page-wrap">
          {view === "architecture" ? <ArchitecturePanel onDemo={() => { const example = profile.companyName || "Nike"; setBrandInput(example); void startScan(undefined, example); }} /> : view === "profile" ? <ProfileOverview profile={profile} onEdit={() => setProfileOpen(true)} onScan={() => { setBrandInput(profile.companyName); void startScan(undefined, profile.companyName); }} /> : <>
            <div className="page-heading dashboard-heading"><div><div className="eyebrow"><span className="heading-index">01</span> EXTERNAL EXPOSURE</div><h1>{scan ? <>Brand exposure <span className="heading-muted">/ {scan.brand}</span></> : <>Find look-alikes.<br /><span className="heading-muted">Keep the real ones clear.</span></>}</h1><p>{scan ? "Public-source signals, normalized and prioritized for human review." : "A focused view of social, app-store and web impersonation signals."}</p></div><button className="button button-secondary profile-shortcut" onClick={() => setProfileOpen(true)}><Building2 size={15} />{profile.companyName ? "Edit brand assets" : "Set up brand profile"}<ArrowUpRight size={13} /></button></div>
            <section className="scan-bar-section" aria-label="Start a brand scan"><form className="scan-bar" onSubmit={event => void startScan(event)}><Search size={19} className="scan-search-icon" /><input value={brandInput} onChange={event => { setBrandInput(event.target.value); if (scanError) setScanError(""); }} placeholder="Enter any company or brand name…" aria-label="Company or brand name" maxLength={120} /><div className="scan-bar-hint">SOCIAL <i /> APPS <i /> WEB</div><button className="button button-dark scan-button" disabled={isScanning}>{isScanning ? <><LoaderCircle size={16} className="spin" />Scanning</> : <><span>Run scan</span><ArrowRight size={15} /></>}</button></form>{scanError && <div className="scan-error" role="alert"><AlertTriangle size={14} />{scanError}</div>}<div className="scan-quick-row"><span>Try a live search</span>{["Nike", "Airbnb", "Notion"].map(name => <button key={name} className="quick-search" disabled={isScanning} onClick={() => { setBrandInput(name); void startScan(undefined, name); }}>{name}<ArrowUpRight size={11} /></button>)}<span className="profile-match-note">{profile.companyName ? inputProfileMatches ? <><ShieldCheck size={12} /> Allowlist active for {profile.companyName}</> : <>Profile assets apply when the brand name matches</> : <><Shield size={12} /> Add official assets to reduce false positives</>}</span></div></section>
            {isScanning && <ScanProgress brand={brandInput} />}
            {scan && !isScanning && <ScanSummary scan={scan} profileMatches={scanProfileMatches} />}
            {scan && !isScanning && <SourceHealth sources={scan.sources} />}
            {showFindings && scan && !isScanning ? <section className="results-section"><div className="results-toolbar"><div><div className="eyebrow">SIGNAL REVIEW</div><h2>{findingHeading}<span className="result-total">{visibleFindings.length.toString().padStart(2, "0")}</span></h2></div><div className="results-tools"><span className="sort-note"><Filter size={14} /> Highest priority</span><span className="results-updated"><Clock3 size={13} />{formatTime(scan.searchedAt)}</span></div></div><ResultsView scan={scan} view={view} findings={visibleFindings} onAllowlist={addToAllowlist} onArchitecture={() => setView("architecture")} /></section> : !scan && !isScanning ? <EmptyOverview onProfile={() => setProfileOpen(true)} onArchitecture={() => setView("architecture")} /> : null}
            {scan && !isScanning && <SocialDiscovery scan={scan} onProfile={() => setProfileOpen(true)} />}
            <footer className="page-footer"><span>WATCHTOWER <i>·</i> DIGITAL RISK PROTECTION</span><span>Public intelligence only · candidates require review</span></footer>
          </>}
        </div>
      </main>
      <BrandProfileDialog open={profileOpen} profile={profile} onClose={() => { setProfileOpen(false); if (view === "profile") setView("overview"); }} onSave={handleSaveProfile} />
      {notice && <div className="toast-note" role="status"><Check size={15} />{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}><X size={13} /></button></div>}
    </div>
  );
}

function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Just now" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date); }
function ScanProgress({ brand }: { brand: string }) { return <div className="scan-progress-card"><div className="scan-progress-mark"><LoaderCircle size={18} className="spin" /></div><div className="scan-progress-text"><strong>Searching public sources for {brand || "your brand"}</strong><span>Social profiles, app catalogues and look-alike web results are checked independently.</span></div><span className="scan-progress-tag">LIVE QUERY</span><div className="scan-progress-line"><i /></div></div>; }
function ScanSummary({ scan, profileMatches }: { scan: ScanResponse; profileMatches: boolean }) { const high = scan.findings.filter(item => item.riskScore >= 70).length; return <section className="summary-strip"><div className="summary-brand-mark">{scan.brand.slice(0, 1).toUpperCase()}</div><div className="summary-brand-copy"><div className="eyebrow">SCAN COMPLETE <span className="summary-divider">/</span> {new Date(scan.searchedAt).toLocaleDateString()}</div><h2>{scan.brand}</h2><span>{profileMatches ? "Known-good assets applied" : "No matching allowlist profile applied"}</span></div><div className="summary-stat"><strong>{scan.handles.length.toString().padStart(2, "0")}</strong><span>handle leads</span></div><div className="summary-stat"><strong>{scan.apps.length.toString().padStart(2, "0")}</strong><span>app results</span></div><div className="summary-stat"><strong>{scan.websites.length.toString().padStart(2, "0")}</strong><span>web results</span></div><div className="summary-stat summary-stat-last"><strong>{high.toString().padStart(2, "0")}</strong><span>high priority</span></div></section>; }
function SourceHealth({ sources }: { sources: ScanResponse["sources"] }) { return <section className="source-health"><div className="source-health-head"><span className="eyebrow">SOURCE HEALTH</span><span>Each source runs independently</span></div><div className="source-health-grid">{sources.map(source => <div className="source-health-item" key={source.id}><span className={`health-indicator health-${source.state}`} /><div className="source-health-copy"><strong>{source.label}</strong><span title={source.note}>{source.note}</span></div><span className={`health-state state-${source.state}`}>{stateLabel(source.state)}</span></div>)}</div></section>; }

function ResultsView({ scan, view, findings, onAllowlist, onArchitecture }: { scan: ScanResponse; view: View; findings: Finding[]; onAllowlist: (finding: Finding) => void; onArchitecture: () => void }) {
  const category = view === "social" ? "social" : view === "apps" ? "app" : view === "websites" ? "website" : "all";
  const handles = category === "all" || category === "social" ? scan.handles : [];
  const apps = category === "all" || category === "app" ? scan.apps : [];
  const sites = category === "all" || category === "website" ? scan.websites : [];
  if (!findings.length && !handles.length && !apps.length && !sites.length) return <div className="empty-results"><div className="empty-graphic"><Eye size={21} /></div><div><strong>No candidates surfaced in available sources.</strong><p>This is not proof of absence. Check the source-health states above, configure official assets, or search directly on each platform.</p><button className="text-link" onClick={onArchitecture}>Review source coverage <ArrowRight size={14} /></button></div></div>;
  return <>
    {!!handles.length && <div className="candidate-group"><div className="candidate-group-heading"><div><span className="group-symbol social-symbol"><UsersRound size={15} /></span><strong>Likely social handles</strong><span className="unverified-label">REGISTRY + SEARCH LEADS</span></div><span>{handles.length} results</span></div><div className="handle-grid">{handles.map(handle => <article className={`handle-card ${handle.excluded ? "handle-excluded" : ""}`} key={handle.id}><div className="handle-platform"><span className="platform-monogram">{handle.platform.slice(0,1)}</span><span>{handle.platform}</span>{handle.likelyOfficial && <span className="handle-registry-badge" title="Linked in Wikidata; verify that the profile is current">REGISTRY</span>}{handle.excluded && <BadgeCheck size={14} className="excluded-check" />}</div><div className="handle-title" title={handle.title}>{handle.title || handle.handle}</div><a className="handle-link" href={handle.url} target="_blank" rel="noopener noreferrer">{handle.handle || handle.url}<ExternalLink size={12} /></a><div className="handle-bottom"><span className={`candidate-confidence ${handle.confidence >= 72 ? "confidence-strong" : ""}`}><i />{handle.excluded ? "Allowlisted" : handle.likelyOfficial ? `${handle.confidence}% registry match` : `${handle.confidence}% search match`}</span><a href={handle.sourceUrl} target="_blank" rel="noopener noreferrer" className="evidence-link">Source record <ArrowUpRight size={11} /></a></div><p className="handle-snippet">{handle.snippet || "Public search result. Verify ownership with the brand owner."}</p></article>)}</div></div>}
    {!!findings.length && <div className="finding-list">{findings.map((finding, index) => <FindingCard key={finding.id} finding={finding} index={index + 1} onAllowlist={onAllowlist} />)}</div>}
    {!!apps.length && <div className="candidate-group"><div className="candidate-group-heading"><div><span className="group-symbol app-symbol"><Smartphone size={14} /></span><strong>App catalogue results</strong><span className="unverified-label">PUBLISHER REVIEW</span></div><span>{apps.length} results</span></div><div className="app-results">{apps.map(app => <article className={`app-result ${app.excluded || app.likelyOfficial ? "app-excluded" : ""}`} key={app.id}>{app.artwork ? <img className="app-artwork" src={app.artwork} alt="" loading="lazy" /> : <div className="app-artwork app-artwork-placeholder"><Smartphone size={18} /></div>}<div className="app-result-main"><div className="app-result-name">{app.title}</div><div className="app-developer">{app.developer || "Publisher not listed"} <span>·</span> {app.store}</div>{app.description && <p>{app.description}</p>}</div><div className="app-result-right"><span className={`app-review-pill ${app.excluded || app.likelyOfficial ? "pill-official" : ""} ${app.independentIntegration ? "pill-integration" : ""}`}>{app.excluded ? "ALLOWLISTED" : app.likelyOfficial ? "LIKELY OFFICIAL · CHECK" : app.independentIntegration ? "THIRD-PARTY INTEGRATION" : `${app.confidence}% name match`}</span><a href={app.url} target="_blank" rel="noopener noreferrer" aria-label="Open app store result"><ExternalLink size={15} /></a></div></article>)}</div></div>}
    {!!sites.length && <div className="candidate-group"><div className="candidate-group-heading"><div><span className="group-symbol web-symbol"><Globe2 size={15} /></span><strong>Website & domain leads</strong><span className="unverified-label">REVIEW HOST + CONTENT</span></div><span>{sites.length} results</span></div><div className="site-results">{sites.map(site => <article className={`site-result site-${site.classification}`} key={site.id}><div className="site-result-symbol">{site.classification === "possible-lookalike" ? <ShieldAlert size={16} /> : <Globe2 size={16} />}</div><div className="site-result-copy"><div className="site-title-row"><strong>{site.title}</strong><span className={`site-classification class-${site.classification}`}>{site.classification === "likely-official" ? "LIKELY OFFICIAL · VERIFY" : site.classification === "possible-lookalike" ? "POSSIBLE LOOK-ALIKE" : "REVIEW"}</span></div><a href={site.url} target="_blank" rel="noopener noreferrer">{site.host}<ExternalLink size={11} /></a><p>{site.snippet || "Indexed public result. Review the site and ownership before taking action."}</p></div><div className="site-confidence">{site.confidence}%<small>match</small></div></article>)}</div></div>}
    <div className="method-footnote"><span>i</span><p>Results come from public search indexes and catalogues, not verified platform APIs. “Match confidence” describes relevance to the search term, not identity verification or malicious intent. <button onClick={onArchitecture}>Detection methodology <ArrowUpRight size={11} /></button></p></div>
  </>;
}

function FindingCard({ finding, index, onAllowlist }: { finding: Finding; index: number; onAllowlist: (finding: Finding) => void }) {
  const categoryIcon = finding.category === "social" ? <UsersRound size={15} /> : finding.category === "app" ? <Smartphone size={15} /> : <Globe2 size={15} />;
  const priority = finding.riskScore >= 70 ? "elevated" : finding.riskScore >= 48 ? "watch" : "low";
  return <article className="finding-row"><div className="finding-index">{String(index).padStart(2, "0")}</div><div className="finding-category-icon">{categoryIcon}</div><div className="finding-main"><div className="finding-title-row"><a className="finding-title" href={finding.url} target="_blank" rel="noopener noreferrer">{finding.title}<ArrowUpRight size={12} /></a><span className={`priority-label priority-${priority}`}><i />{priority === "elevated" ? "Elevated review" : priority === "watch" ? "Needs review" : "Low signal"}</span></div><div className="finding-subtitle">{finding.platform}{finding.subtitle ? ` · ${finding.subtitle}` : ""}</div><div className="signal-list">{finding.signals.map(signal => <span key={signal}>{signal}</span>)}</div><p className="finding-evidence">{finding.evidence}</p></div><div className="finding-confidence"><div className="score-number">{finding.riskScore}<small>/100</small></div><span>Priority score</span><div className="confidence-track"><i style={{ width: `${finding.riskScore}%` }} /></div><small>{finding.confidence}% match confidence</small></div><div className="finding-actions"><a href={finding.url} target="_blank" rel="noopener noreferrer" className="icon-button" aria-label="Open evidence"><ExternalLink size={15} /></a><button className="icon-button allowlist-button" onClick={() => onAllowlist(finding)} title="Mark as an official asset" aria-label="Mark as an official asset"><Check size={15} /></button></div></article>;
}

function SocialDiscovery({ scan, onProfile }: { scan: ScanResponse; onProfile: () => void }) {
  return <section className="discovery-section"><div className="discovery-heading"><div><div className="eyebrow">DISCOVERY COVERAGE</div><h2>What this scan can — and can’t — see.</h2></div><button className="text-link" onClick={onProfile}>Configure known assets <ArrowRight size={13} /></button></div><div className="discovery-cards"><div className="discovery-card"><span className="discovery-index">01</span><div className="discovery-icon"><ShieldCheck size={16} /></div><strong>Known-good exclusion</strong><p>Exact configured social handles, official apps, publishers and brand domains stay out of the suspicious queue.</p><span className="coverage-available">Allowlist-first detection</span></div><div className="discovery-card"><span className="discovery-index">02</span><div className="discovery-icon"><FileSearch size={16} /></div><strong>Live catalogue & index</strong><p>Social profiles and web pages are discovered through public search. App names and publishers come from available app catalogues.</p><span className={scan.apps.length ? "coverage-available" : "coverage-waiting"}>{scan.apps.length ? `${scan.apps.length} app listing${scan.apps.length === 1 ? "" : "s"} surfaced` : "App-store source may be unavailable"}</span></div><div className="discovery-card"><span className="discovery-index">03</span><div className="discovery-icon"><Eye size={16} /></div><strong>Human decision</strong><p>Review the destination, publisher and evidence. Similarity flags a lead for investigation; it never proves abuse.</p><span className="coverage-available">Evidence stays attached</span></div></div></section>;
}

function EmptyOverview({ onProfile, onArchitecture }: { onProfile: () => void; onArchitecture: () => void }) {
  return <><section className="empty-start"><div className="empty-start-left"><span className="empty-orbit"><span className="orbit-dot" /><Shield size={30} strokeWidth={1.4} /></span><div className="eyebrow">A CLEARER EXTERNAL VIEW</div><h2>Know who’s using<br />your brand in the wild.</h2><p>Search public social profiles, app catalogues and web results for likely matches and look-alike leads. Every source reports its coverage, and every finding carries context.</p><div className="empty-start-actions"><button className="button button-dark" onClick={onArchitecture}>See how it works <ArrowRight size={14} /></button><button className="button button-secondary" onClick={onProfile}><Plus size={15} />Set up brand profile</button></div></div><div className="empty-start-right"><div className="sample-window-top"><span /><span /><span /><div>MONITORING PIPELINE</div><span className="window-tag">IDLE</span></div><div className="sample-flow"><div className="flow-line" /><div className="flow-node"><div className="flow-node-icon"><Building2 size={15} /></div><div><strong>Brand identity</strong><small>Official assets + aliases</small></div><Check size={13} /></div><div className="flow-node flow-node-dim"><div className="flow-node-icon"><Search size={15} /></div><div><strong>Public discovery</strong><small>Social · apps · websites</small></div><span className="flow-dots">···</span></div><div className="flow-node flow-node-dim"><div className="flow-node-icon"><Activity size={15} /></div><div><strong>Analyst review</strong><small>Evidence-led prioritization</small></div><span className="flow-dots">···</span></div></div><div className="sample-window-bottom"><span>Waiting for a brand query</span><span>0 / 3 SOURCES</span></div></div></section><div className="empty-value-row"><span><ShieldCheck size={15} />Official assets excluded</span><span><Activity size={15} />Look-alike name signals</span><span><Globe2 size={15} />Website and app discovery</span><span><CircleHelp size={15} />Unavailable sources stay visible</span></div></>;
}

function ProfileOverview({ profile, onEdit, onScan }: { profile: BrandProfile; onEdit: () => void; onScan: () => void }) {
  const groups = [
    { label: "Official domains", values: profile.officialDomains, icon: Globe2 },
    { label: "Social accounts", values: profile.officialHandles, icon: Shield },
    { label: "Official apps", values: profile.officialApps, icon: Smartphone },
    { label: "Trusted publishers", values: profile.officialPublishers, icon: Building2 },
    { label: "Brand identifiers", values: profile.identifiers, icon: Sparkles },
  ];
  const count = groups.reduce((sum, item) => sum + item.values.length, 0);
  return <div className="profile-page"><div className="page-heading"><div><div className="eyebrow">ASSET REGISTRY</div><h1>Brand profile</h1><p>Trusted identifiers guide detection and are excluded before scoring.</p></div><div className="profile-page-actions"><button className="button button-secondary" onClick={onEdit}><Building2 size={15} />Edit profile</button>{profile.companyName && <button className="button button-dark" onClick={onScan}><Search size={15} />Scan this brand</button>}</div></div><section className="profile-summary-card"><div className="profile-logo-large">{profile.logoDataUrl ? <img src={profile.logoDataUrl} alt="" /> : profile.companyName ? profile.companyName.slice(0, 1).toUpperCase() : <Building2 size={22} />}</div><div className="profile-summary-copy"><span className="eyebrow">ACTIVE BRAND</span><h2>{profile.companyName || "No brand profile yet"}</h2><p>{profile.companyName ? "Assets are saved locally in this browser." : "Add official identifiers to reduce false positives during monitoring."}</p></div><div className="profile-assets-count"><strong>{count.toString().padStart(2, "0")}</strong><span>known-good assets</span></div></section><div className="asset-categories">{groups.map(category => { const Icon = category.icon; return <section className="asset-category-card" key={category.label}><div className="asset-category-head"><Icon size={16} /><strong>{category.label}</strong><span>{category.values.length}</span></div>{category.values.length ? <ul>{category.values.map(value => <li key={value}><span className="asset-check"><Check size={12} /></span>{value}</li>)}</ul> : <div className="asset-empty">No assets added</div>}</section>; })}</div><div className="profile-exclusion-note"><ShieldCheck size={17} /><p><strong>Allowlist-first detection.</strong> Exact matches against your listed handles, apps, publishers and domains are removed before a risk score is calculated. A different spelling is never silently trusted.</p></div></div>;
}

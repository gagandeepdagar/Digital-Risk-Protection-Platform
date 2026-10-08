import { ArrowDown, ArrowRight, ArrowUpRight, Building2, Database, Globe2, Search, ShieldCheck, Signal, Smartphone, UsersRound } from "lucide-react";

type Props = { onDemo: () => void };

const sources = [
  { icon: Globe2, label: "Public web index", note: "Social · websites · Play Store index" },
  { icon: Building2, label: "Wikidata brand registry", note: "Public social links · official sites" },
  { icon: Smartphone, label: "Apple catalogue", note: "iTunes Search API" },
  { icon: Database, label: "Certificate records", note: "Configured official domains" },
];

export default function ArchitecturePanel({ onDemo }: Props) {
  return (
    <div className="architecture-page">
      <div className="page-heading architecture-heading">
        <div><div className="eyebrow">SYSTEM DESIGN</div><h1>How signals become leads.</h1><p>A transparent path from public discovery to human review.</p></div>
        <button className="button button-dark" onClick={onDemo}><Search size={15} /> Run a live example</button>
      </div>
      <section className="architecture-card">
        <div className="architecture-title"><div><div className="eyebrow">ARCHITECTURE</div><h2>Public-source monitoring pipeline</h2></div><span className="architecture-tag"><Signal size={13} /> BEST-EFFORT SOURCES</span></div>
        <div className="pipeline">
          <div className="pipeline-row pipeline-input">
            <div className="pipeline-node profile-node"><div className="pipeline-icon"><UsersRound size={17} /></div><div><strong>Brand profile</strong><small>Known-good handles, apps, domains</small></div></div>
            <div className="pipeline-node request-node"><div className="pipeline-icon"><Search size={17} /></div><div><strong>Any-brand query</strong><small>Public discovery, scoped and time-bound</small></div></div>
          </div>
          <div className="pipeline-connector"><ArrowDown size={17} /><span>Parallel source adapters · independent timeouts</span></div>
          <div className="source-node-grid">{sources.map(source => { const Icon = source.icon; return <div className="pipeline-node source-node" key={source.label}><div className="pipeline-icon"><Icon size={16} /></div><div><strong>{source.label}</strong><small>{source.note}</small></div></div>; })}</div>
          <div className="pipeline-connector"><ArrowDown size={17} /><span>Normalize · de-duplicate · preserve evidence links</span></div>
          <div className="pipeline-row pipeline-output">
            <div className="pipeline-node pipeline-wide"><div className="pipeline-icon"><ShieldCheck size={17} /></div><div><strong>Allowlist exclusion</strong><small>Exact handles, app names, trusted publishers and official domains stay out of the suspicious queue.</small></div></div>
            <div className="pipeline-inline-arrow"><ArrowRight size={16} /></div>
            <div className="pipeline-node scoring-node"><div className="pipeline-icon"><Signal size={17} /></div><div><strong>Similarity + risk signals</strong><small>Look-alike spelling, publisher difference, risky words and source evidence.</small></div></div>
          </div>
          <div className="pipeline-connector"><ArrowDown size={17} /><span>Candidate score ≠ proof of abuse or ownership</span></div>
          <div className="pipeline-node result-node"><div className="pipeline-icon"><Search size={17} /></div><div><strong>Analyst review</strong><small>Likely handles · apps · possible look-alike sites · source health · evidence</small></div></div>
          <div className="storage-note"><Database size={14} /><span>Profiles and the last scan are stored in local browser storage for this prototype; nothing is sent to a shared account database.</span></div>
        </div>
      </section>
      <div className="architecture-bottom-grid">
        <section className="method-card"><div className="eyebrow">DETECTION LOGIC</div><h2>Signals, not assumptions.</h2><p>Similarity is only one clue. A close spelling, a changed publisher, support-themed wording, or a domain that resembles a configured brand domain can raise review priority. Official assets entered in the profile are matched before scoring. A search result is never described as verified simply because it appeared near the top.</p><div className="method-rules"><span><i className="rule-dot rule-solid" /> Exact allowlist match <b>Excluded</b></span><span><i className="rule-dot rule-outline" /> Similar name only <b>Low confidence</b></span><span><i className="rule-dot rule-dash" /> Source not responding <b>Shown as unavailable</b></span></div></section>
        <section className="demo-card"><div className="eyebrow">SHORT DEMO</div><h2>Three-minute walkthrough.</h2><ol className="demo-steps"><li><span>01</span><div><strong>Define the brand</strong><small>Enter its official domain, social handles, apps and trusted publishers.</small></div></li><li><span>02</span><div><strong>Run a public-source scan</strong><small>Try a known brand name. Watch each data source report its own status.</small></div></li><li><span>03</span><div><strong>Triage with evidence</strong><small>Review likely handles separately from candidates; allowlist legitimate assets and re-scan.</small></div></li></ol><button className="text-link" onClick={onDemo}>Start the live walkthrough <ArrowUpRight size={14} /></button></section>
      </div>
      <div className="scope-disclaimer"><span className="disclaimer-mark">i</span><p><strong>Coverage boundary</strong> Public web indexes can be delayed, incomplete, or blocked. Wikidata links may be stale and should be checked at the destination. App artwork can be compared with an uploaded logo locally in the browser; full social-profile image collection and platform-wide authenticated monitoring are not available to this prototype. It does not inspect private accounts, verify badges, prove malicious intent, or file takedown requests.</p></div>
    </div>
  );
}

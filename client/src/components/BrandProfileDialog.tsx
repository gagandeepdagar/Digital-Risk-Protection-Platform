import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { EMPTY_PROFILE, parseLines, type BrandProfile } from "@/lib/monitoring";

type Props = {
  open: boolean;
  profile: BrandProfile;
  onClose: () => void;
  onSave: (profile: BrandProfile) => void;
};

export default function BrandProfileDialog({ open, profile, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<BrandProfile>(profile);
  const [error, setError] = useState("");
  const [logoLabel, setLogoLabel] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(profile);
      setError("");
      setLogoLabel("");
    }
  }, [open, profile]);

  if (!open) return null;

  const lines = (items: string[]) => items.join("\n");
  const setText = (key: keyof BrandProfile, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const setList = (key: "officialDomains" | "officialHandles" | "officialApps" | "officialPublishers" | "identifiers", value: string) =>
    setDraft(current => ({ ...current, [key]: parseLines(value) }));

  const handleLogo = (file?: File) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, WebP, or other image file.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Logo files must be 1 MB or smaller so the profile can be saved safely in this browser.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft(current => ({ ...current, logoDataUrl: String(reader.result ?? "") }));
      setLogoLabel(file.name);
    };
    reader.onerror = () => setError("The logo could not be read. Try another image.");
    reader.readAsDataURL(file);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.companyName.trim();
    if (!name) {
      setError("Add a company or brand name to save this profile.");
      return;
    }
    if (name.length > 120) {
      setError("Keep the brand name under 120 characters.");
      return;
    }
    const invalidDomain = draft.officialDomains.find(value => {
      const host = value.trim().replace(/^https?:\/\//i, "").split(/[/:?#]/)[0]?.replace(/^www\./i, "") ?? "";
      return !/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host);
    });
    if (invalidDomain) {
      setError(`Check the official domain “${invalidDomain}”. Enter a hostname such as example.com.`);
      return;
    }
    const invalidHandle = draft.officialHandles.find(value => {
      const handle = value.trim();
      if (handle.startsWith("@")) return !/^@[a-z0-9_.-]{2,80}$/i.test(handle);
      try {
        const parsed = new URL(handle.includes("://") ? handle : `https://${handle}`);
        return !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".") || !!parsed.username || !!parsed.password;
      } catch { return true; }
    });
    if (invalidHandle) {
      setError(`Check the social account “${invalidHandle}”. Enter a profile URL or a simple @handle.`);
      return;
    }
    const profileToSave = { ...EMPTY_PROFILE, ...draft, companyName: name };
    try {
      onSave(profileToSave);
    } catch {
      setError("This browser could not save the profile. Remove a large logo and try again.");
    }
  };

  return (
    <div className="dialog-scrim" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="dialog-header">
          <div>
            <div className="eyebrow">ASSET REGISTRY</div>
            <h2 id="profile-title">Brand profile</h2>
            <p>Known-good assets are excluded from the review queue.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close profile editor" onClick={onClose}><X size={18} /></button>
        </header>
        <form onSubmit={submit} className="profile-form">
          <label className="field-label">Company or brand name <span>Required</span>
            <input autoFocus maxLength={120} value={draft.companyName} onChange={event => setText("companyName", event.target.value)} placeholder="e.g. Northstar Studio" />
          </label>
          <div className="logo-field">
            <div className="logo-preview">{draft.logoDataUrl ? <img src={draft.logoDataUrl} alt="Brand logo preview" /> : <ImagePlus size={20} />}</div>
            <div className="logo-copy"><strong>Official logo</strong><span>Image recognition is represented by the profile asset. Maximum 1 MB.</span></div>
            <label className="button button-secondary file-button">{draft.logoDataUrl ? "Replace logo" : "Upload logo"}<input type="file" accept="image/*" onChange={event => handleLogo(event.target.files?.[0])} /></label>
            {draft.logoDataUrl && <button className="text-button remove-logo" type="button" onClick={() => { setDraft(current => ({ ...current, logoDataUrl: "" })); setLogoLabel(""); }}>Remove</button>}
          </div>
          {logoLabel && <div className="field-hint">Selected: {logoLabel}</div>}
          <label className="field-label">Official domains <span>One per line</span>
            <textarea rows={2} value={lines(draft.officialDomains)} onChange={event => setList("officialDomains", event.target.value)} placeholder="northstar.example" />
          </label>
          <label className="field-label">Official social accounts <span>URLs or @handles</span>
            <textarea rows={3} value={lines(draft.officialHandles)} onChange={event => setList("officialHandles", event.target.value)} placeholder="https://instagram.com/northstar\n@northstarhq" />
          </label>
          <div className="form-row">
            <label className="field-label">Official app names <span>One per line</span>
              <textarea rows={3} value={lines(draft.officialApps)} onChange={event => setList("officialApps", event.target.value)} placeholder="Northstar — Official App" />
            </label>
            <label className="field-label">Trusted publishers <span>One per line</span>
              <textarea rows={3} value={lines(draft.officialPublishers)} onChange={event => setList("officialPublishers", event.target.value)} placeholder="Northstar Labs, Inc." />
            </label>
          </div>
          <label className="field-label">Brand identifiers <span>Aliases, product names, bundle IDs</span>
            <textarea rows={2} value={lines(draft.identifiers)} onChange={event => setList("identifiers", event.target.value)} placeholder="Northstar Pay\ncom.northstar.mobile" />
          </label>
          <div className="profile-local-note"><span className="note-mark" />Saved in this browser only. Cross-device sharing and account access are not enabled in this prototype.</div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <footer className="dialog-actions">
            <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-dark" type="submit">Save brand profile</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

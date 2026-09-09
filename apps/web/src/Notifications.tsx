import { useEffect, useState } from "react";
import { Link } from "react-router";
import { messageFor, requestJson } from "./api.js";
import { paths } from "./route.js";

interface Settings {
  emailEnabled: boolean;
  emailTo: string;
  digestHours: number;
  minScore: number;
  immediateScore: number | null;
  webhookEnabled: boolean;
  webhookUrl: string;
  webhookMode: "match" | "digest";
}
/** The account's signing secret, as the screen may see it. US-096. */
interface SigningSecret {
  /** `••••1234`, or null when this account has none of its own. */
  hint: string | null;
  usingInstanceSecret: boolean;
  canStore: boolean;
  storeBlocker: string | null;
  updatedAt: string | null;
}

interface Response {
  settings: Settings;
  smtpMissing: string[];
  webhookMissing: string[];
  emailError: string | null;
  webhookError: string | null;
  nextDigestAt: string | null;
  signingSecret: SigningSecret;
}

export function Notifications({
  monitorId,
  projectId,
}: {
  readonly monitorId: string;
  readonly projectId: string;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /**
   * The secret, held only while this page is open. US-096.
   *
   * It is never read back from the server: the generate route is the one
   * response that carries the value, and a page that could re-display it is a
   * page that leaks it with a screenshot.
   */
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    requestJson<Response>(`/api/monitors/${monitorId}/notifications`)
      .then((value) => {
        if (active) {
          setData(value);
          setSettings(value.settings);
        }
      })
      .catch((cause) => {
        if (active) setError(messageFor(cause, "Notification settings could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [monitorId]);
  function update(patch: Partial<Settings>) {
    setSettings((current) => current && { ...current, ...patch });
    setSaved(false);
  }
  /**
   * Ask for a secret and show it, once. US-096.
   *
   * The response is the only one that ever carries the value, so it is held in
   * state and never fetched again. Nothing is saved by this: the readiness the
   * server returns is folded back in, which is what lets the webhook switch
   * become usable without a reload.
   */
  async function generateSecret() {
    setBusy(true);
    setError(null);
    try {
      const value = await requestJson<{ secret: string; signingSecret: SigningSecret }>(
        "/api/notifications/signing-secret",
        { method: "POST" },
      );
      setFreshSecret(value.secret);
      setData(
        (current) =>
          current && {
            ...current,
            signingSecret: value.signingSecret,
            // The account can sign now, so the switch stops being refused.
            webhookMissing: [],
          },
      );
    } catch (cause) {
      setError(messageFor(cause, "A signing secret could not be generated."));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const value = await requestJson<Response>(`/api/monitors/${monitorId}/notifications`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      setData(value);
      setSettings(value.settings);
      setSaved(true);
    } catch (cause) {
      setError(messageFor(cause, "Notification settings could not be saved."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Monitor settings</p>
          <h1>Notifications</h1>
        </div>
        <Link className="text-link" to={paths.monitors(projectId)}>
          Back to monitors
        </Link>
      </header>
      <div className="notification-panel">
        {error && <p role="alert">{error}</p>}
        {!settings && !error && <p role="status">Loading notifications…</p>}
        {settings && data && (
          <form onSubmit={(event) => void save(event)}>
            <p>
              Receive a digest of new matches. Add immediate email alerts for the scores you want to
              see sooner.
            </p>
            {data.emailError && <p role="alert">{data.emailError}</p>}
            {data.webhookError && <p role="alert">{data.webhookError}</p>}
            <fieldset disabled={busy}>
              <legend>Digest</legend>
              <label>
                Digest interval (hours)
                <input
                  type="number"
                  min="1"
                  max="168"
                  required
                  value={settings.digestHours}
                  onChange={(event) => update({ digestHours: Number(event.target.value) })}
                />
              </label>
              <label>
                Minimum score
                <input
                  type="number"
                  min="0"
                  max="100"
                  required
                  value={settings.minScore}
                  onChange={(event) => update({ minScore: Number(event.target.value) })}
                />
              </label>
              <p>Quiet periods send nothing. Immediate alerts also appear in the next digest.</p>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Email</legend>
              {data.smtpMissing.length > 0 && (
                <p role="status">
                  Email is unavailable. Set {data.smtpMissing.join(", ")} and restart the API and
                  worker. The inbox still works.
                </p>
              )}
              <label className="notification-check">
                <input
                  type="checkbox"
                  checked={settings.emailEnabled}
                  disabled={data.smtpMissing.length > 0 && !settings.emailEnabled}
                  onChange={(event) => update({ emailEnabled: event.target.checked })}
                />
                Email digest
              </label>
              <label>
                Recipient email
                <input
                  type="email"
                  required={settings.emailEnabled}
                  value={settings.emailTo}
                  onChange={(event) => update({ emailTo: event.target.value })}
                />
              </label>
              <label className="notification-check">
                <input
                  type="checkbox"
                  checked={settings.immediateScore !== null}
                  onChange={(event) => update({ immediateScore: event.target.checked ? 90 : null })}
                />
                Immediate email alerts
              </label>
              {settings.immediateScore !== null && (
                <label>
                  Immediate alert score
                  <input
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={settings.immediateScore}
                    onChange={(event) => update({ immediateScore: Number(event.target.value) })}
                  />
                </label>
              )}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Webhook</legend>
              {data.webhookMissing.length > 0 && (
                <p role="status">
                  Set {data.webhookMissing.join(", ")} and restart the API and worker to enable
                  signed webhooks, or make a signing secret for this account below.
                </p>
              )}
              <div className="notification-secret">
                <p>
                  Every delivery is signed with a secret, and your receiver verifies the
                  <code> X-SignalScout-Signature</code> header with the same value. It belongs to
                  your account and every monitor you own uses it.
                </p>
                {freshSecret ? (
                  <p role="status">
                    <strong>Copy this now. It is not shown again.</strong>
                    <output>{freshSecret}</output>
                  </p>
                ) : data.signingSecret.hint ? (
                  <p>
                    A secret is set for this account, ending <code>{data.signingSecret.hint}</code>.
                  </p>
                ) : data.signingSecret.usingInstanceSecret ? (
                  <p>
                    Signing with this instance&rsquo;s own <code>WEBHOOK_SIGNING_SECRET</code>. Make
                    one for your account to sign with a value nobody else here holds.
                  </p>
                ) : (
                  <p>No secret yet, so nothing can be delivered.</p>
                )}
                {data.signingSecret.storeBlocker && (
                  <p role="status">{data.signingSecret.storeBlocker}</p>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!data.signingSecret.canStore || busy}
                  onClick={generateSecret}
                >
                  {data.signingSecret.hint ? "Generate a new secret" : "Generate a secret"}
                </button>
                {data.signingSecret.hint && (
                  <p>
                    Generating a new one stops every receiver configured with the old value from
                    verifying, until you give them the new one.
                  </p>
                )}
              </div>
              <label className="notification-check">
                <input
                  type="checkbox"
                  checked={settings.webhookEnabled}
                  disabled={data.webhookMissing.length > 0 && !settings.webhookEnabled}
                  onChange={(event) => update({ webhookEnabled: event.target.checked })}
                />
                Enable webhook
              </label>
              <label>
                Webhook URL
                <input
                  type="url"
                  placeholder="https://example.com/webhook"
                  required={settings.webhookEnabled}
                  value={settings.webhookUrl}
                  onChange={(event) => update({ webhookUrl: event.target.value })}
                />
              </label>
              <label>
                Webhook delivery
                <select
                  value={settings.webhookMode}
                  onChange={(event) =>
                    update({ webhookMode: event.target.value as Settings["webhookMode"] })
                  }
                >
                  <option value="digest">Digest</option>
                  <option value="match">Each match above the minimum score</option>
                </select>
              </label>
            </fieldset>
            <p>
              Saving starts a new period with future matches and cancels pending deliveries from the
              previous settings.
            </p>
            {data.nextDigestAt && (
              <p>Next digest: {new Date(data.nextDigestAt).toLocaleString()}</p>
            )}
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save notifications"}
            </button>
            {saved && <p role="status">Notification settings saved.</p>}
          </form>
        )}
      </div>
    </>
  );
}

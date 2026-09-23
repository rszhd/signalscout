import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { messageFor, requestJson } from "./api.js";
import { Button } from "./components/Button.js";
import { Field } from "./components/Field.js";

/**
 * A monitor's notification settings: the digest, email and a signed webhook.
 * US-354.
 *
 * A whole screen, like `ReplyVoices`: both products read and write the same
 * two routes, `/api/monitors/:id/notifications` and
 * `/api/notifications/signing-secret`. What only one API sends is optional
 * here. Self-hosted, an account may be barred from storing a secret
 * (`canStore`, `storeBlocker`), and a webhook may be signed with the
 * instance's own secret; the page says that through `signingNotice`.
 */

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

/** The account's signing secret, as the screen may see it. */
export interface SigningSecret {
  /** `••••1234`, or null when this account has none of its own. */
  hint: string | null;
  updatedAt: string | null;
  /** Self-hosted only: deliveries are signed with the instance's secret. */
  usingInstanceSecret?: boolean;
  /** Self-hosted only: whether this account may store a secret at all. */
  canStore?: boolean;
  /** Self-hosted only: why it may not. */
  storeBlocker?: string | null;
}

interface NotificationsResponse {
  settings: Settings;
  smtpMissing: string[];
  webhookMissing: string[];
  emailError: string | null;
  webhookError: string | null;
  nextDigestAt: string | null;
  signingSecret: SigningSecret;
}

export interface NotificationsProps {
  readonly monitorId: string;
  /** The monitor page, for the breadcrumb and the way back. */
  readonly monitorHref: string;
  /** Said in place of "No secret yet" when the account has none of its own. */
  readonly signingNotice?: (secret: SigningSecret) => ReactNode;
}

export function Notifications({ monitorId, monitorHref, signingNotice }: NotificationsProps) {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /**
   * The secret, held only while this page is open. It is never read back
   * from the server: the generate route is the one response that carries the
   * value, and a page that could re-display it leaks it with a screenshot.
   */
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    requestJson<NotificationsResponse>(`/api/monitors/${monitorId}/notifications`)
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
   * Ask for a secret and show it, once. Nothing is saved by this: the
   * readiness the server returns is folded back in, which is what lets the
   * webhook switch become usable without a reload.
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

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const value = await requestJson<NotificationsResponse>(
        `/api/monitors/${monitorId}/notifications`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        },
      );
      setData(value);
      setSettings(value.settings);
      setSaved(true);
    } catch (cause) {
      setError(messageFor(cause, "Notification settings could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const secret = data?.signingSecret;

  return (
    <div className="product-page notifications-page">
      <header className="topbar">
        <div>
          <p className="notification-breadcrumb">
            <Link to={monitorHref}>Monitor</Link> · Notifications
          </p>
          <h1>Notifications</h1>
          <p className="page-subtitle">Choose when and where this monitor sends new matches.</p>
        </div>
        <Link className="top-secondary-link" to={monitorHref}>
          Back to monitor
        </Link>
      </header>
      <div className="notifications-content">
        <div className="notification-panel">
          {error && !settings && <p role="alert">{error}</p>}
          {!settings && !error && <p role="status">Loading notifications…</p>}
          {settings && data && secret && (
            <form onSubmit={(event) => void save(event)}>
              <p className="notification-intro">
                Receive a digest of new matches. Add immediate email alerts for the scores you want
                to see sooner.
              </p>
              <fieldset className="notification-section notification-digest" disabled={busy}>
                <legend>Digest</legend>
                <Field label="Digest interval (hours)">
                  <input
                    type="number"
                    min="1"
                    max="168"
                    required
                    value={settings.digestHours}
                    onChange={(event) => update({ digestHours: Number(event.target.value) })}
                  />
                </Field>
                <Field label="Minimum score">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={settings.minScore}
                    onChange={(event) => update({ minScore: Number(event.target.value) })}
                  />
                </Field>
                <p className="notification-section-note">
                  Quiet periods send nothing. Immediate alerts also appear in the next digest.
                </p>
              </fieldset>
              <fieldset className="notification-section notification-email" disabled={busy}>
                <legend>Email</legend>
                {data.emailError && <p role="alert">{data.emailError}</p>}
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
                <Field label="Recipient email">
                  <input
                    type="email"
                    required={settings.emailEnabled}
                    value={settings.emailTo}
                    onChange={(event) => update({ emailTo: event.target.value })}
                  />
                </Field>
                <label className="notification-check">
                  <input
                    type="checkbox"
                    checked={settings.immediateScore !== null}
                    onChange={(event) =>
                      update({ immediateScore: event.target.checked ? 90 : null })
                    }
                  />
                  Immediate email alerts
                </label>
                {settings.immediateScore !== null && (
                  <Field label="Immediate alert score">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      required
                      value={settings.immediateScore}
                      onChange={(event) => update({ immediateScore: Number(event.target.value) })}
                    />
                  </Field>
                )}
              </fieldset>
              <fieldset className="notification-section notification-webhook" disabled={busy}>
                <legend>Webhook</legend>
                {data.webhookError && <p role="alert">{data.webhookError}</p>}
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
                  ) : secret.hint ? (
                    <p>
                      A secret is set for this account, ending <code>{secret.hint}</code>.
                    </p>
                  ) : (
                    (signingNotice?.(secret) ?? <p>No secret yet, so nothing can be delivered.</p>)
                  )}
                  {secret.storeBlocker && <p role="status">{secret.storeBlocker}</p>}
                  <Button disabled={secret.canStore === false || busy} onClick={generateSecret}>
                    {secret.hint ? "Generate a new secret" : "Generate a secret"}
                  </Button>
                  {secret.hint && (
                    <p>
                      Generating a new one stops every receiver configured with the old value from
                      verifying, until you give them the new one.
                    </p>
                  )}
                </div>
                <div className="notification-webhook-controls">
                  <label className="notification-check">
                    <input
                      type="checkbox"
                      checked={settings.webhookEnabled}
                      disabled={data.webhookMissing.length > 0 && !settings.webhookEnabled}
                      onChange={(event) => update({ webhookEnabled: event.target.checked })}
                    />
                    Enable webhook
                  </label>
                  <Field label="Webhook URL">
                    <input
                      type="url"
                      placeholder="https://example.com/webhook"
                      required={settings.webhookEnabled}
                      value={settings.webhookUrl}
                      onChange={(event) => update({ webhookUrl: event.target.value })}
                    />
                  </Field>
                  <Field label="Webhook delivery">
                    <select
                      value={settings.webhookMode}
                      onChange={(event) =>
                        update({ webhookMode: event.target.value as Settings["webhookMode"] })
                      }
                    >
                      <option value="digest">Digest</option>
                      <option value="match">Each match above the minimum score</option>
                    </select>
                  </Field>
                </div>
              </fieldset>
              <div className="notification-save-bar">
                <div>
                  <p>
                    Saving starts a new period with future matches and cancels pending deliveries
                    from the previous settings.
                  </p>
                  {data.nextDigestAt && (
                    <p>Next digest: {new Date(data.nextDigestAt).toLocaleString()}</p>
                  )}
                  {error && <p role="alert">{error}</p>}
                  {saved && <p role="status">Notification settings saved.</p>}
                </div>
                <Button variant="primary" disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save notifications"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

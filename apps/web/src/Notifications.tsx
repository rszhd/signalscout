import { useEffect, useState } from "react";
import { messageFor, requestJson } from "./api.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { NativeSelect } from "./components/ui/native-select.js";
import { projectSuffix } from "./route.js";

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
interface Response {
  settings: Settings;
  smtpMissing: string[];
  webhookMissing: string[];
  emailError: string | null;
  webhookError: string | null;
  nextDigestAt: string | null;
}

export function Notifications({ monitorId }: { monitorId: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
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
        <a className="text-link" href={`#/monitors${projectSuffix()}`}>
          Back to monitors
        </a>
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
              <Label>
                Digest interval (hours)
                <Input
                  type="number"
                  min="1"
                  max="168"
                  required
                  value={settings.digestHours}
                  onChange={(event) => update({ digestHours: Number(event.target.value) })}
                />
              </Label>
              <Label>
                Minimum score
                <Input
                  type="number"
                  min="0"
                  max="100"
                  required
                  value={settings.minScore}
                  onChange={(event) => update({ minScore: Number(event.target.value) })}
                />
              </Label>
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
              <Label className="notification-check">
                <input
                  type="checkbox"
                  checked={settings.emailEnabled}
                  disabled={data.smtpMissing.length > 0 && !settings.emailEnabled}
                  onChange={(event) => update({ emailEnabled: event.target.checked })}
                />
                Email digest
              </Label>
              <Label>
                Recipient email
                <Input
                  type="email"
                  required={settings.emailEnabled}
                  value={settings.emailTo}
                  onChange={(event) => update({ emailTo: event.target.value })}
                />
              </Label>
              <Label className="notification-check">
                <input
                  type="checkbox"
                  checked={settings.immediateScore !== null}
                  onChange={(event) => update({ immediateScore: event.target.checked ? 90 : null })}
                />
                Immediate email alerts
              </Label>
              {settings.immediateScore !== null && (
                <Label>
                  Immediate alert score
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={settings.immediateScore}
                    onChange={(event) => update({ immediateScore: Number(event.target.value) })}
                  />
                </Label>
              )}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Webhook</legend>
              {data.webhookMissing.length > 0 && (
                <p role="status">
                  Set {data.webhookMissing.join(", ")} and restart the API and worker to enable
                  signed webhooks.
                </p>
              )}
              <Label className="notification-check">
                <input
                  type="checkbox"
                  checked={settings.webhookEnabled}
                  disabled={data.webhookMissing.length > 0 && !settings.webhookEnabled}
                  onChange={(event) => update({ webhookEnabled: event.target.checked })}
                />
                Enable webhook
              </Label>
              <Label>
                Webhook URL
                <Input
                  type="url"
                  placeholder="https://example.com/webhook"
                  required={settings.webhookEnabled}
                  value={settings.webhookUrl}
                  onChange={(event) => update({ webhookUrl: event.target.value })}
                />
              </Label>
              <Label>
                Webhook delivery
                <NativeSelect
                  value={settings.webhookMode}
                  onChange={(event) =>
                    update({ webhookMode: event.target.value as Settings["webhookMode"] })
                  }
                >
                  <option value="digest">Digest</option>
                  <option value="match">Each match above the minimum score</option>
                </NativeSelect>
              </Label>
            </fieldset>
            <p>
              Saving starts a new period with future matches and cancels pending deliveries from the
              previous settings.
            </p>
            {data.nextDigestAt && (
              <p>Next digest: {new Date(data.nextDigestAt).toLocaleString()}</p>
            )}
            <Button className="primary-button" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save notifications"}
            </Button>
            {saved && <p role="status">Notification settings saved.</p>}
          </form>
        )}
      </div>
    </>
  );
}

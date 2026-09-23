import { Notifications as NotificationSettings } from "@signalscout/ui";
import { paths } from "./route.js";

/**
 * A monitor's notification settings. US-354.
 *
 * The screen is the package's. What is this application's: the monitor's
 * address, and the sentence for an account that has no secret of its own and
 * is signed with the instance's (US-096) — a hosted account never is.
 */
export function Notifications({
  monitorId,
  projectId,
}: {
  readonly monitorId: string;
  readonly projectId: string;
}) {
  return (
    <NotificationSettings
      monitorId={monitorId}
      monitorHref={paths.monitor(projectId, monitorId)}
      signingNotice={(secret) =>
        secret.usingInstanceSecret ? (
          <p>
            Signing with this instance&rsquo;s own <code>WEBHOOK_SIGNING_SECRET</code>. Make one for
            your account to sign with a value nobody else here holds.
          </p>
        ) : null
      }
    />
  );
}

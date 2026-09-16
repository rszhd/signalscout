/**
 * What a new monitor is set to notify with. US-093.
 *
 * The rule is small and the failure it prevents is not: a monitor that
 * collects, classifies and tells nobody, which is what the running instance
 * had — zero settings rows and zero deliveries against 174 posts and 20
 * matches. So each branch has its own case, including the two that turn email
 * off.
 */
import { describe, expect, it } from "vitest";
import { defaultNotificationSettings } from "./settings.js";

describe("the notification settings a new monitor starts with", () => {
  const owner = { canSendEmail: true, emailTo: "owner@example.test" };

  it("emails the owner where the deployment can send", () => {
    expect(defaultNotificationSettings(owner)).toEqual({
      emailEnabled: true,
      emailTo: "owner@example.test",
      digestHours: 24,
      minScore: 50,
      immediateScore: 70,
      webhookEnabled: false,
      webhookUrl: "",
      webhookMode: "digest",
    });
  });

  it("leaves email off where the deployment has no mailer", () => {
    // The self-hosted instance with no SMTP, which is most of them. Defaulting
    // it on there queues deliveries that fail five times each and puts an
    // error on a monitor card whose owner never asked to be notified.
    const settings = defaultNotificationSettings({ ...owner, canSendEmail: false });

    expect(settings.emailEnabled).toBe(false);
    expect(settings.emailTo).toBe("owner@example.test");
  });

  it("leaves email off when there is no address to send to", () => {
    // An address is as necessary as a mailer, and the pair is refused by the
    // schema — so it is decided here rather than caught there.
    expect(defaultNotificationSettings({ canSendEmail: true, emailTo: null }).emailEnabled).toBe(
      false,
    );
  });

  it("invents no webhook, because only the person has the URL", () => {
    const settings = defaultNotificationSettings(owner);

    expect(settings.webhookEnabled).toBe(false);
    expect(settings.webhookUrl).toBe("");
  });

  it("sets the immediate threshold below every score a lead has reached", () => {
    /**
     * 70, where the shipped default is 90. Measured best scores: Reddit 71, X
     * 66, LinkedIn 69, TikTok 82, Instagram 90 — so at 90 an immediate email
     * would have fired twice in this product's whole history, and at 70 it
     * fires for the leads somebody would answer the same hour.
     */
    const { immediateScore, minScore } = defaultNotificationSettings(owner);

    expect(immediateScore).toBe(70);
    expect(minScore).toBe(50);
    expect(immediateScore as number).toBeGreaterThan(minScore);
  });
});

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ApiRoutes } from "../.storybook/api.js";
import { Notifications, type SigningSecret } from "./Notifications.js";

const settings = {
  emailEnabled: true,
  emailTo: "alex@example.com",
  digestHours: 24,
  minScore: 60,
  immediateScore: 90,
  webhookEnabled: false,
  webhookUrl: "",
  webhookMode: "digest",
};

function api(secret: SigningSecret, extra: Record<string, unknown> = {}): ApiRoutes {
  const body = {
    settings,
    smtpMissing: [],
    webhookMissing: [],
    emailError: null,
    webhookError: null,
    nextDigestAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    signingSecret: secret,
    ...extra,
  };
  return {
    "GET /api/monitors/*/notifications": { body },
    "PUT /api/monitors/*/notifications": ({ body: sent }) => ({
      body: { ...body, settings: sent },
      delay: 300,
    }),
    "POST /api/notifications/signing-secret": {
      body: {
        secret: "whsec_3f1e9c2a7b8d4e6f0a1b2c3d4e5f6a7b",
        signingSecret: { hint: "••••6a7b", updatedAt: new Date().toISOString() },
      },
    },
  };
}

const meta = {
  title: "Screens/Notifications",
  component: Notifications,
  args: { monitorId: "m1", monitorHref: "/projects/p1/monitors/m1" },
  parameters: {
    layout: "fullscreen",
    api: api({ hint: "••••1234", updatedAt: "2026-09-20T10:00:00.000Z" }),
  },
} satisfies Meta<typeof Notifications>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SecretSet: Story = {};

export const NoSecretYet: Story = {
  parameters: { api: api({ hint: null, updatedAt: null }) },
};

/** Self-hosted: signed with the instance's secret until the account makes one. */
export const InstanceSecret: Story = {
  args: {
    signingNotice: (secret) =>
      secret.usingInstanceSecret ? (
        <p>
          Signing with this instance&rsquo;s own <code>WEBHOOK_SIGNING_SECRET</code>. Make one for
          your account to sign with a value nobody else here holds.
        </p>
      ) : null,
  },
  parameters: {
    api: api({ hint: null, updatedAt: null, usingInstanceSecret: true, canStore: true }),
  },
};

/** Self-hosted, where this account may not store a secret. */
export const CannotStore: Story = {
  parameters: {
    api: api({
      hint: null,
      updatedAt: null,
      canStore: false,
      storeBlocker: "Set SECRETS_KEY on this instance to store a secret per account.",
    }),
  },
};

export const EmailUnavailable: Story = {
  parameters: {
    api: api({ hint: "••••1234", updatedAt: null }, { smtpMissing: ["SMTP_HOST", "SMTP_FROM"] }),
  },
};

export const Loading: Story = {
  parameters: { api: { "GET /api/monitors/*/notifications": { delay: "never" } } },
};

export const Refused: Story = {
  parameters: {
    api: {
      "GET /api/monitors/*/notifications": {
        status: 404,
        body: { message: "That monitor does not exist." },
      },
    },
  },
};

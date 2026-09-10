/**
 * The one call this panel makes. Same origin as the application, so the
 * session cookie the login already set travels with it.
 */
export interface Registration {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  projects: number;
  monitors: number;
  matches: number;
}

export interface Registrations {
  date: string;
  users: Registration[];
  totals: {
    users: number;
    projects: number;
    monitors: number;
    matches: number;
  };
}

/** A refusal that keeps its status, so the screen can tell 401 from 403. */
export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function loadRegistrations(date: string): Promise<Registrations> {
  const response = await fetch(`/api/admin/registrations?date=${encodeURIComponent(date)}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new AdminError(response.status, body?.message ?? "The admin view could not be loaded.");
  }

  return (await response.json()) as Registrations;
}

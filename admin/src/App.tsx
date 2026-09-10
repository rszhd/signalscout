import { useCallback, useEffect, useState } from "react";
import { AdminError, loadRegistrations, type Registrations } from "./api.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.js";

/** Today, in UTC, which is the day the API means when no day is named. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="gap-1 pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value.toLocaleString()}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function App() {
  const [date, setDate] = useState(utcToday);
  const [data, setData] = useState<Registrations | null>(null);
  const [error, setError] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (day: string) => {
    setLoading(true);
    setError(null);

    try {
      setData(await loadRegistrations(day));
    } catch (cause) {
      setError(
        cause instanceof AdminError
          ? cause
          : new AdminError(0, "The admin view could not be loaded."),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Who registered, and how big each account is.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="The day to report"
            className="w-44"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Button variant="outline" onClick={() => void load(date)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </header>

      {error?.status === 401 && (
        <Card>
          <CardHeader>
            <CardTitle>Sign in first</CardTitle>
            <CardDescription>
              This panel uses the application's session. Open the application, sign in, then come
              back here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => globalThis.location.assign("/")}>Open the application</Button>
          </CardContent>
        </Card>
      )}

      {error?.status === 403 && (
        <Card>
          <CardHeader>
            <CardTitle>Not an administrator</CardTitle>
            <CardDescription>
              This account is signed in but its address is not listed in <code>ADMIN_EMAILS</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {error && error.status !== 401 && error.status !== 403 && (
        <Card>
          <CardHeader>
            <CardTitle>The admin view could not be loaded</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!error && data && (
        <>
          <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Accounts" value={data.totals.users} />
            <Stat label="Projects" value={data.totals.projects} />
            <Stat label="Monitors" value={data.totals.monitors} />
            <Stat label="Inbox items" value={data.totals.matches} />
          </section>

          <Card className="py-0">
            <CardHeader className="flex-row items-center justify-between border-b py-4">
              <div>
                <CardTitle>Registered on {data.date}</CardTitle>
                <CardDescription>
                  {data.users.length === 0
                    ? "Nobody created an account on this day."
                    : `${data.users.length} account${data.users.length === 1 ? "" : "s"}.`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              {data.users.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Person</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead className="text-right">Projects</TableHead>
                      <TableHead className="text-right">Monitors</TableHead>
                      <TableHead className="pr-6 text-right">Inbox items</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="pl-6 font-medium">{user.name}</TableCell>
                        <TableCell className="text-muted-foreground">{user.email}</TableCell>
                        <TableCell>
                          <Badge variant={user.emailVerified ? "default" : "secondary"}>
                            {user.emailVerified ? "Verified" : "Unverified"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {when(user.createdAt)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{user.projects}</TableCell>
                        <TableCell className="text-right tabular-nums">{user.monitors}</TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">
                          {user.matches}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

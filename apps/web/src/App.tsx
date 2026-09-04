import { useEffect, useState } from "react";

interface Health {
  status: "ok";
  workerInProcess: boolean;
}

type Result = { state: "loading" } | { state: "ok"; health: Health } | { state: "error" };

/**
 * The whole UI, for now. It exists to prove two things: the bundle is served,
 * and it can reach the API it is served from. US-011 builds the inbox.
 */
export function App() {
  const [result, setResult] = useState<Result>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health")
      .then((response) => response.json() as Promise<Health>)
      .then((health) => {
        if (!cancelled) setResult({ state: "ok", health });
      })
      .catch(() => {
        if (!cancelled) setResult({ state: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8 font-sans">
      <h1 className="text-3xl font-semibold">IntentWatch</h1>
      <p className="text-neutral-600">
        Find the people publicly talking about the problem your product solves.
      </p>
      <p data-testid="api-status" className="text-sm">
        {result.state === "loading" && "Checking the API…"}
        {result.state === "error" && "The API did not answer."}
        {result.state === "ok" &&
          `API is ok. The worker runs ${
            result.health.workerInProcess ? "in this process" : "in its own container"
          }.`}
      </p>
    </main>
  );
}

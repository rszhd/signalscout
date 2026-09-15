/**
 * Correctness-critical: two worktrees given one slot share a Postgres, and the
 * second `pnpm dev` migrates the first one's database.
 *
 * The script's own steps — add, install, dump, restore — need git and Docker
 * and are not asserted here. What is asserted is the part that decides those
 * steps: which numbers a worktree receives, and what its `.env` says. A wrong
 * number here is silent until two agents are already running.
 */
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  buildEnvFile,
  composeProjectName,
  MAIN_SLOT,
  orphanProjects,
  pickSlot,
  portsForSlots,
  probeBusyPorts,
  slotPorts,
  usedSlotsFrom,
} from "./worktrees.mjs";

const mainEnv = [
  "PORT=3000",
  "DATABASE_URL=postgres://intentwatch:secret@localhost:5432/intentwatch",
  "POSTGRES_USER=intentwatch",
  "POSTGRES_PASSWORD=secret",
  "POSTGRES_DB=intentwatch",
  "ENCRYPTION_KEY=a-base64-key",
  "AUTH_SECRET=a-session-secret",
  "AI_API_KEY=a-model-key",
].join("\n");

describe("slotPorts", () => {
  it("offsets all three ports by the slot, so the numbers read together", () => {
    expect(slotPorts(2)).toEqual({ PORT: 3002, WEB_PORT: 5175, POSTGRES_PORT: 5434 });
  });

  it("gives the main checkout the numbers every default in the repository uses", () => {
    expect(slotPorts(MAIN_SLOT)).toEqual({ PORT: 3000, WEB_PORT: 5173, POSTGRES_PORT: 5432 });
  });
});

describe("pickSlot", () => {
  it("never returns the main checkout's slot, even when nothing is used", () => {
    expect(pickSlot([])).toBe(1);
  });

  it("does not hand out a slot another worktree holds", () => {
    expect(pickSlot([1, 2])).toBe(3);
  });

  it("offers a slot again once the worktree holding it is gone", () => {
    expect(pickSlot([1, 3])).toBe(2);
  });

  it("refuses rather than wrapping round onto a used slot", () => {
    const everySlot = Array.from({ length: 999 }, (_, index) => index + 1);
    expect(() => pickSlot(everySlot)).toThrow(/no free worktree slot/);
  });

  /**
   * This machine ran two unrelated projects on 5433 and 5434. Docker refuses to
   * publish a port it cannot have, and it refuses after the folder and the
   * branch have been made — so the question has to be asked before the slot is
   * handed out, not by the daemon afterwards.
   */
  it("skips a slot whose Postgres port something else already holds", () => {
    expect(pickSlot([], new Set([5433]))).toBe(2);
  });

  it("skips a slot for a busy API port just as readily as a busy database port", () => {
    expect(pickSlot([], new Set([3001]))).toBe(2);
    expect(pickSlot([], new Set([5174]))).toBe(2);
  });

  it("skips every slot that is either held or busy, and takes the first that is neither", () => {
    expect(pickSlot([1, 2], new Set([5435]))).toBe(4);
  });
});

describe("portsForSlots", () => {
  it("asks about all three ports of every slot, so one busy port is enough", () => {
    expect(portsForSlots([1, 2])).toEqual([3001, 5174, 5433, 3002, 5175, 5434]);
  });
});

describe("orphanProjects", () => {
  /**
   * `git worktree remove` deletes the folder and leaves the container, the
   * network and the data volume. Git has no hook for it, so the orphan is found
   * afterwards by comparing what Docker holds against what a worktree still
   * names.
   */
  it("finds a project this repository made whose worktree is gone", () => {
    expect(orphanProjects(["signalscout_a", "signalscout_b"], ["signalscout_a"])).toEqual([
      "signalscout_b",
    ]);
  });

  it("never touches the main checkout or an unrelated project on the machine", () => {
    expect(orphanProjects(["intentwatch", "patrol", "qassist", "smart"], [])).toEqual([]);
  });

  it("calls nothing an orphan while a worktree still names it", () => {
    expect(orphanProjects(["signalscout_a"], ["signalscout_a"])).toEqual([]);
  });
});

describe("probeBusyPorts", () => {
  it("reports a port something is listening on, and not one that is free", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const held = server.address().port;

    try {
      const busy = await probeBusyPorts([held]);
      expect(busy.has(held)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    expect((await probeBusyPorts([held])).has(held)).toBe(false);
  });
});

describe("usedSlotsFrom", () => {
  it("reads the slot each worktree wrote, and ignores a folder with no .env", () => {
    expect(usedSlotsFrom([{ SIGNALSCOUT_SLOT: "1" }, {}, { SIGNALSCOUT_SLOT: "4" }])).toEqual([
      1, 4,
    ]);
  });

  it("ignores the main checkout, which holds no slot of its own", () => {
    expect(usedSlotsFrom([{ SIGNALSCOUT_SLOT: "0" }])).toEqual([]);
  });
});

describe("composeProjectName", () => {
  it("is derived from the name, so two worktrees never share a volume", () => {
    expect(composeProjectName("us-135")).toBe("signalscout_us_135");
    expect(composeProjectName("us-135")).not.toBe(composeProjectName("us-136"));
  });
});

describe("buildEnvFile", () => {
  const written = buildEnvFile(mainEnv, { slot: 2, name: "inbox" });
  const read = Object.fromEntries(
    written
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

  it("points the database url at this worktree's own Postgres", () => {
    expect(read.DATABASE_URL).toBe("postgres://intentwatch:secret@localhost:5434/intentwatch");
  });

  it("writes all three ports and the slot that produced them", () => {
    expect(read).toMatchObject({
      SIGNALSCOUT_SLOT: "2",
      PORT: "3002",
      WEB_PORT: "5175",
      POSTGRES_PORT: "5434",
    });
  });

  it("names a compose project, so the container and the volume are its own", () => {
    expect(read.COMPOSE_PROJECT_NAME).toBe("signalscout_inbox");
  });

  /**
   * The copied rows are ciphertext under this key. A fresh one would leave the
   * connections screen offering keys nobody can spend, which reads as a bug in
   * the screen. docs/secrets.md.
   */
  it("carries the encryption key across unchanged, or the copied credentials die", () => {
    expect(read.ENCRYPTION_KEY).toBe("a-base64-key");
  });

  it("keeps every other value the main checkout had", () => {
    expect(read.AI_API_KEY).toBe("a-model-key");
    expect(read.AUTH_SECRET).toBe("a-session-secret");
  });

  it("leaves one value per key, so the last line cannot be the stale one", () => {
    expect(written.split("\n").filter((line) => line.startsWith("PORT=")).length).toBe(1);
    expect(written.split("\n").filter((line) => line.startsWith("DATABASE_URL=")).length).toBe(1);
  });
});

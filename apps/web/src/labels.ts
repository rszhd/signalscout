/**
 * How a platform, a provider and a moment are named on screen.
 *
 * The API sends ids — `reddit`, `brightdata`, an ISO timestamp — because they
 * key rows and they must not drift. A screen that prints one is showing a
 * person our column value: "scrapecreators" is not how that company writes its
 * name, and `9/6/2026, 5:12:03 PM` is a fact nobody asked for when the
 * question was "recently?".
 *
 * A table rather than a rule, for the reason Inbox.tsx gives about its own:
 * a rule that capitalises the first letter answers "Reddit" and "Brightdata",
 * and only one of those is a name.
 *
 * An unknown id is returned as it is. A build that gains a platform before
 * this file hears about it shows something plain rather than something wrong.
 */

const platformNames: Record<string, string> = {
  reddit: "Reddit",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const providerNames: Record<string, string> = {
  brightdata: "Bright Data",
  scrapecreators: "ScrapeCreators",
  socialcrawl: "SocialCrawl",
  apify: "Apify",
  socialdata: "SocialData",
  fake: "Fake source",
};

export function platformName(id: string): string {
  return platformNames[id] ?? id;
}

export function providerName(id: string): string {
  return providerNames[id] ?? id;
}

/**
 * How long ago, in the largest unit that still says something.
 *
 * The exact moment stays available in a `title` wherever this is used: a
 * person checking whether a poll ran this morning wants "2 hours ago", and one
 * reconciling a bill wants the timestamp.
 */
export function ageLabel(at: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

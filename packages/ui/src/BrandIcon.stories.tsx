import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandIcon } from "./BrandIcon.js";

const platforms = ["reddit", "x", "linkedin", "youtube", "tiktok", "instagram"];
const providers = ["brightdata", "scrapecreators", "socialcrawl", "apify", "socialdata"];
const models = ["anthropic", "openai", "google", "deepseek", "openrouter", "ollama", "typesafe"];

const meta = {
  title: "Brand/BrandIcon",
  component: BrandIcon,
  args: { brand: "reddit", size: 20 },
} satisfies Meta<typeof BrandIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const One: Story = {};

/** A name the table does not know shows its first two letters. */
export const Unknown: Story = { args: { brand: "mastodon" } };

function Row({ title, brands }: { readonly title: string; readonly brands: readonly string[] }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ margin: "0 0 8px" }}>{title}</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {brands.map((brand) => (
          <span key={brand} className="brand-label" style={{ display: "flex", gap: 8 }}>
            <BrandIcon brand={brand} />
            {brand}
          </span>
        ))}
      </div>
    </section>
  );
}

/** Every icon the table names. A broken image here is a missing file in `public/brands`. */
export const All: Story = {
  render: () => (
    <>
      <Row title="Platforms" brands={platforms} />
      <Row title="Providers" brands={providers} />
      <Row title="Model providers" brands={models} />
    </>
  ),
};

// Regenerates the marked README blocks from Yir's public Standard API.
// Usage: YIR_API_KEY=... node scripts/update-readme.mjs
// Reads only GET /v1/models/{id} and its contract view; never submits a job.
import { readFileSync, writeFileSync } from "node:fs";
import { createNodeYirClient, DEFAULT_USER_AGENT } from "@yir-ai/sdk/server";

const config = JSON.parse(readFileSync(new URL("../yir.json", import.meta.url), "utf8"));
const readmeURL = new URL("../README.md", import.meta.url);

const client = createNodeYirClient({ userAgent: `yir-gh/${config.repo} ${DEFAULT_USER_AGENT}` });
const [detail, contract] = await Promise.all([
  client.getModel(config.model),
  client.getModelContract(config.model),
]);

const usd = (micros) => `$${(micros / 1e6).toFixed(4).replace(/0{1,2}$/, "")}`;
const today = new Date().toISOString().slice(0, 10);

// The official price comes from a free quote, so it stays in the table when the official channel is offline.
async function officialPrice(spec) {
  const resolution = spec.specification_label.split(" · ")[0];
  const quote = await client.quoteImage({
    model: config.model,
    input: { type: "text", prompt: "price check" },
    parameters: { resolution, aspect_ratio: "1:1" },
  });
  return quote.official?.amount ? usd(Math.round(Number(quote.official.amount) * 1e6)) : "—";
}

async function pricesBlock() {
  // One row per output size; input modes share prices, so keep text-to-image rows only.
  const specs = detail.specifications.filter((s) => s.input_mode === "text");
  const official = await Promise.all(specs.map(officialPrice));
  const priced = (c) => c.availability === "available" && c.amount_micros !== undefined;
  // Channels without a published, available price stay out of the table instead of showing empty columns.
  const providers = [...new Map(specs.flatMap((s) => s.channels).filter(priced).map((c) => [c.provider_code, c.provider_label])).entries()];
  const header = `| Output | Official | ${providers.map(([, label]) => label).join(" | ")} |`;
  const divider = `|---|---:|${providers.map(() => "---:").join("|")}|`;
  const rows = specs.map((s, i) => {
    const cells = providers.map(([code]) => {
      const c = s.channels.find((x) => x.provider_code === code);
      if (!c || !priced(c)) return "—";
      return usd(c.amount_micros);
    });
    const min = Math.min(...s.channels.filter(priced).map((c) => c.amount_micros));
    return `| ${s.specification_label} | ${official[i]} | ${cells.map((cell) => (cell === usd(min) ? `**${cell}**` : cell)).join(" | ")} |`;
  });
  return [
    header, divider, ...rows, "",
    `Per image, USD. Official is the model maker's list price; the other columns are channel prices as published by Yir on ${today}, ` +
      `and **bold** is the cheapest channel available that day. ` +
      `Yir charges what the channel actually bills, with no markup, and nothing when the channel bills nothing. ` +
      `[Live prices](${link("prices")}).`,
  ].join("\n");
}

function paramsBlock() {
  const op = contract.model.operations[0];
  const rows = op.parameters.map((p) => {
    const values = p.values?.length ? p.values.map((v) => `\`${v}\``).join(", ") : p.type;
    const def = p.default === undefined ? "—" : `\`${p.default}\``;
    return `| \`${p.name}\` | ${values} | ${def} | ${p.locales?.en?.description ?? ""} |`;
  });
  return ["| Parameter | Values | Default | Notes |", "|---|---|---|---|", ...rows].join("\n");
}

function link(content) {
  const url = new URL(config.links[content] ?? config.links.model);
  url.searchParams.set("utm_source", "github");
  url.searchParams.set("utm_medium", "repo");
  url.searchParams.set("utm_campaign", config.repo);
  url.searchParams.set("utm_content", content);
  return url.toString();
}

function replaceBlock(text, name, body) {
  const pattern = new RegExp(`(<!-- yir:${name}:start -->)[\\s\\S]*?(<!-- yir:${name}:end -->)`);
  if (!pattern.test(text)) throw new Error(`README is missing the yir:${name} block`);
  return text.replace(pattern, `$1\n${body}\n$2`);
}

let readme = readFileSync(readmeURL, "utf8");
readme = replaceBlock(readme, "prices", await pricesBlock());
readme = replaceBlock(readme, "params", paramsBlock());
readme = readme.replace(/\{\{link:([a-z_]+)\}\}/g, (_, content) => link(content));
writeFileSync(readmeURL, readme);

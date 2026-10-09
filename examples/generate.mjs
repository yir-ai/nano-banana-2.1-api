// Generate one Nano Banana 2.1 image through Yir and save it locally.
// Usage: YIR_API_KEY=... node examples/generate.mjs "a prompt" [2K] [16:9]
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createNodeYirClient, DEFAULT_USER_AGENT } from "@yir-ai/sdk/server";

const [prompt = "A rainy Tokyo alley at night, film still, muted colors", resolution = "1K", aspectRatio = "1:1"] = process.argv.slice(2);

const client = createNodeYirClient({ userAgent: `yir-gh/nano-banana-2.1-api ${DEFAULT_USER_AGENT}` });

const request = {
  model: "google/nano-banana-2.1",
  input: { type: "text", prompt },
  parameters: { resolution, aspect_ratio: aspectRatio },
};

const quote = await client.quoteImage(request);
console.log(`Estimated: $${quote.primary.amount} (official: $${quote.official.amount})`);

// Save the key with the request if you need to recover after a crash; reusing it never double-submits.
// max_cost guards against runaway charges; it is not the price. You pay what the channel bills.
const job = await client.submitImage({ ...request, max_cost: "0.20" }, randomUUID());
const done = await client.waitForJob(job.id);

for (const [i, output] of done.result.files.entries()) {
  const file = `nano-banana-2.1-${job.id}-${i}.${output.media_type.split("/")[1]}`;
  await writeFile(file, Buffer.from(await (await fetch(output.url)).arrayBuffer()));
  console.log(`Saved ${file}`);
}
console.log(`Charged: $${done.billing?.total_charged_by_yir} via ${done.final_provider}`);

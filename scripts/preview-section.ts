import { listMediaFixtures } from "../tests/helpers/mediaFixtures";
import { buildPreviewOutputPath, generateSectionPreview } from "../src/components/studio/previewGeneration";

const inventory = listMediaFixtures();
const inputPath = process.argv[2] ?? inventory.video[0];
const startTime = Number(process.argv[3] ?? 0);
const endTime = Number(process.argv[4] ?? Math.max(1, startTime + 1));

if (!inputPath) {
  throw new Error("No video fixture available for preview generation.");
}

const requestKey = `preview-${Date.now()}`;
const outputPath = buildPreviewOutputPath({ requestKey });
const asset = await generateSectionPreview({ inputPath, requestKey, startTime, endTime, outputPath });
console.log(JSON.stringify(asset, null, 2));

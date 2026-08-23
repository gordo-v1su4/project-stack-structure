import { compareBenchmarkFiles } from "../src/components/studio/benchmarkComparison";

const localPath = process.argv[2];
const remotePath = process.argv[3];

if (!localPath || !remotePath) {
  throw new Error("Usage: bun run scripts/bench-compare.ts <local-json> <remote-json>");
}

const result = await compareBenchmarkFiles(localPath, remotePath);
console.log(JSON.stringify(result, null, 2));

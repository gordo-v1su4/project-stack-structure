import { runLatencyBenchmark } from "../src/components/studio/latencyBenchmark";

const result = await runLatencyBenchmark({
  inputPath: process.argv[2],
  startTime: process.argv[3] ? Number(process.argv[3]) : undefined,
  endTime: process.argv[4] ? Number(process.argv[4]) : undefined,
  hardwareLane: process.env.TEST_HARDWARE_LANE as never,
});

console.log(JSON.stringify(result, null, 2));

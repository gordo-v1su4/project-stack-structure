import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

type WorkflowInput = {
  name?: string;
  link?: number | null;
};

type WorkflowOutput = {
  name?: string;
  links?: number[] | null;
};

type WorkflowNode = {
  id: number;
  type: string;
  order?: number;
  pos?: [number, number];
  inputs?: WorkflowInput[] | WorkflowInput;
  outputs?: WorkflowOutput[] | WorkflowOutput;
  widgets_values?: unknown[];
};

type EditableWorkflow = {
  id?: string;
  last_node_id: number;
  last_link_id: number;
  nodes: WorkflowNode[];
  links: Array<[number, number, number, number, number, string]>;
  definitions?: {
    subgraphs?: Array<{
      id: string;
      name?: string;
      inputs?: Array<{ name?: string }>;
    }>;
  };
};

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    first: { type: "string" },
    last: { type: "string" },
    prompt: { type: "string" },
    output: { type: "string" },
    "runtime-root": { type: "string", multiple: true },
    prefix: { type: "string", default: "h3/minimax-h3-fl2va" },
    duration: { type: "string", default: "5.17" },
    seed: { type: "string", default: "424242" },
  },
  strict: true,
});

const required = ["source", "first", "last", "prompt", "output"] as const;
for (const name of required) {
  if (!values[name]) throw new Error(`--${name} is required`);
}

const sourcePath = resolve(values.source!);
const firstPath = resolve(values.first!);
const lastPath = resolve(values.last!);
const outputPath = resolve(values.output!);
const promptPath = resolve(values.prompt!);
const runtimeRoots = (values["runtime-root"] ?? []).map((runtimeRoot) => resolve(runtimeRoot));
const duration = Number(values.duration);
const seed = Number(values.seed);
if (!Number.isFinite(duration) || duration <= 0) throw new Error("--duration must be positive");
if (!Number.isSafeInteger(seed)) throw new Error("--seed must be an integer");

const workflow = JSON.parse(await readFile(sourcePath, "utf8")) as EditableWorkflow;
const prompt = (await readFile(promptPath, "utf8")).trim();
if (!prompt) throw new Error("Prompt file is empty");

const firstNode = workflow.nodes.find((node) => node.type === "LoadImage");
const generatorNode = workflow.nodes.find((node) =>
  Array.isArray(node.inputs)
  && node.inputs.some((input) => input.name === "first_frame")
  && node.inputs.some((input) => input.name === "last_frame"));
const saveNode = workflow.nodes.find((node) => node.type === "SaveVideo");
if (!firstNode || !generatorNode || !saveNode) {
  throw new Error("Source workflow must contain LoadImage, FL2VA generator, and SaveVideo nodes");
}

const fl2vaSubgraph = workflow.definitions?.subgraphs?.find((subgraph) =>
  subgraph.inputs?.some((input) => input.name === "first_frame")
  && subgraph.inputs?.some((input) => input.name === "last_frame"));
if (fl2vaSubgraph && generatorNode.type !== fl2vaSubgraph.id) {
  generatorNode.type = fl2vaSubgraph.id;
}
if (!Array.isArray(firstNode.outputs) || !Array.isArray(generatorNode.inputs)) {
  throw new Error("Source workflow uses an unsupported editable-graph shape");
}

const firstInput = generatorNode.inputs.find((input) => input.name === "first_frame");
const lastInput = generatorNode.inputs.find((input) => input.name === "last_frame");
if (!firstInput || !lastInput) throw new Error("FL2VA boundary inputs are missing");

const nextNodeId = Math.max(workflow.last_node_id, ...workflow.nodes.map((node) => node.id)) + 1;
const nextLinkId = Math.max(workflow.last_link_id, ...workflow.links.map((link) => link[0])) + 1;
const lastNode = structuredClone(firstNode);
lastNode.id = nextNodeId;
lastNode.order = Math.max(...workflow.nodes.map((node) => node.order ?? 0)) + 1;
lastNode.pos = [firstNode.pos?.[0] ?? 40, (firstNode.pos?.[1] ?? 120) + 380];
lastNode.widgets_values = [basename(lastPath), "image"];
if (!Array.isArray(lastNode.outputs)) throw new Error("Copied last-frame node has invalid outputs");
lastNode.outputs[0] = { ...lastNode.outputs[0], links: [nextLinkId] };
for (let index = 1; index < lastNode.outputs.length; index += 1) {
  lastNode.outputs[index] = { ...lastNode.outputs[index], links: null };
}

firstNode.widgets_values = [basename(firstPath), "image"];
lastInput.link = nextLinkId;
workflow.nodes.push(lastNode);
workflow.links.push([nextLinkId, nextNodeId, 0, generatorNode.id, generatorNode.inputs.indexOf(lastInput), "IMAGE"]);
workflow.last_node_id = nextNodeId;
workflow.last_link_id = nextLinkId;
workflow.id = randomUUID();

const widgets = generatorNode.widgets_values;
if (!Array.isArray(widgets) || widgets.length < 9) throw new Error("FL2VA generator widgets are incomplete");
widgets[0] = prompt;
widgets[1] = 1344;
widgets[2] = 768;
widgets[3] = duration;
widgets[4] = seed;
widgets[5] = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
widgets[6] = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
widgets[7] = "minimax_h3_video_vae_fp16.safetensors";
widgets[8] = "minimax_h3_audio_vae_fp32.safetensors";
saveNode.widgets_values = [values.prefix, "auto", "auto"];

const serialized = `${JSON.stringify(workflow, null, 2)}\n`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, "utf8");

for (const runtimeRoot of runtimeRoots) {
  const inputDir = join(runtimeRoot, "input");
  const workflowDir = join(runtimeRoot, "user", "default", "workflows");
  await Promise.all([mkdir(inputDir, { recursive: true }), mkdir(workflowDir, { recursive: true })]);
  await Promise.all([
    copyFile(firstPath, join(inputDir, basename(firstPath))),
    copyFile(lastPath, join(inputDir, basename(lastPath))),
    writeFile(join(workflowDir, basename(outputPath)), serialized, "utf8"),
  ]);
}

console.log(JSON.stringify({
  workflow: outputPath,
  firstFrame: firstPath,
  lastFrame: lastPath,
  duration,
  seed,
  runtimeRoots,
}, null, 2));

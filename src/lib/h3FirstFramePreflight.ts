import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { H3_FIRST_FRAME_PROFILE, h3FirstFrameBinding, normalizeH3FirstFrameAssessment } from "@/components/studio/h3FirstFrame";
import type { H3IssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
import type { PreparedH3PolicyReference } from "./h3DraftPolicyPreparation";
import { assertH3FirstFrameMatchesJob, downloadH3FirstFrame, readH3FirstFrame, writeH3FirstFrameAssessment } from "./h3FirstFrameStore";

const execute=promisify(execFile);
async function runStillVerifier(inputPath:string,outputPath:string){
  const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV??"production"};
  for(const name of ["PATH","HOME","USERPROFILE","TMP","TEMP","TMPDIR","SYSTEMROOT","LANG","UV_CACHE_DIR","UV_PYTHON_INSTALL_DIR","UV_OFFLINE","UV_PYTHON_DOWNLOADS"])if(process.env[name])env[name]=process.env[name];
  const script=path.join(path.dirname(process.env.IDENTITY_SCRIPT_PATH||path.join(process.cwd(),"scripts/identity/verify.py")),"verify_still.py");
  await execute(process.env.IDENTITY_UV_PATH||"uv",["run","--offline","--no-project","--python",process.env.IDENTITY_PYTHON_PATH||"/opt/stack-identity/.venv/bin/python","python",script,
    "--input",inputPath,"--output",outputPath,"--model-dir",process.env.IDENTITY_MODEL_DIR||"/opt/stack-identity/models"],{env,timeout:120_000,maxBuffer:1024*1024,windowsHide:true});
}
/** Trusted one-PNG screen before opening a provider client. Never grants video eligibility. */
export async function prepareH3FirstFrame(job:H3GenerationJob,policy:H3IssuedDraftPolicy,references:PreparedH3PolicyReference[],tempFolder:string,
  options:{runVerifier?:(input:string,output:string)=>Promise<void>}={}){
  if(job.profile!==H3_FIRST_FRAME_PROFILE||!job.firstFrame||job.request.conditioning?.artifactId!==job.firstFrame.id)throw new Error("The I2VA artifact is missing.");
  const artifact=await readH3FirstFrame(job.ownerId,job.projectId,job.firstFrame.id);
  if(!artifact||artifact.sha256!==job.firstFrame.sha256)throw new Error("The canonical first frame changed.");
  assertH3FirstFrameMatchesJob(artifact,job);
  const bytes=await downloadH3FirstFrame(artifact),imagePath=path.join(tempFolder,"first-frame.png");await writeFile(imagePath,bytes);
  const {issuedAt:_,...issuedPolicy}=policy;void _;
  const input={version:1,ownerId:job.ownerId,projectId:job.projectId,generationModel:job.profile,firstFrame:h3FirstFrameBinding(artifact),artifact,imagePath,issuedPolicy,
    generationReferenceHashes:references.map(ref=>ref.raw.rawSha256),identityReferenceHashes:references.filter(ref=>ref.raw.role==="identity").map(ref=>ref.raw.rawSha256),
    references:references.map(ref=>({path:ref.imagePath,hash:ref.raw.rawSha256,canonicalName:ref.raw.canonicalName,role:ref.raw.role,
      ...(ref.raw.role==="identity"?{faceRegions:policy.body.galleries.find(g=>g.referenceAssetId===ref.raw.assetId)?.faceRegions}:{})}))};
  const inputPath=path.join(tempFolder,"first-frame-input.json"),outputPath=path.join(tempFolder,"first-frame-report.json");await writeFile(inputPath,JSON.stringify(input));
  await(options.runVerifier??runStillVerifier)(inputPath,outputPath);
  if((await stat(outputPath)).size>256*1024)throw new Error("Still screen exceeded its report bound.");
  const assessment=normalizeH3FirstFrameAssessment(JSON.parse(await readFile(outputPath,"utf8")));
  if(!assessment||assessment.artifactId!==artifact.id||assessment.descriptorSha256!==artifact.sha256||assessment.pngSha256!==artifact.body.pngSha256
    ||assessment.policyId!==policy.id||assessment.policySha256!==policy.sha256||assessment.familyId!==policy.familyId||assessment.galleryProfileSha256!==policy.body.galleryProfileSha256
    ||assessment.modelSha256!=="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
    ||assessment.spatialEvidence.assignments.some(a=>!policy.body.identityReferenceHashes.includes(a.referenceHash)))throw new Error("Still screen did not match its canonical inputs.");
  const stored=await writeH3FirstFrameAssessment(artifact,assessment);
  if(stored.status!=="eligible")throw new Error("The first-frame spatial similarity screen did not pass. No GPU video was submitted.");
  return {artifact,assessment:stored,bytes};
}

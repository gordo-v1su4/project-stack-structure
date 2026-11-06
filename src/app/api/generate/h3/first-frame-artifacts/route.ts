import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import { readStudioProject } from "@/lib/studioProjectStore";
import { getMediaGatewayConfig } from "@/lib/mediaGateway";
import { H3RequestError, materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { pinH3JobReferences } from "@/lib/h3JobStore";
import { readH3FirstFrame, registerH3FirstFrame } from "@/lib/h3FirstFrameStore";
export const runtime="nodejs";
function failure(error:unknown){return Response.json({error:error instanceof H3RequestError?error.message:"First-frame storage is unavailable. No generation was submitted."},{status:error instanceof H3RequestError?error.status:503});}
export async function POST(request:Request){
  const user=await getSessionUser();if(!user)return unauthorizedResponse();
  try{
    const text=await request.text();if(text.length>16000)throw new H3RequestError("First-frame registration metadata is too large.");
    const input=JSON.parse(text),shot=parseH3Request(input.shot);
    if(shot.conditioning||!["sface-yunet-joint-frontal-v2","sface-yunet-foreground-frontal-v2"].includes(String(shot.identityPolicyFamily)))throw new H3RequestError("Prepare an explicit frontal v2 shot before registering its first frame.");
    const saved=await readStudioProject(user.id,shot.projectId,{fresh:true}),config=getMediaGatewayConfig();
    if(!saved)throw new H3RequestError("Project not found.",404);if(!config)throw new H3RequestError("Generation storage is unavailable.",503);
    if(typeof input.upload?.bucket!=="string"||typeof input.upload?.objectKey!=="string"||typeof input.expectedSha256!=="string")throw new H3RequestError("An owned upload and expected SHA256 are required.");
    const job=await pinH3JobReferences(materializeH3Job(user.id,saved,shot,config.bucket));
    const artifact=await registerH3FirstFrame(job,input.upload,input.expectedSha256);
    return Response.json({success:true,artifact,screenStatus:"pending-worker-preflight"},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return failure(error);}
}
export async function GET(request:Request){
  const user=await getSessionUser();if(!user)return unauthorizedResponse();
  try{const q=new URL(request.url).searchParams,projectId=q.get("projectId"),artifactId=q.get("artifactId");
    if(!projectId||!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)||!artifactId)throw new H3RequestError("Choose a saved project and first-frame artifact.");
    if(!await readStudioProject(user.id,projectId,{fresh:true}))throw new H3RequestError("Project not found.",404);
    const artifact=await readH3FirstFrame(user.id,projectId,artifactId);if(!artifact)throw new H3RequestError("First-frame artifact not found.",404);
    return Response.json({success:true,artifact},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return failure(error);}
}

import {getSessionUser,unauthorizedResponse} from "@/lib/session";
import {readStudioProject} from "@/lib/studioProjectStore";
import {listH3Jobs} from "@/lib/h3JobStore";
import {prepareReferenceVersionMigration} from "@/lib/referenceMigrationServer";
import {SourceConfirmationError} from "@/lib/generationScopeServer";
import {studioJsonResponse} from "@/lib/studioJsonTransportServer";
export const runtime="nodejs";
/** Enrollment prepares canonical evidence and a pending candidate; only the named-project CAS adopts it. */
export async function POST(request:Request){
  const user=await getSessionUser();if(!user)return unauthorizedResponse();
  try{
    const text=await request.text();if(text.length>2048)throw new SourceConfirmationError("Migration request exceeds its metadata bound.",400);
    const input=JSON.parse(text);
    if(typeof input.projectId!=="string"||!/^[\w-]{1,96}$/.test(input.projectId)||typeof input.expectedRevision!=="string"||!input.expectedRevision||input.expectedRevision.length>200)throw new SourceConfirmationError("The project and exact saved revision are required.",400);
    const saved=await readStudioProject(user.id,input.projectId,{fresh:true});if(!saved)throw new SourceConfirmationError("Project not found.",404);
    if(saved.revision!==input.expectedRevision)throw new SourceConfirmationError("The saved project changed.");
    const candidate=await prepareReferenceVersionMigration({ownerId:user.id,saved,expectedRevision:input.expectedRevision,jobs:await listH3Jobs(user.id,input.projectId)});
    return studioJsonResponse(request,{success:true,...candidate});
  }catch(error){return Response.json({success:false,error:error instanceof SourceConfirmationError?error.message:"Reference-version migration could not be prepared."},
    {status:error instanceof SourceConfirmationError?error.status:503,headers:{"cache-control":"no-store"}});}
}

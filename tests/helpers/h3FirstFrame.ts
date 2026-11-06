import { H3_FIRST_FRAME_PREPARATION, h3FirstFrameDigest, type H3FirstFrameArtifact, type H3FirstFrameAssessment } from "@/components/studio/h3FirstFrame";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { H3IssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
export function firstFrameArtifactFixture(job:H3GenerationJob,pngSha256="a".repeat(64),byteCount=100):H3FirstFrameArtifact{
  const body={version:1 as const,ownerId:job.ownerId,projectId:job.projectId,planSignature:job.request.planSignature,
    target:{timelineItemId:job.target.timelineItemId,...(job.target.requirementId?{requirementId:job.target.requirementId}:{}),sectionId:job.target.sectionId,songStart:job.request.songStart,songEnd:job.request.songEnd},
    references:job.references.map((ref,i)=>({...ref,etag:ref.etag??`etag-${i}`})),pngSha256,byteCount,width:1344 as const,height:768 as const,preparationVersion:H3_FIRST_FRAME_PREPARATION};
  const sha256=h3FirstFrameDigest(body);return {version:1,id:`h3-frame-${sha256}`,sha256,body};
}
export function firstFrameAssessmentFixture(artifact:H3FirstFrameArtifact,policy:H3IssuedDraftPolicy):H3FirstFrameAssessment{
  const refs=policy.body.identityReferenceHashes;
  return {version:1,kind:"single-image",status:"eligible",artifactId:artifact.id,descriptorSha256:artifact.sha256,pngSha256:artifact.body.pngSha256,decodedPixelSha256:"d".repeat(64),
    policyId:policy.id,policySha256:policy.sha256,galleryProfileSha256:policy.body.galleryProfileSha256,modelSha256:"0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",verifierVersion:"sface-yunet-cpu-v1",
    familyId:policy.familyId as H3FirstFrameAssessment["familyId"],threshold:.8,spatialEvidence:{status:"eligible",detectedFaceCount:refs.length,reasons:[],assignments:refs.map((referenceHash,i)=>({referenceHash,detectionIndex:i,score:.9,minimumAssignmentMargin:.5,reasons:[]})),
      candidateScores:refs.flatMap((referenceHash,i)=>refs.map((_,j)=>({referenceHash,detectionIndex:j,score:i===j?.9:.4})))},warnings:["Synthetic single-image fixture, not a real likeness assessment."]};
}

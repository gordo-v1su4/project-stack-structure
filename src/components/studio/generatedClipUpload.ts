import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";
import { uploadFileDirectlyToRustFs } from "./directUploadClient";

export async function uploadGeneratedClipToRustFs(args: {
  file: File;
  folder: string;
  onPartUploaded?: (uploaded: number, total: number) => void;
}): Promise<MediaGatewayUploadResult> {
  return uploadFileDirectlyToRustFs(args.file, args.folder, args.onPartUploaded);
}

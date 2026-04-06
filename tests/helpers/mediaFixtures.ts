import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".m4a", ".aac", ".aif", ".aiff", ".flac"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm"]);

export interface MediaFixtureInventory {
  rootDir: string;
  audio: string[];
  video: string[];
  other: string[];
}

export function getMediaFixturesDir() {
  return path.resolve(process.cwd(), process.env.TEST_MEDIA_DIR || ".local-fixtures/media");
}

export function listMediaFixtures(dir = getMediaFixturesDir()): MediaFixtureInventory {
  if (!existsSync(dir)) {
    return { rootDir: dir, audio: [], video: [], other: [] };
  }

  const entries = readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(dir, name))
    .filter((entry) => statSync(entry).isFile())
    .sort((a, b) => a.localeCompare(b));

  const audio: string[] = [];
  const video: string[] = [];
  const other: string[] = [];

  for (const entry of entries) {
    const extension = path.extname(entry).toLowerCase();
    if (AUDIO_EXTENSIONS.has(extension)) {
      audio.push(entry);
      continue;
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
      video.push(entry);
      continue;
    }
    other.push(entry);
  }

  return { rootDir: dir, audio, video, other };
}

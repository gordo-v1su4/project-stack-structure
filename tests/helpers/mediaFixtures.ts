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

  const entries = collectMediaFixtureFiles(dir);

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

  return { rootDir: dir, audio: sortMediaEntries(audio), video: sortMediaEntries(video), other: sortMediaEntries(other) };
}

function collectMediaFixtureFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) => {
      const entry = path.join(dir, name);
      const stats = statSync(entry);
      if (stats.isDirectory()) return collectMediaFixtureFiles(entry);
      return stats.isFile() ? [entry] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function sortMediaEntries(entries: string[]): string[] {
  return entries.sort((left, right) => mediaPriority(left) - mediaPriority(right) || left.localeCompare(right));
}

function mediaPriority(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes("fullsong") || name.includes("full song") || name.includes("master")) return 0;
  if (name.includes("stem") || name.includes("vocal")) return 20;
  return 10;
}

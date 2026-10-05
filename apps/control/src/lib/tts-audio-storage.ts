import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_TTS_AUDIO_BYTES = 10 * 1024 * 1024;
const UUID = "[0-9a-f-]{36}";
const ASSET_KEY_PATTERN = new RegExp(`^tts/(${UUID})/(${UUID})\\.(mp3|wav|ogg)$`, "i");
const DEFAULT_TTS_AUDIO_STORAGE_DIR = "/home/lightworld/webapps/ipresenterplux/storage";

function storageRoot() {
  const configured = process.env.TTS_AUDIO_STORAGE_DIR?.trim();
  if (!configured) return DEFAULT_TTS_AUDIO_STORAGE_DIR;
  if (!path.isAbsolute(configured)) return DEFAULT_TTS_AUDIO_STORAGE_DIR;
  return path.normalize(configured);
}

function expectedContentType(extension: string) {
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg") return "audio/ogg";
  return null;
}

function hasValidMagic(extension: string, header: Buffer) {
  if (extension === "wav") {
    return header.subarray(0, 4).toString("ascii") === "RIFF"
      && header.subarray(8, 12).toString("ascii") === "WAVE";
  }
  if (extension === "ogg") return header.subarray(0, 4).toString("ascii") === "OggS";
  if (extension === "mp3") {
    const id3 = header.subarray(0, 3).toString("ascii") === "ID3";
    const frame = header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
    return id3 || frame;
  }
  return false;
}

type StoredAsset = {
  assetKey: string;
  contentType: string;
  size: number;
  fullPath: string;
};

async function inspectStoredTtsAsset(
  assetKey: string,
  jobId: string,
  contentType: string,
  leaseToken?: string
): Promise<StoredAsset | null> {
  const matched = ASSET_KEY_PATTERN.exec(assetKey);
  if (!matched) return null;
  if (matched[1].toLowerCase() !== jobId.toLowerCase()) return null;
  if (leaseToken && matched[2].toLowerCase() !== leaseToken.toLowerCase()) return null;

  const extension = matched[3].toLowerCase();
  if (expectedContentType(extension) !== contentType) return null;

  const root = storageRoot();
  const fullPath = path.join(/* turbopackIgnore: true */ root, assetKey);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  let info;
  try {
    info = await stat(/* turbopackIgnore: true */ fullPath);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size <= 0 || info.size > MAX_TTS_AUDIO_BYTES) return null;

  const handle = await open(/* turbopackIgnore: true */ fullPath, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 4 || !hasValidMagic(extension, header.subarray(0, bytesRead))) return null;
  } finally {
    await handle.close();
  }

  return { assetKey, contentType, size: info.size, fullPath };
}

export async function verifyStoredTtsAsset(
  assetKey: string,
  jobId: string,
  leaseToken: string,
  contentType: string
) {
  const asset = await inspectStoredTtsAsset(assetKey, jobId, contentType, leaseToken);
  return asset ? { assetKey: asset.assetKey, contentType: asset.contentType, size: asset.size } : null;
}

export async function readStoredTtsAsset(
  assetKey: string,
  jobId: string,
  contentType: string
) {
  const asset = await inspectStoredTtsAsset(assetKey, jobId, contentType);
  if (!asset) return null;

  try {
    const data = await readFile(/* turbopackIgnore: true */ asset.fullPath);
    if (data.length !== asset.size) return null;
    return { data, contentType: asset.contentType, size: asset.size };
  } catch {
    return null;
  }
}

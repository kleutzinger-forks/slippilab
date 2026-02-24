import fs from "fs";
import path from "path";

const slpDir = path.resolve(process.cwd(), "data/slp");

console.log(`[storage] slpDir: ${slpDir}`);
fs.mkdirSync(slpDir, { recursive: true });
console.log(`[storage] mkdirSync done, exists: ${fs.existsSync(slpDir)}`);

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array
): Promise<void> {
  const filePath = path.join(slpDir, key);
  console.log(`[storage] writing ${filePath} (${body.length} bytes)`);
  fs.writeFileSync(filePath, body);
  console.log(`[storage] write done, exists: ${fs.existsSync(filePath)}`);
}

export async function downloadFile(key: string): Promise<Uint8Array | null> {
  const filePath = path.join(slpDir, key);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return new Uint8Array(fs.readFileSync(filePath));
}

export async function deleteFile(key: string): Promise<void> {
  const filePath = path.join(slpDir, key);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function deleteAllFiles(): void {
  for (const file of fs.readdirSync(slpDir)) {
    fs.unlinkSync(path.join(slpDir, file));
  }
}

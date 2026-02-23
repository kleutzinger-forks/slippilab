import fs from "fs";
import path from "path";

const slpDir = path.resolve(process.cwd(), "data/slp");

fs.mkdirSync(slpDir, { recursive: true });

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array
): Promise<void> {
  fs.writeFileSync(path.join(slpDir, key), body);
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

// Byte-level patcher for the `startAt` ISO 8601 timestamp embedded in the UBJSON
// metadata section of a Slippi replay. Ported from replay-manager-for-slippi's
// `writeReplays` (src/main/replay.ts), which locates the `startAt` field via its
// UBJSON tag and rewrites its length-prefixed string in place — safe for any new
// timestamp length, unlike a whole-file fixed-length ASCII search/replace.

// "{U\x03raw[$U#l" — start of the top-level `{ raw: [...], metadata: {...} }` object.
const RAW_HEADER_START = new Uint8Array([
  0x7b, 0x55, 0x03, 0x72, 0x61, 0x77, 0x5b, 0x24, 0x55, 0x23, 0x6c,
]);

// UBJSON encoding of the object key/value tag `U\x07startAt` followed by the
// string-type + length-type markers (`S`, `U`) that precede the length byte.
const START_AT_TAG = new Uint8Array([
  0x55, 0x07, 0x73, 0x74, 0x61, 0x72, 0x74, 0x41, 0x74, 0x53, 0x55,
]);

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  );
}

function findSubarray(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  for (let i = from; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

// Patches the `startAt` string in a .slp file's metadata to `newIso`, growing or
// shrinking the file as needed. Returns null if the file doesn't look like a
// valid replay or has no `startAt` field.
export function patchSlpStartAt(bytes: Uint8Array, newIso: string): Uint8Array | null {
  if (bytes.length < 15) return null;
  for (let i = 0; i < RAW_HEADER_START.length; i++) {
    if (bytes[i] !== RAW_HEADER_START[i]) return null;
  }

  const rawElementLength = readUint32BE(bytes, 11);
  const rawElementReadLength = rawElementLength > 0 ? rawElementLength : bytes.length - 15;
  const metadataOffset = 15 + rawElementReadLength;
  if (metadataOffset > bytes.length) return null;

  const metadata = bytes.subarray(metadataOffset);
  const tagOffset = findSubarray(metadata, START_AT_TAG);
  if (tagOffset === -1) return null;

  const startAtLengthOffset = tagOffset + START_AT_TAG.length;
  const oldLength = metadata[startAtLengthOffset]!;
  const newBytes = new TextEncoder().encode(newIso);
  const newLength = newBytes.length;
  if (newLength > 255) return null; // UBJSON `U` length prefix is a single byte

  const diff = newLength - oldLength;
  const newMetadata = new Uint8Array(metadata.length + diff);
  newMetadata.set(metadata.subarray(0, startAtLengthOffset), 0);
  newMetadata[startAtLengthOffset] = newLength;
  newMetadata.set(newBytes, startAtLengthOffset + 1);
  newMetadata.set(
    metadata.subarray(startAtLengthOffset + 1 + oldLength),
    startAtLengthOffset + 1 + newLength
  );

  const out = new Uint8Array(metadataOffset + newMetadata.length);
  out.set(bytes.subarray(0, metadataOffset), 0);
  out.set(newMetadata, metadataOffset);
  return out;
}

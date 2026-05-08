// Byte-level patcher for the `startAt` ISO 8601 timestamp embedded in the UBJSON
// metadata section of a Slippi replay. Ported from the slpIngestAndroid app
// (src/services/replayPatchService.ts). The replacement is the same length as
// the original so the surrounding UBJSON structure stays valid.

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
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

function encodeAscii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function patchOnce(
  bytes: Uint8Array,
  oldStr: string,
  newStr: string
): Uint8Array | null {
  if (oldStr.length !== newStr.length) return null;
  const oldB = encodeAscii(oldStr);
  const newB = encodeAscii(newStr);
  const idx = findSubarray(bytes, oldB);
  if (idx === -1) return null;
  const out = new Uint8Array(bytes);
  out.set(newB, idx);
  return out;
}

// Slippi typically writes startAt as 20-char "YYYY-MM-DDTHH:MM:SSZ", but some
// producers use the 24-char form with milliseconds. Try both.
export function patchSlpStartAt(
  bytes: Uint8Array,
  oldIso: string,
  newIso: string
): Uint8Array | null {
  const old24 = oldIso;
  const new24 = newIso;
  const old20 = old24.slice(0, 19) + "Z";
  const new20 = new24.slice(0, 19) + "Z";
  return (
    patchOnce(bytes, old20, new20) ?? patchOnce(bytes, old24, new24)
  );
}

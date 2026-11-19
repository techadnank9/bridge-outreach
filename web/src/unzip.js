// Pulls Connections.csv out of the zip LinkedIn emails, in the browser, so the founder never has to open it.
// No library: a zip ends with a table of contents (the central directory) that says where each file starts,
// and each file is either stored as is or deflated, which the browser's DecompressionStream can undo.

const u16 = (v, at) => v.getUint16(at, true);
const u32 = (v, at) => v.getUint32(at, true);

export const isZip = async (file) => {
  if (/\.zip$/i.test(file.name || "")) return true;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04; // "PK\3\4"
};

// Returns the text of Connections.csv, or throws an Error with a plain message for the page to show.
export async function connectionsCsvFromZip(file) {
  const buf = await file.arrayBuffer();
  const v = new DataView(buf);
  // The end record sits in the last 22 bytes, or further back if the zip has a comment (at most 65,535 bytes).
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (u32(v, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("This zip file could not be read. Download it from LinkedIn again, or drop Connections.csv on its own.");
  const count = u16(v, end + 10);
  let at = u32(v, end + 16);
  if (at === 0xffffffff || count === 0xffff) throw new Error("This zip is too large to open here. Open it and drop Connections.csv on its own.");
  const names = [];
  let found = null;
  for (let n = 0; n < count && at + 46 <= buf.byteLength; n++) {
    if (u32(v, at) !== 0x02014b50) break;
    const method = u16(v, at + 10), size = u32(v, at + 20), nameLen = u16(v, at + 28);
    const skip = nameLen + u16(v, at + 30) + u16(v, at + 32);
    const name = new TextDecoder().decode(new Uint8Array(buf, at + 46, nameLen));
    const local = u32(v, at + 42);
    names.push(name);
    // LinkedIn puts it at the top of the archive; if there are several, the one nearest the top wins.
    if (/(^|\/)connections\.csv$/i.test(name) && (!found || name.split("/").length < found.name.split("/").length)) found = { name, method, size, local };
    at += 46 + skip;
  }
  if (!found) {
    throw new Error(names.length
      ? "This zip has no Connections.csv. On LinkedIn's export page choose \"Download larger data archive\", which includes connections."
      : "This zip file could not be read. Download it from LinkedIn again, or drop Connections.csv on its own.");
  }
  if (found.size === 0xffffffff) throw new Error("Connections.csv in this zip is too large to open here. Open the zip and drop the file on its own.");
  // The file's own header repeats the name and may carry a different extra field, so read its lengths there.
  if (u32(v, found.local) !== 0x04034b50) throw new Error("This zip file could not be read. Download it from LinkedIn again.");
  const start = found.local + 30 + u16(v, found.local + 26) + u16(v, found.local + 28);
  const data = new Uint8Array(buf, start, found.size);
  let bytes;
  if (found.method === 0) bytes = data; // stored without compression
  else if (found.method === 8) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot open zip files. Open the zip and drop Connections.csv instead, or use a current Chrome, Safari or Firefox.");
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw new Error("This browser could not unpack the zip. Open it and drop Connections.csv instead.");
    }
  } else throw new Error("This zip uses a compression this page cannot open. Open it and drop Connections.csv instead.");
  return new TextDecoder("utf-8").decode(bytes);
}

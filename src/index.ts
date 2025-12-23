import { POGHash } from "./types/pog";
import { downloadScripts } from "./crawler/crawler";
import fingerprintCollector from "./fingerprint-collector";
import { evaluate } from "./lib-scorer";
import fs from "fs";

export async function detectLibrary(url: string) {
  console.log(`Detecting libraries from: ${url}`);
  const hashes: POGHash[] = [];
  const filePaths = await downloadScripts(url);
  for (const filePath of filePaths) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const fingerprints = fingerprintCollector(raw);
      for (const hash of fingerprints) {
        hashes.push(hash);
      }
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }
  const uniqueHashes = Array.from(
    new Map(hashes.map((hash) => [hash.hash, hash])).values()
  );
  const h: Record<number, string[]> = {};
  for (const hash of uniqueHashes) {
    if (!h[hash.nodes]) {
      h[hash.nodes] = [];
    }
    h[hash.nodes].push(hash.hash);
  }
  const scores = evaluate(h, { threshold: 0.2 });
  console.log("DETECTED LIBRARIES:");
  for (const score of scores) {
    const type3Version = score.type3Versions.join("@");
    const type2Version = score.type2Versions.join("@");
    const topVersion = score.topVersions.join("@");
    const version = type3Version || type2Version || topVersion;
    console.log(
      `${score.libName === "react-dom" ? "react" : score.libName}@${version}`
    );
  }
}

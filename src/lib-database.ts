import escodegen from "escodegen";
import fs, { readFileSync } from "fs";
import path, { join } from "path";
import semverSort from "semver/functions/sort";
import semverValid from "semver/functions/valid";
import fingerprintCollector from "./fingerprint-collector";
import { POGHash } from "./types/pog";

// Types
type HashData = Record<
  string,
  Record<string, Record<number, Array<[number, number]>>>
>;
type LibData = Record<
  string,
  { id: number; versions: string[]; hashCnt: number[] }
>;

const rootDir = process.cwd();

const parseVersionString = (version: string) => {
  const [major, minor, patch = "0"] = version.split(".");
  const [patchVersion, patchSuffix = "0"] = patch.split("-");
  return [
    parseInt(major),
    parseInt(minor),
    parseInt(patchVersion),
    patchSuffix,
  ];
};

const countLines = (code: string) => code.split("\n").length;

const hashFilename = join(rootDir, `./data/all-hash.json`);
const libFilename = join(rootDir, `./data/all-libs.json`);
const outputDir = join(rootDir, "./data");
fs.mkdirSync(outputDir, { recursive: true });

const cdnDataDirPath = join(rootDir, "./data/cdn");

/**
 * Checks if a version string follows semantic versioning without suffix
 * @param version - The version string to check
 * @returns Array of version numbers or false if invalid
 */
/**
 * Recursively gets all files from a directory
 * @param dirPath - Directory path to scan
 * @param basePath - Base path for generating relative paths
 * @returns Array of relative file paths
 */
function getAllFiles(dirPath: string, basePath: string = dirPath): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  let result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(basePath, fullPath);

    if (entry.isFile()) {
      result.push(relativePath);
    } else if (entry.isDirectory()) {
      result = result.concat(getAllFiles(fullPath, basePath));
    }
  }

  return result;
}

function isJS(files: string[]): string[] {
  return files.filter(
    (file) =>
      file.endsWith("js") || file.endsWith("mjs") || file.endsWith("cjs")
  );
}

/**
 * Main function to process libraries and generate hash data
 */
(async () => {
  const start = Date.now();
  let allLibs: LibData = {};
  let allHashes: HashData = {};
  try {
    let libIdx = 0;

    const libNames = fs.readdirSync(cdnDataDirPath);

    for (const libName of libNames) {
      console.log("processing", libName);
      allLibs[libName] = { id: libIdx, versions: [], hashCnt: [] };
      const versions = fs.readdirSync(join(cdnDataDirPath, libName));
      let versionIdx = 0;
      const v = versions.filter(
        (version) =>
          semverValid(version) && parseVersionString(version)[3] === "0"
      );
      for (const version of semverSort(v)) {
        const hashes: POGHash[] = [];
        const files = getAllFiles(join(cdnDataDirPath, libName, version));
        for (const file of isJS(files)) {
          try {
            const code = readFileSync(
              join(cdnDataDirPath, libName, version, file),
              "utf-8"
            );
            try {
              const hash = fingerprintCollector(code);
              hashes.push(...hash);
              const filteredHash = hash.filter((h) => {
                const body = escodegen.generate(h.body);
                const lines = countLines(body);
                return lines < 8;
              });
              hashes.push(...filteredHash);
            } catch (hashError) {
              console.log(
                "[Hash error]",
                (hashError as Error).message,
                libName,
                version,
                file
              );
            }
          } catch (readError) {
            console.log(
              "[Read error]",
              (readError as Error).message,
              libName,
              version,
              file
            );
          }
        }

        const uniqueHashes = Array.from(
          new Map(hashes.map((hash) => [hash.hash, hash])).values()
        );

        if (uniqueHashes.length === 0) continue;

        allLibs[libName].versions.push(version);
        allLibs[libName].hashCnt.push(uniqueHashes.length);

        uniqueHashes.forEach(({ hash, nodes }) => {
          if (allHashes[nodes]) {
            if (allHashes[nodes][hash]) {
              if (allHashes[nodes][hash][libIdx]) {
                const prevHash = allHashes[nodes][hash][libIdx];
                if (prevHash[prevHash.length - 1][1] === versionIdx - 1)
                  allHashes[nodes][hash][libIdx][prevHash.length - 1][1] =
                    versionIdx;
                else
                  allHashes[nodes][hash][libIdx].push([versionIdx, versionIdx]);
              } else {
                allHashes[nodes][hash][libIdx] = [[versionIdx, versionIdx]];
              }
            } else {
              allHashes[nodes][hash] = {
                [libIdx]: [[versionIdx, versionIdx]],
              };
            }
          } else {
            allHashes[nodes] = {
              [hash]: {
                [libIdx]: [[versionIdx, versionIdx]],
              },
            };
          }
        });
        versionIdx++;
      }
      libIdx++;
    }
  } catch (e) {
    console.error("error", (e as Error).message);
    console.log("write", hashFilename, "before I die..");
    console.log("write", libFilename, "before I die..");
    fs.writeFileSync(
      hashFilename.split(".")[0] + "error" + ".json",
      JSON.stringify(allHashes, null, 2)
    );
    fs.writeFileSync(
      libFilename.split(".")[0] + "error" + ".json",
      JSON.stringify(allLibs, null, 2)
    );
  }

  console.log("finish", Date.now() - start, "ms");
  fs.writeFileSync(hashFilename, JSON.stringify(allHashes, null, 2));
  fs.writeFileSync(libFilename, JSON.stringify(allLibs, null, 2));
})();

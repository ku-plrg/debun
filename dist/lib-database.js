"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const escodegen_1 = __importDefault(require("escodegen"));
const fs_1 = __importStar(require("fs"));
const path_1 = __importStar(require("path"));
const sort_1 = __importDefault(require("semver/functions/sort"));
const valid_1 = __importDefault(require("semver/functions/valid"));
const fingerprint_collector_1 = __importDefault(require("./fingerprint-collector"));
const rootDir = process.cwd();
const parseVersionString = (version) => {
    const [major, minor, patch = "0"] = version.split(".");
    const [patchVersion, patchSuffix = "0"] = patch.split("-");
    return [
        parseInt(major),
        parseInt(minor),
        parseInt(patchVersion),
        patchSuffix,
    ];
};
const countLines = (code) => code.split("\n").length;
const hashFilename = (0, path_1.join)(rootDir, `./data/all-hash.json`);
const libFilename = (0, path_1.join)(rootDir, `./data/all-libs.json`);
const outputDir = (0, path_1.join)(rootDir, "./data");
fs_1.default.mkdirSync(outputDir, { recursive: true });
const cdnDataDirPath = (0, path_1.join)(rootDir, "./data/cdn");
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
function getAllFiles(dirPath, basePath = dirPath) {
    const entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
    let result = [];
    for (const entry of entries) {
        const fullPath = path_1.default.join(dirPath, entry.name);
        const relativePath = path_1.default.relative(basePath, fullPath);
        if (entry.isFile()) {
            result.push(relativePath);
        }
        else if (entry.isDirectory()) {
            result = result.concat(getAllFiles(fullPath, basePath));
        }
    }
    return result;
}
function isJS(files) {
    return files.filter((file) => file.endsWith("js") || file.endsWith("mjs") || file.endsWith("cjs"));
}
/**
 * Main function to process libraries and generate hash data
 */
(async () => {
    const start = Date.now();
    let allLibs = {};
    let allHashes = {};
    try {
        let libIdx = 0;
        const libNames = fs_1.default.readdirSync(cdnDataDirPath);
        for (const libName of libNames) {
            console.log("processing", libName);
            allLibs[libName] = { id: libIdx, versions: [], hashCnt: [] };
            const versions = fs_1.default.readdirSync((0, path_1.join)(cdnDataDirPath, libName));
            let versionIdx = 0;
            const v = versions.filter((version) => (0, valid_1.default)(version) && parseVersionString(version)[3] === "0");
            for (const version of (0, sort_1.default)(v)) {
                const hashes = [];
                const files = getAllFiles((0, path_1.join)(cdnDataDirPath, libName, version));
                for (const file of isJS(files)) {
                    try {
                        const code = (0, fs_1.readFileSync)((0, path_1.join)(cdnDataDirPath, libName, version, file), "utf-8");
                        try {
                            const hash = (0, fingerprint_collector_1.default)(code);
                            hashes.push(...hash);
                            const filteredHash = hash.filter((h) => {
                                const body = escodegen_1.default.generate(h.body);
                                const lines = countLines(body);
                                return lines < 8;
                            });
                            hashes.push(...filteredHash);
                        }
                        catch (hashError) {
                            console.log("[Hash error]", hashError.message, libName, version, file);
                        }
                    }
                    catch (readError) {
                        console.log("[Read error]", readError.message, libName, version, file);
                    }
                }
                const uniqueHashes = Array.from(new Map(hashes.map((hash) => [hash.hash, hash])).values());
                if (uniqueHashes.length === 0)
                    continue;
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
                            }
                            else {
                                allHashes[nodes][hash][libIdx] = [[versionIdx, versionIdx]];
                            }
                        }
                        else {
                            allHashes[nodes][hash] = {
                                [libIdx]: [[versionIdx, versionIdx]],
                            };
                        }
                    }
                    else {
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
    }
    catch (e) {
        console.error("error", e.message);
        console.log("write", hashFilename, "before I die..");
        console.log("write", libFilename, "before I die..");
        fs_1.default.writeFileSync(hashFilename.split(".")[0] + "error" + ".json", JSON.stringify(allHashes, null, 2));
        fs_1.default.writeFileSync(libFilename.split(".")[0] + "error" + ".json", JSON.stringify(allLibs, null, 2));
    }
    console.log("finish", Date.now() - start, "ms");
    fs_1.default.writeFileSync(hashFilename, JSON.stringify(allHashes, null, 2));
    fs_1.default.writeFileSync(libFilename, JSON.stringify(allLibs, null, 2));
})();

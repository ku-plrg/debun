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
exports.buildDatabase = buildDatabase;
const fs_1 = __importStar(require("fs"));
const path_1 = require("path");
const sort_1 = __importDefault(require("semver/functions/sort"));
const valid_1 = __importDefault(require("semver/functions/valid"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const index_1 = __importDefault(require("../fingerprint-collector/index"));
const parseVersionString = (version) => {
    const [major, minor, patch = '0'] = version.split('.');
    const [patchVersion, patchSuffix = '0'] = patch.split('-');
    return [
        parseInt(major),
        parseInt(minor),
        parseInt(patchVersion),
        patchSuffix,
    ];
};
async function buildDatabase(dirPath) {
    var _a;
    let allLibs = {};
    let allHashes = {};
    let libId = 0;
    const libNames = fs_1.default.readdirSync(dirPath);
    for (const libName of libNames) {
        let hashes = [];
        const versions = fs_1.default.readdirSync((0, path_1.join)(dirPath, libName));
        const validVersions = versions.filter((version) => (0, valid_1.default)(version) && parseVersionString(version)[3] === '0');
        const sortedVersions = (0, sort_1.default)(validVersions);
        let versionIdx = 0;
        for (const version of sortedVersions) {
            hashes = [];
            const versionPath = (0, path_1.join)(dirPath, libName, version);
            const preferredDirs = ['src', 'lib', 'source', 'dist', 'closure', 'js'];
            const targetDirs = preferredDirs.filter((dir) => {
                const dirPath = (0, path_1.join)(versionPath, dir);
                return fs_1.default.existsSync(dirPath) && fs_1.default.statSync(dirPath).isDirectory();
            });
            const patterns = targetDirs.length > 0
                ? targetDirs.map((dir) => `${dir}/**/*.{js,cjs,mjs}`)
                : ['**/*.{js,cjs,mjs}'];
            const files = await (0, fast_glob_1.default)(patterns, { cwd: versionPath });
            for (const file of files) {
                try {
                    const code = (0, fs_1.readFileSync)((0, path_1.join)(versionPath, file), 'utf-8');
                    try {
                        const newHashes = (0, index_1.default)(code);
                        hashes.push(...newHashes);
                    }
                    catch (hashError) { }
                }
                catch (readError) { }
            }
            const uniq = new Map();
            for (const h of hashes) {
                if (h.nodes > 6)
                    uniq.set(h.hash, h);
            }
            const uniqueHashes = [...uniq.values()];
            allLibs[libId] ?? (allLibs[libId] = { name: libName, versions: [], hashCnt: [] });
            allLibs[libId].versions.push(version);
            allLibs[libId].hashCnt.push(uniqueHashes.length);
            for (const { hash, nodes } of uniqueHashes) {
                allHashes[nodes] ?? (allHashes[nodes] = {});
                (_a = allHashes[nodes])[hash] ?? (_a[hash] = {});
                if (allHashes[nodes][hash][libId]) {
                    const prevHash = allHashes[nodes][hash][libId];
                    const lastRange = prevHash[prevHash.length - 1];
                    if (lastRange[1] === versionIdx - 1) {
                        lastRange[1] = versionIdx;
                    }
                    else {
                        prevHash.push([versionIdx, versionIdx]);
                    }
                }
                else {
                    allHashes[nodes][hash][libId] = [[versionIdx, versionIdx]];
                }
            }
            versionIdx++;
        }
        libId++;
    }
    return { allLibs, allHashes };
}

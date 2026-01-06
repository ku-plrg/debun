#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectLibrary = detectLibrary;
const crawler_1 = require("./crawler/crawler");
const fingerprint_collector_1 = __importDefault(require("./fingerprint-collector"));
const lib_scorer_1 = require("./lib-scorer");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function detectLibrary(urlOrpath) {
    console.log(`Detecting libraries from: ${urlOrpath}`);
    const hashes = [];
    let filePaths = [];
    if (urlOrpath.startsWith('http://') || urlOrpath.startsWith('https://')) {
        filePaths = await (0, crawler_1.downloadScripts)(urlOrpath);
    }
    else {
        const collectFilesRecursively = (p) => {
            const stat = fs_1.default.statSync(p);
            if (stat.isFile())
                return [p];
            return fs_1.default.readdirSync(p, { withFileTypes: true }).flatMap((entry) => {
                const fullPath = path_1.default.join(p, entry.name);
                if (entry.isDirectory())
                    return collectFilesRecursively(fullPath);
                if (entry.isFile() && fullPath.endsWith('.js'))
                    return [fullPath];
                return [];
            });
        };
        filePaths = collectFilesRecursively(urlOrpath);
    }
    for (const filePath of filePaths) {
        let raw;
        try {
            raw = fs_1.default.readFileSync(filePath, 'utf-8');
        }
        catch (e) {
            continue;
        }
        const fingerprints = (0, fingerprint_collector_1.default)(raw);
        for (const hash of fingerprints) {
            hashes.push(hash);
        }
    }
    const uniqueHashes = Array.from(new Map(hashes.map((hash) => [hash.hash, hash])).values());
    const h = {};
    for (const hash of uniqueHashes) {
        if (!h[hash.nodes]) {
            h[hash.nodes] = [];
        }
        h[hash.nodes].push(hash.hash);
    }
    const scores = (0, lib_scorer_1.evaluate)(h, { threshold: 0.2 });
    console.log('DETECTED LIBRARIES:');
    for (const score of scores) {
        const type3Version = score.type3Versions.join('@');
        const type2Version = score.type2Versions.join('@');
        const topVersion = score.topVersions.join('@');
        const version = type3Version || type2Version || topVersion;
        console.log(`${score.libName === 'react-dom' ? 'react' : score.libName}@${version}`);
    }
}
if (require.main === module) {
    const [, , url] = process.argv;
    if (!url) {
        console.error('Usage: ts-node src/index.ts <url>');
        process.exit(1);
    }
    detectLibrary(url).catch((error) => {
        console.error('Failed to detect libraries:', error);
        process.exit(1);
    });
}

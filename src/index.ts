#!/usr/bin/env node

import { POGHash } from './types/pog';
import { downloadScripts } from './crawler/crawler';
import fingerprintCollector from './fingerprint-collector';
import { evaluate } from './lib-scorer';
import fs from 'fs';
import path from 'path';

function getAllFiles(dirPath: string, basePath: string = dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const stat = fs.statSync(dirPath);
  if (stat.isFile()) {
    return [basePath === dirPath ? dirPath : path.relative(basePath, dirPath)];
  }
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

export async function detectLibrary(urlOrpath: string) {
  console.log(`Detecting libraries from: ${urlOrpath}`);
  const hashes: POGHash[] = [];
  let filePaths: string[] = [];
  if (urlOrpath.startsWith('http://') || urlOrpath.startsWith('https://')) {
    filePaths = await downloadScripts(urlOrpath);
  } else {
    filePaths = getAllFiles(urlOrpath);
  }
  for (const filePath of filePaths) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      continue;
    }
    const fingerprints = fingerprintCollector(raw);
    for (const hash of fingerprints) {
      hashes.push(hash);
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
  console.log('DETECTED LIBRARIES:');
  for (const score of scores) {
    const type3Version = score.type3Versions.join('@');
    const type2Version = score.type2Versions.join('@');
    const topVersion = score.topVersions.join('@');
    const version = type3Version || type2Version || topVersion;
    console.log(
      `${score.libName === 'react-dom' ? 'react' : score.libName}@${version}`
    );
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

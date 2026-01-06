#!/usr/bin/env node

import { POGHash } from './types/pog';
import { downloadScripts } from './crawler/crawler';
import fingerprintCollector from './fingerprint-collector';
import { evaluate } from './lib-scorer';
import fs from 'fs';
import path from 'path';

export async function detectLibrary(urlOrpath: string) {
  console.log(`Detecting libraries from: ${urlOrpath}`);
  const hashes: POGHash[] = [];
  let filePaths: string[] = [];
  if (urlOrpath.startsWith('http://') || urlOrpath.startsWith('https://')) {
    filePaths = await downloadScripts(urlOrpath);
  } else {
    const collectFilesRecursively = (p: string): string[] => {
      const stat = fs.statSync(p);
      if (stat.isFile()) return [p];
      return fs.readdirSync(p, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(p, entry.name);
        if (entry.isDirectory()) return collectFilesRecursively(fullPath);
        if (entry.isFile() && fullPath.endsWith('.js')) return [fullPath];
        return [];
      });
    };
    filePaths = collectFilesRecursively(urlOrpath);
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
  if (scores.length === 0) {
    console.log('❌ No libraries detected.');
    return;
  }
  console.log('✅ DETECTED LIBRARIES:');
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

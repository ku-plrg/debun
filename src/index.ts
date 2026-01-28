#!/usr/bin/env node

import { Score, POGHash } from './types/types';
import { downloadScripts } from './crawler/crawler';
import fingerprintCollector from './fingerprint-collector';
import { evaluate } from './lib-scorer';
import fs from 'fs';
import path from 'path';
import { logger } from './utils/logger';

export async function detectLibrary(urlOrpath: string) {
  logger.info(`Detecting libraries from: ${urlOrpath}`);
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

  logger.debug(`Found ${filePaths.length} JavaScript files`);
  const mergeUnique = (target: string[], source: string[]) => {
    for (const item of source) {
      if (!target.includes(item)) target.push(item);
    }
  };
  const merged = new Map<string, Score>();

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      logger.warn(`Failed to read file: ${filePath}`);
      continue;
    }
    const fingerprints = fingerprintCollector(raw);
    const hashes: Record<number, string[]> = {};
    for (const fp of fingerprints) {
      if (!hashes[fp.nodes]) {
        hashes[fp.nodes] = [];
      }
      if (!hashes[fp.nodes].includes(fp.hash)) {
        hashes[fp.nodes].push(fp.hash);
      }
    }

    const scores = evaluate(hashes, {
      SCORE_THRESHOLD: 0.2,
      MIN_FUNCTION_COUNT: 5,
    });
    for (const score of scores) {
      const existing = merged.get(score.libName);
      if (!existing) {
        merged.set(score.libName, { ...score });
        continue;
      }

      mergeUnique(existing.topVersions, score.topVersions);
      mergeUnique(existing.type2Versions, score.type2Versions);
      mergeUnique(existing.type3Versions, score.type3Versions);
    }
  }
  const scores = [...merged.values()];
  if (scores.length === 0) {
    logger.info('No libraries detected.');
    return;
  }
  logger.info('✅ DETECTED LIBRARIES:');
  for (const score of scores) {
    const type3Version = score.type3Versions.join('@');
    const type2Version = score.type2Versions.join('@');
    const topVersion = score.topVersions.join('@');
    const version = type3Version || type2Version || topVersion;
    logger.info(
      `${score.libName === 'react-dom' ? 'react' : score.libName}@${version}`
    );
  }
}

if (require.main === module) {
  const [, , url] = process.argv;
  if (!url) {
    logger.error('Usage: ts-node src/index.ts <url>');
    process.exit(1);
  }
  detectLibrary(url).catch((error) => {
    logger.error('Failed to detect libraries:', error);
    process.exit(1);
  });
}

import fs from 'fs';
import path from 'path';
import { EvalOptions, LibData, HashData, Score } from './types/types';
const blacklistDir = path.join(__dirname, './data');

const loadData = () => {
  const libInfos: LibData = JSON.parse(
    fs.readFileSync(path.join(__dirname, `./data/all-libs.json`), 'utf-8')
  );

  const libHashes: HashData = JSON.parse(
    fs.readFileSync(path.join(__dirname, `./data/all-hash.json`), 'utf-8')
  );
  const intraDupHashes: Record<
    string,
    Record<string, Record<string, [number, number][]>>
  > = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, `./data/intra-dups-hash.json`),
      'utf-8'
    )
  );

  const intraDupLibs: Record<string, Record<string, number>> = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, `./data/intra-dups-libs.json`),
      'utf-8'
    )
  );

  const rawBlacklist: Record<string, string[]> = JSON.parse(
    fs.readFileSync(path.join(blacklistDir, `blacklist.json`), 'utf-8')
  );

  const blacklist: Record<string, Set<string>> = {};
  for (const [nodes, hashes] of Object.entries(rawBlacklist)) {
    blacklist[nodes] = new Set(hashes);
  }

  return {
    libInfos,
    libHashes,
    intraDupHashes,
    intraDupLibs,
    blacklist,
  };
};

const { libInfos, libHashes, intraDupHashes, intraDupLibs, blacklist } =
  loadData();

const determineType = (matches: Record<string, [number, number][]>): number => {
  const keys = Object.keys(matches);
  if (keys.length !== 1) return 1;

  const ranges = matches[keys[0]];
  if (ranges.length !== 1) return 2;

  const [vFrom, vTo] = ranges[0];
  return vFrom === vTo ? 3 : 2;
};

const rangeIncludes = (ranges: [number, number][], value: number): boolean => {
  for (const [start, end] of ranges) {
    if (value >= start && value <= end) return true;
  }
  return false;
};

const computeMatches = (
  webHashes: Record<number, string[]>
): {
  totalMatches: Map<number, Map<number, number>>;
  type3Matches: Map<number, Map<number, number>>;
  type2Matches: Map<number, Map<number, number>>;
} => {
  const totalMatches = new Map<number, Map<number, number>>();
  const type3Matches = new Map<number, Map<number, number>>();
  const type2Matches = new Map<number, Map<number, number>>();

  const entries = Object.entries(webHashes);
  for (let i = 0; i < entries.length; i++) {
    const [nodes, hashes] = entries[i];
    const nodeHashes = libHashes[nodes];
    if (!nodeHashes) continue;

    const nodeBlacklist = blacklist[nodes];

    for (let j = 0; j < hashes.length; j++) {
      const hash = hashes[j];
      if (nodeBlacklist?.has(hash)) continue;

      const matches = nodeHashes[hash];
      if (!matches) continue;

      const matchType = determineType(matches);

      const matchEntries = Object.entries(matches);
      for (let k = 0; k < matchEntries.length; k++) {
        const [lIdxStr, vIdxes] = matchEntries[k];
        const lIdx = parseInt(lIdxStr, 10);

        let libTotal = totalMatches.get(lIdx);
        if (!libTotal) {
          libTotal = new Map();
          totalMatches.set(lIdx, libTotal);
        }

        let libType3: Map<number, number> | undefined;
        let libType2: Map<number, number> | undefined;

        if (matchType === 3) {
          libType3 = type3Matches.get(lIdx);
          if (!libType3) {
            libType3 = new Map();
            type3Matches.set(lIdx, libType3);
          }
        } else if (matchType === 2) {
          libType2 = type2Matches.get(lIdx);
          if (!libType2) {
            libType2 = new Map();
            type2Matches.set(lIdx, libType2);
          }
        }

        for (let m = 0; m < vIdxes.length; m++) {
          const [start, end] = vIdxes[m];
          for (let vIdx = start; vIdx <= end; vIdx++) {
            if (intraDupHashes[nodes]?.[hash]?.[lIdx]) {
              const ranges = intraDupHashes[nodes][hash][lIdx];
              if (rangeIncludes(ranges, vIdx)) break;
            }
            libTotal.set(vIdx, (libTotal.get(vIdx) || 0) + 1);

            if (matchType === 3) {
              libType3!.set(vIdx, (libType3!.get(vIdx) || 0) + 1);
            } else if (matchType === 2) {
              libType2!.set(vIdx, (libType2!.get(vIdx) || 0) + 1);
            }
          }
        }
      }
    }
  }

  return { totalMatches, type3Matches, type2Matches };
};

const computeScores = (
  totalMatches: Map<number, Map<number, number>>,
  type3Matches: Map<number, Map<number, number>>,
  type2Matches: Map<number, Map<number, number>>,
  options: EvalOptions
): Score[] => {
  const scores: Score[] = [];

  totalMatches.forEach((matches, lIdx) => {
    const lib = libInfos[lIdx];
    if (!lib) return;

    const type3Versions: string[] = [];
    const type2Versions: string[] = [];
    let topType2VersionCount = 0;
    let topScore = 0;
    let topScoreStr = '';
    const topVersions: string[] = [];

    const libType3 = type3Matches.get(lIdx);
    const libType2 = type2Matches.get(lIdx);

    matches.forEach((score, vIdx) => {
      if (score < options.MIN_FUNCTION_COUNT) return;

      const hashCnt = lib.hashCnt[vIdx];
      const percentage = score / (hashCnt - (intraDupLibs[lIdx]?.[vIdx] ?? 0));

      if (percentage <= options.SCORE_THRESHOLD) return;

      const type3Count = libType3?.get(vIdx) || 0;
      const type2Count = libType2?.get(vIdx) || 0;
      const currentVersionStr = lib.versions[vIdx];

      if (type3Count > 0) {
        type3Versions.push(currentVersionStr);
      }

      if (type2Count > 3) {
        if (type2Count > topType2VersionCount) {
          topType2VersionCount = type2Count;
          type2Versions.length = 0;
        }
        if (type2Count === topType2VersionCount) {
          type2Versions.push(currentVersionStr);
        }
      }

      if (percentage > topScore) {
        topScore = percentage;
        topScoreStr = `${score}/${hashCnt}`;
        topVersions.length = 0;
        topVersions.push(currentVersionStr);
      } else if (percentage === topScore) {
        topVersions.push(currentVersionStr);
      }
    });

    if (topScore > 0 && topVersions.length > 0) {
      scores.push({
        libName: lib.name,
        topVersions,
        type2Versions,
        type3Versions,
      });
    }
  });

  return scores;
};

export const evaluate = (
  hashes: Record<number, string[]>,
  options: EvalOptions
): Score[] => {
  const { totalMatches, type3Matches, type2Matches } = computeMatches(hashes);
  return computeScores(totalMatches, type3Matches, type2Matches, options);
};

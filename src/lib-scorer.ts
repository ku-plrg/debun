import fs from "fs";
import path from "path";

interface Score {
  libName: string;
  topVersions: string[];
  topScore: number;
  topScoreStr: string;
  type3Versions: string[];
  type2Versions: string[];
}

const WEB_BLACKLIST_THRESHOLD = 0.6;
const DUP_THRESHOLD = 0.3;
const MIN_FUNCTION_COUNT = 5;

const blacklistcache: Record<string, Record<string, string[]>> = {};
const intraduphashCache: Record<
  string,
  Record<string, Record<string, Record<string, [number, number][]>>>
> = {};
const intraduplibCache: Record<
  string,
  Record<string, Record<string, number>>
> = {};

export const evaluate = (
  uniqueHashes: Record<string, string[]>,
  options: { threshold: number },
  method: string = "",
  url: string = ""
): Score[] => {
  const allWebHashes: Record<string, Record<string, string[]>> = {};

  const libInfos: Record<
    string,
    { id: number; versions: string[]; hashCnt: number[] }
  > = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, `../../data/debun-hashes/all-libs${method}.json`),
      "utf-8"
    )
  );

  const libHashes: Record<
    string,
    Record<string, Record<string, [number, number][]>>
  > = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, `../../data/debun-hashes/all-hash${method}.json`),
      "utf-8"
    )
  );

  if (Object.keys(uniqueHashes).length === 0) {
    uniqueHashes = allWebHashes[url];
  }
  const blacklist = (blacklistcache[WEB_BLACKLIST_THRESHOLD] = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        `../../data/debun-hashes/blacklist-${WEB_BLACKLIST_THRESHOLD}${method}.json`
      ),
      "utf-8"
    )
  ));

  const intraDupHashes: Record<
    string,
    Record<string, Record<string, [number, number][]>>
  > = (intraduphashCache[`${DUP_THRESHOLD}`] = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        `../../data/debun-hashes/dups-${DUP_THRESHOLD}-hash${method}.json`
      ),
      "utf-8"
    )
  ));

  const intraDupLibs: Record<
    string,
    Record<string, number>
  > = (intraduplibCache[`${DUP_THRESHOLD}`] = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        `../../data/debun-hashes/dups-${DUP_THRESHOLD}-libs${method}.json`
      ),
      "utf-8"
    )
  ));

  let totalMatches: Record<string, Record<number, number>> = {};
  let type3Matches: Record<string, Record<number, number>> = {};
  let type2Matches: Record<string, Record<number, number>> = {};

  Object.entries(uniqueHashes).forEach(([nodes, hashes]) => {
    hashes.forEach((hash) => {
      if (!libHashes[nodes]?.[hash]) return;
      if (blacklist[nodes]?.includes(hash)) return;
      const matches = libHashes[nodes][hash];
      const matchType = determineType(matches);
      Object.entries(matches).forEach(([lIdx, vIdxes]) => {
        if (totalMatches[lIdx] === undefined) totalMatches[lIdx] = {};
        vIdxes.forEach(([start, end]) => {
          for (let vIdx = start; vIdx <= end; vIdx++) {
            if (intraDupHashes[nodes]?.[hash]?.[lIdx]) {
              const ranges = intraDupHashes[nodes][hash][lIdx];
              if (rangeIncludes(ranges, vIdx)) return;
            }
            if (!totalMatches[lIdx][vIdx]) totalMatches[lIdx][vIdx] = 0;
            totalMatches[lIdx][vIdx]++;
            if (matchType === 3) {
              if (!type3Matches[lIdx]) type3Matches[lIdx] = {};
              if (!type3Matches[lIdx][vIdx]) type3Matches[lIdx][vIdx] = 0;
              type3Matches[lIdx][vIdx]++;
            }
            if (matchType === 2) {
              if (!type2Matches[lIdx]) type2Matches[lIdx] = {};
              if (!type2Matches[lIdx][vIdx]) type2Matches[lIdx][vIdx] = 0;
              type2Matches[lIdx][vIdx]++;
            }
          }
        });
      });
    });
  });

  const scores: Score[] = [];

  Object.entries(totalMatches).forEach(([lIdx, matches]) => {
    const lib = Object.entries(libInfos).find(
      ([_, libInfo]) => libInfo.id.toString() === lIdx
    );
    if (!lib) return;

    let type3Versions: string[] = [];
    let type2Versions: string[] = [];
    let topType2VersionCount = 0;
    let topScore = 0;
    let topScoreStr = "";
    let topVersions: string[] = [];

    Object.entries(matches).forEach(([vIdx, score]) => {
      if (score < MIN_FUNCTION_COUNT) return;

      const percentage =
        score /
        (lib[1].hashCnt[parseFloat(vIdx)] - (intraDupLibs[lIdx]?.[vIdx] ?? 0));
      const type3Count = type3Matches[lIdx]?.[parseFloat(vIdx)] || 0;
      const type2Count = type2Matches[lIdx]?.[parseFloat(vIdx)] || 0;

      if (!(percentage > options.threshold)) return;
      const currentVersionStr = lib[1].versions[parseFloat(vIdx)];
      if (type3Count > 0) {
        type3Versions.push(currentVersionStr);
      }
      if (type2Count > 3) {
        if (type2Count > topType2VersionCount) {
          topType2VersionCount = type2Count;
          type2Versions = [];
        }
        if (type2Count === topType2VersionCount) {
          type2Versions.push(currentVersionStr);
        }
      }
      if (percentage > topScore) {
        topScore = percentage;
        topScoreStr = `${score}/${lib[1].hashCnt[parseFloat(vIdx)]}`;
        topVersions = [currentVersionStr];
      } else if (percentage === topScore) {
        topVersions.push(currentVersionStr);
      }
    });
    if (topScore > 0 && topVersions.length > 0) {
      scores.push({
        libName: lib[0],
        topVersions,
        topScore,
        topScoreStr,
        type2Versions,
        type3Versions,
      });
    }
  });

  return scores;
};

const determineType = (matches: Record<string, [number, number][]>) => {
  if (Object.keys(matches).length === 1) {
    // type 2: only one library!
    if (Object.values(matches)[0].length === 1) {
      const [[[vFrom, vTo]]] = Object.values(matches);
      if (vFrom === vTo) return 3; // type 3: only one version!
    }
    return 2;
  }
  return 1; // type 1: others..
};

const rangeIncludes = (ranges: [number, number][], value: number): boolean => {
  for (const [start, end] of ranges) {
    if (value >= start && value <= end) return true;
  }
  return false;
};

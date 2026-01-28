import { HashData, LibData } from '../types/types';

export function mergeHashData(
  data1: HashData,
  data2: HashData,
  libcnt: number
): HashData {
  const merged = { ...data1 };

  for (const nodes in data2) {
    if (!merged[nodes]) {
      merged[nodes] = {};
    }

    for (const hash in data2[nodes]) {
      if (!merged[nodes][hash]) {
        merged[nodes][hash] = {};
      }

      for (const libIdx in data2[nodes][hash]) {
        const key = Number(libIdx) + libcnt;
        if (!merged[nodes][hash][key]) {
          merged[nodes][hash][key] = [];
        }

        merged[nodes][hash][key].push(...data2[nodes][hash][libIdx]);
      }
    }
  }

  return merged;
}

export function mergeLibData(data1: LibData, data2: LibData) {
  const merged = { ...data1 };

  const libcnt = Math.max(0, ...Object.keys(merged).map(Number)) + 1;

  for (const libIdx in data2) {
    const key = Number(libIdx) + libcnt;
    merged[key] = data2[libIdx];
  }

  return { mergedLibData: merged, libcnt: libcnt };
}

export function mergeDatabases(
  hashData1: HashData,
  libData1: LibData,
  hashData2: HashData,
  libData2: LibData
): { mergedHashData: HashData; mergedLibData: LibData } {
  const { mergedLibData, libcnt } = mergeLibData(libData1, libData2);
  const mergedHashData = mergeHashData(hashData1, hashData2, libcnt);

  return { mergedHashData, mergedLibData };
}

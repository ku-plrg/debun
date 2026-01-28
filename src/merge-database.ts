import { HashData, LibData } from './types/types';

export function mergeHashData(
  data1: HashData,
  data2: HashData,
  lib_data1: number
): HashData {
  const merged = { ...data1 };

  for (const graphSize in data2) {
    if (!merged[graphSize]) {
      merged[graphSize] = {};
    }

    for (const hash in data2[graphSize]) {
      if (!merged[graphSize][hash]) {
        merged[graphSize][hash] = {};
      }

      for (const libIdx in data2[graphSize][hash]) {
        const key = Number(libIdx) + lib_data1;
        if (!merged[graphSize][hash][key]) {
          merged[graphSize][hash][key] = [];
        }

        merged[graphSize][hash][key].push(...data2[graphSize][hash][key]);
      }
    }
  }

  return merged;
}

export function mergeLibData(data1: LibData, data2: LibData) {
  const merged = { ...data1 };

  const libcnt = Object.keys(merged).length;

  for (const libIdx in data2) {
    const key = Number(libIdx) + libcnt;
    merged[key] = data2[libIdx];
  }

  return { mergedLibData: merged, lib_data1: libcnt };
}

export function mergeDatabases(
  hashData1: HashData,
  libData1: LibData,
  hashData2: HashData,
  libData2: LibData
): { mergedHashData: HashData; mergedLibData: LibData } {
  const { mergedLibData, lib_data1 } = mergeLibData(libData1, libData2);
  const mergedHashData = mergeHashData(hashData1, hashData2, lib_data1);

  return { mergedHashData, mergedLibData };
}

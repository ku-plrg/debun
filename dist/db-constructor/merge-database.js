"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeHashData = mergeHashData;
exports.mergeLibData = mergeLibData;
exports.mergeDatabases = mergeDatabases;
function mergeHashData(data1, data2, lib_data1) {
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
function mergeLibData(data1, data2) {
    const merged = { ...data1 };
    const libcnt = Object.keys(merged).length;
    for (const libIdx in data2) {
        const key = Number(libIdx) + libcnt;
        merged[key] = data2[libIdx];
    }
    return { mergedLibData: merged, lib_data1: libcnt };
}
function mergeDatabases(hashData1, libData1, hashData2, libData2) {
    const { mergedLibData, lib_data1 } = mergeLibData(libData1, libData2);
    const mergedHashData = mergeHashData(hashData1, hashData2, lib_data1);
    return { mergedHashData, mergedLibData };
}

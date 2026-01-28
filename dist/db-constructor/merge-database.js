"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeHashData = mergeHashData;
exports.mergeLibData = mergeLibData;
exports.mergeDatabases = mergeDatabases;
function mergeHashData(data1, data2, lib_data1) {
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
                const key = Number(libIdx) + lib_data1;
                if (!merged[nodes][hash][key]) {
                    merged[nodes][hash][key] = [];
                }
                merged[nodes][hash][key].push(...data2[nodes][hash][libIdx]);
            }
        }
    }
    return merged;
}
function mergeLibData(data1, data2) {
    const merged = { ...data1 };
    const libcnt = Math.max(0, ...Object.keys(merged).map(Number));
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function measureTime(label, fn) {
    const start = process.hrtime();
    const result = fn();
    const [seconds, nanoseconds] = process.hrtime(start);
    //console.log(`${label} took ${seconds}s ${nanoseconds / 1000000}ms`);
    const ms = seconds * 1000 + nanoseconds / 1000000;
    return { value: result, ms };
}
exports.default = measureTime;

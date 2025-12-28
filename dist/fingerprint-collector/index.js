"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const function_collector_1 = __importDefault(require("./function-collector"));
const hash_function_1 = __importDefault(require("./hash-function"));
const pog_generator_1 = __importDefault(require("./pog-generator"));
function fingerprintCollector(raw, options = [true, true, true]) {
    const functions = (0, function_collector_1.default)(raw);
    const pogs = (0, pog_generator_1.default)(functions, options);
    const hash = (0, hash_function_1.default)(pogs);
    return hash;
}
exports.default = fingerprintCollector;

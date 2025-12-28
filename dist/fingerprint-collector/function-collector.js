"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const meriyah_1 = require("meriyah");
const walk_1 = __importDefault(require("../utils/walk"));
const FUNC_ID = true;
let functions = [];
function recordFunction(node) {
    if (!node.body)
        return;
    const body = stripFunctions(node.body);
    if (FUNC_ID) {
        if (node.type === 'ArrowFunctionExpression' && node.expression)
            functions.push({
                id: getId(body),
                body: {
                    ...node,
                    body: body,
                },
            });
        else
            functions.push({
                id: getId(body),
                body: {
                    ...node,
                    body: {
                        type: 'BlockStatement',
                        body: [body],
                    },
                },
            });
        return;
    }
    functions.push({
        body,
    });
}
function stripFunctions(node) {
    if (!node)
        return node;
    if (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') {
        if (!node.body)
            return node;
        recordFunction(node);
        return node.type === 'FunctionDeclaration'
            ? { type: 'EmptyStatement' }
            : {
                type: node.type,
                id: null,
                params: [],
                generator: false,
                async: false,
                body: {
                    type: 'BlockStatement',
                    body: [],
                },
            };
    }
    // Process all child nodes
    Object.entries(node).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    if (value[i] && typeof value[i] === 'object') {
                        value[i] = stripFunctions(value[i]);
                    }
                }
            }
            else {
                node[key] = stripFunctions(value);
            }
        }
    });
    return node;
}
// check if JSCA_ id symbol is injected in the function body
function getId(node) {
    let value;
    (0, walk_1.default)(node, {
        CallExpression(node) {
            if (node.type === 'CallExpression' &&
                node.callee.type === 'Identifier' &&
                node.callee.name === 'Symbol' &&
                node.arguments.length > 0 &&
                node.arguments[0].type === 'Literal' &&
                typeof node.arguments[0].value === 'string') {
                const symbolValue = node.arguments[0].value;
                if (value === undefined && symbolValue.startsWith('JSCA_')) {
                    value = symbolValue;
                }
            }
        },
        TemplateLiteral(node) {
            if (node.type !== 'TemplateLiteral')
                return;
            const templateValue = node.quasis[0]?.value.raw;
            if (value === undefined && templateValue.startsWith('JSCA_')) {
                value = templateValue;
            }
        },
        Literal(node) {
            if (node.type === 'Literal' &&
                value === undefined &&
                typeof node.value === 'string' &&
                node.value.startsWith('JSCA_')) {
                value = node.value;
            }
        },
    });
    return value || '';
}
function extractFunctions(code) {
    functions = [];
    let ast;
    try {
        ast = (0, meriyah_1.parse)(code, {
            next: true,
            module: false,
        });
    }
    catch (e) {
        ast = (0, meriyah_1.parse)(code, {
            next: true,
            module: true,
        });
    }
    stripFunctions(ast);
    return functions;
}
exports.default = extractFunctions;

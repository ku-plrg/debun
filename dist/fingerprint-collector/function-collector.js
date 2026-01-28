"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const meriyah_1 = require("meriyah");
const estree_walker_1 = require("estree-walker");
function isFunctionNode(node) {
    return (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression');
}
function recordFunction(node, functions) {
    const body = stripFunctions(node.body, functions);
    functions.push({ body });
}
function stripFunctions(node, functions) {
    (0, estree_walker_1.walk)(node, {
        enter(child) {
            if (isFunctionNode(child)) {
                recordFunction(child, functions);
                const createEmptyBody = () => ({
                    type: 'BlockStatement',
                    body: [],
                });
                const replacement = (() => {
                    if (child.type === 'FunctionDeclaration' ||
                        child.type === 'FunctionExpression') {
                        return {
                            ...child,
                            body: createEmptyBody(),
                        };
                    }
                    return {
                        ...child,
                        body: child.expression
                            ? { type: 'Identifier', name: '_' }
                            : createEmptyBody(),
                    };
                })();
                this.replace(replacement);
                return;
            }
        },
    });
    return node;
}
function extractFunctions(code) {
    const functions = [];
    let ast;
    const sourceTypes = [
        'script',
        'module',
        'commonjs',
    ];
    let lastError;
    for (const sourceType of sourceTypes) {
        try {
            ast = (0, meriyah_1.parse)(code, {
                next: true,
                sourceType,
            });
            break;
        }
        catch (e) {
            lastError = e;
        }
    }
    if (!ast)
        throw lastError;
    stripFunctions(ast, functions);
    return functions;
}
exports.default = extractFunctions;

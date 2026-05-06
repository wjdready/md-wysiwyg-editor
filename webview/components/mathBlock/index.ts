/**
 * 数学公式组件 — 支持行内公式 ($...$) 和块公式 ($$...$$)
 *
 * 基于 remark-math 和 KaTeX 实现，提供可编辑的公式节点
 */

import { $node, $remark, $inputRule, $prose } from "@milkdown/utils";
import remarkMath from "remark-math";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { schemaCtx } from "@milkdown/core";
import { nodeRule } from "@milkdown/prose";
import { textblockTypeInputRule } from "@milkdown/prose/inputrules";
import { keymap } from "@milkdown/prose/keymap";
import { TextSelection, NodeSelection } from "@milkdown/prose/state";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./mathBlock.css";

// ─── remark-math 插件 ───────────────────────────────────────────────────────

export const remarkMathPlugin = $remark("remarkMath", () => remarkMath);

// ─── ProseMirror Schema 定义 ────────────────────────────────────────────────

export const inlineMathSchema = $node("inlineMath", () => ({
    group: "inline",
    inline: true,
    atom: true,
    attrs: {
        value: { default: "" },
    },
    parseDOM: [
        {
            tag: "span[data-type='math_inline']",
            getAttrs: (dom: any) => ({
                value: (dom as HTMLElement).getAttribute("data-value") || "",
            }),
        },
    ],
    toDOM: (node: ProseMirrorNode) => [
        "span",
        {
            "data-type": "math_inline",
            "data-value": node.attrs.value,
            class: "math-inline",
        },
        `$${node.attrs.value}$`,
    ],
    parseMarkdown: {
        match: (node: any) => node.type === "inlineMath",
        runner: (state: any, node: any, type: any) => {
            state.addNode(type, { value: node.value || "" });
        },
    },
    toMarkdown: {
        match: (node: any) => node.type.name === "inlineMath",
        runner: (state: any, node: any) => {
            state.addNode("inlineMath", undefined, node.attrs.value || "");
        },
    },
}));

export const mathBlockSchema = $node("mathBlock", () => ({
    group: "block",
    atom: false,
    content: "text*",
    code: true,
    defining: true,
    attrs: {
        value: { default: "" },
    },
    parseDOM: [
        {
            tag: "div[data-type='math_display']",
            preserveWhitespace: "full",
            getAttrs: (dom: any) => ({
                value: (dom as HTMLElement).getAttribute("data-value") || "",
            }),
        },
    ],
    toDOM: (node: ProseMirrorNode) => [
        "div",
        {
            "data-type": "math_display",
            "data-value": node.attrs.value,
            class: "math-block",
        },
        `$$\n${node.attrs.value}\n$$`,
    ],
    parseMarkdown: {
        match: (node: any) => node.type === "math",
        runner: (state: any, node: any, type: any) => {
            state.addNode(type, { value: node.value || "" });
        },
    },
    toMarkdown: {
        match: (node: any) => node.type.name === "mathBlock",
        runner: (state: any, node: any) => {
            state.addNode("math", undefined, node.attrs.value || "");
        },
    },
}));

// ─── 输入规则 ───────────────────────────────────────────────────────────────

// 行内公式输入规则：$...$ 触发
const mathInlineInputRule = $inputRule((ctx) => {
    const schema = ctx.get(schemaCtx);
    return nodeRule(/\$([^\s$][^$]*?)\$$/, schema.nodes.inlineMath, {
        getAttr: (match) => ({
            value: match[1] || '',
        }),
    });
});

// 块公式输入规则：$$ 后按空格或回车触发
const mathBlockInputRule = $inputRule((ctx) => {
    const schema = ctx.get(schemaCtx);
    return textblockTypeInputRule(/^\$\$[\s\n]$/, schema.nodes.mathBlock, () => ({
        value: '',
    }));
});

// 组合输入规则插件
export const mathInputRulePlugin = [mathInlineInputRule, mathBlockInputRule];

// 块公式键盘处理：回车键删除空公式块，退格键选中/删除节点
const mathBlockBackspacePlugin = $prose((ctx) => {
    const schema = ctx.get(schemaCtx);
    return keymap({
        "Enter": (state, dispatch) => {
            const { selection } = state;
            if (!(selection instanceof TextSelection)) {
                return false;
            }

            const { $from } = selection;
            const parent = $from.parent;

            // 检查是否在空的 mathBlock 内
            if (parent.type === schema.nodes.mathBlock && parent.textContent === "") {
                // 内容为空：删除整个节点，插入新段落
                if (dispatch) {
                    const pos = $from.before();
                    const tr = state.tr.replaceWith(
                        pos,
                        pos + parent.nodeSize,
                        schema.nodes.paragraph.create()
                    );
                    // 光标移到新段落开头
                    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
                    dispatch(tr);
                }
                return true;
            }

            return false;
        },
        "Backspace": (state, dispatch) => {
            const { selection } = state;

            // 处理 NodeSelection：直接删除选中的 mathBlock 节点
            if (selection instanceof NodeSelection && selection.node.type === schema.nodes.mathBlock) {
                if (dispatch) {
                    dispatch(state.tr.deleteSelection());
                }
                return true;
            }

            if (!(selection instanceof TextSelection)) {
                return false;
            }

            const { $from } = selection;
            const parent = $from.parent;

            // 检查是否在 mathBlock 内
            if (parent.type === schema.nodes.mathBlock && selection.empty) {
                // 光标在开头
                if ($from.parentOffset === 0) {
                    if (parent.textContent === "") {
                        // 内容为空：直接删除整个节点
                        if (dispatch) {
                            const pos = $from.before();
                            dispatch(state.tr.delete(pos, pos + parent.nodeSize));
                        }
                        return true;
                    } else {
                        // 内容不为空：选中整个节点
                        if (dispatch) {
                            const pos = $from.before();
                            const nodeSelection = NodeSelection.create(state.doc, pos);
                            dispatch(state.tr.setSelection(nodeSelection));
                        }
                        return true;
                    }
                }
            }

            // 检查光标是否在段落开头，且前一个节点是 mathBlock
            if (selection.empty && $from.parentOffset === 0) {
                const startOfBlock = $from.before($from.depth);
                if (startOfBlock > 0) {
                    const nodeBefore = state.doc.resolve(startOfBlock).nodeBefore;
                    if (nodeBefore && nodeBefore.type === schema.nodes.mathBlock) {
                        // 选中前面的 mathBlock 节点
                        if (dispatch) {
                            const nodeSelection = NodeSelection.create(
                                state.doc,
                                startOfBlock - nodeBefore.nodeSize
                            );
                            dispatch(state.tr.setSelection(nodeSelection));
                        }
                        return true;
                    }
                }
            }

            return false;
        },
        "Delete": (state, dispatch) => {
            const { selection } = state;

            // 处理 NodeSelection：删除选中的 mathBlock 节点
            if (selection instanceof NodeSelection && selection.node.type === schema.nodes.mathBlock) {
                if (dispatch) {
                    dispatch(state.tr.deleteSelection());
                }
                return true;
            }

            return false;
        },
    });
});

export const mathBlockKeymapPlugin = mathBlockBackspacePlugin;

// ─── NodeView 实现 ──────────────────────────────────────────────────────────

export function createInlineMathView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined
) {
    const container = document.createElement("span");
    container.className = "math-inline-container";

    const rendered = document.createElement("span");
    rendered.className = "math-inline-rendered";

    const editorWrapper = document.createElement("div");
    editorWrapper.className = "math-inline-editor-wrapper";

    const editor = document.createElement("textarea");
    editor.className = "math-inline-editor";
    editor.value = node.attrs.value || "";
    editor.rows = 1;

    const renderMath = (value: string) => {
        try {
            const html = katex.renderToString(value || "", {
                throwOnError: false,
                displayMode: false,
                trust: (context: any) => ['\\htmlId', '\\href', '\\tag'].includes(context.command),
            });
            rendered.innerHTML = html;
        } catch (e) {
            rendered.textContent = `$${value}$`;
        }
    };

    const autoResize = () => {
        // 计算内容宽度
        const minWidth = 184;
        const maxWidth = 584;
        const charWidth = 8; // 大约每个字符的宽度
        const padding = 16; // 左右 padding 总和
        const contentWidth = Math.max(minWidth, Math.min(maxWidth, editor.value.length * charWidth + padding));
        editor.style.width = contentWidth + "px";

        // 自动调整高度
        editor.style.height = "auto";
        editor.style.height = Math.max(24, editor.scrollHeight) + "px";
    };

    renderMath(node.attrs.value);

    const enterEditMode = () => {
        container.classList.add("editing");
        autoResize();
        editor.focus();
        editor.select();
    };

    const exitEditMode = () => {
        container.classList.remove("editing");
    };

    if (!node.attrs.value) {
        setTimeout(enterEditMode, 0);
    }

    rendered.onclick = enterEditMode;

    editor.oninput = () => {
        autoResize();
        renderMath(editor.value);
        const pos = getPos();
        if (pos !== undefined) {
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                value: editor.value,
            }));
        }
    };

    editor.onblur = exitEditMode;

    editor.onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            exitEditMode();
        } else if (e.key === "Escape") {
            editor.value = node.attrs.value || "";
            renderMath(node.attrs.value);
            exitEditMode();
        }
    };

    editorWrapper.appendChild(editor);
    container.appendChild(editorWrapper);
    container.appendChild(rendered);

    return {
        dom: container,
        update: (newNode: ProseMirrorNode) => {
            if (newNode.type.name !== "inlineMath") return false;
            if (newNode.attrs.value !== editor.value) {
                editor.value = newNode.attrs.value || "";
                renderMath(newNode.attrs.value);
                autoResize();
            }
            return true;
        },
        ignoreMutation: () => true,
        stopEvent: (event: Event) => editor.contains(event.target as Node),
    };
}

export function createMathBlockView(
    node: ProseMirrorNode,
    view: EditorView,
    getPos: () => number | undefined
) {
    const container = document.createElement("div");
    container.className = "math-block-container";

    const editorWrapper = document.createElement("div");
    editorWrapper.className = "math-editor-wrapper";

    const editor = document.createElement("textarea");
    editor.className = "math-editor";
    editor.value = node.attrs.value || "";

    const preview = document.createElement("div");
    preview.className = "math-preview";

    const autoResize = () => {
        editor.style.height = "auto";
        editor.style.height = Math.max(40, editor.scrollHeight) + "px";
    };

    const renderMath = () => {
        try {
            const html = katex.renderToString(editor.value || "", {
                throwOnError: false,
                displayMode: true,
                trust: (context) => ['\\htmlId', '\\href', '\\tag'].includes(context.command),
            });
            preview.innerHTML = html;
            preview.style.color = "";
            preview.style.background = "";
        } catch (e) {
            preview.textContent = `${e}`;
            preview.style.color = "var(--vscode-errorForeground)";
            preview.style.background = "var(--vscode-inputValidation-errorBackground)";
        }
    };

    renderMath();
    autoResize();

    const enterEditMode = () => {
        container.classList.add("editing");
        editor.focus();
        autoResize();
    };

    const exitEditMode = () => {
        container.classList.remove("editing");
    };

    if (!node.attrs.value) {
        setTimeout(enterEditMode, 0);
    }

    preview.onclick = enterEditMode;

    editor.oninput = () => {
        renderMath();
        autoResize();
        const pos = getPos();
        if (pos !== undefined) {
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                value: editor.value,
            }));
        }
    };

    editor.onkeydown = (e) => {
        // 空内容时按回车键：删除整个公式块，插入新段落
        if (e.key === "Enter" && editor.value === "") {
            e.preventDefault();
            const pos = getPos();
            if (pos !== undefined) {
                const tr = view.state.tr.replaceWith(
                    pos,
                    pos + node.nodeSize,
                    view.state.schema.nodes.paragraph.create()
                );
                // 光标移到新段落开头
                tr.setSelection(TextSelection.create(tr.doc, pos + 1));
                view.dispatch(tr);
                view.focus();
            }
        }
        // 空内容时按退格键：直接删除整个公式块
        else if (e.key === "Backspace" && editor.value === "" && editor.selectionStart === 0) {
            e.preventDefault();
            const pos = getPos();
            if (pos !== undefined) {
                view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
                view.focus();
            }
        }
    };

    editor.onblur = exitEditMode;

    editorWrapper.appendChild(editor);
    container.appendChild(editorWrapper);
    container.appendChild(preview);

    return {
        dom: container,
        update: (newNode: ProseMirrorNode) => {
            if (newNode.type.name !== "mathBlock") return false;
            if (newNode.attrs.value !== editor.value) {
                editor.value = newNode.attrs.value || "";
                renderMath();
                autoResize();
            }
            return true;
        },
        ignoreMutation: () => true,
        stopEvent: (event: Event) => editor.contains(event.target as Node),
    };
}

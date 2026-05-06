/**
 * 数学公式组件 — 支持行内公式 ($...$) 和块公式 ($$...$$)
 *
 * 基于 remark-math 和 KaTeX 实现，提供可编辑的公式节点
 */

import { $node, $remark } from "@milkdown/utils";
import remarkMath from "remark-math";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./mathBlock.css";

// ─── remark-math 插件 ───────────────────────────────────────────────────────

export const remarkMathPlugin = $remark("remarkMath", () => remarkMath as any);

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
    atom: true,
    attrs: {
        value: { default: "" },
    },
    parseDOM: [
        {
            tag: "div[data-type='math_display']",
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

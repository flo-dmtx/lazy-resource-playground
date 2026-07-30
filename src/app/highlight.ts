const TOKENS =
    /(\/\/[^\n]*|&lt;!--[\s\S]*?--&gt;)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|(@(?:if|else|switch|case|default|let|for|defer)\b|\b(?:import|export|from|const|let|readonly|return|new|if|else|function|class|private|public|interface|type|extends|implements|typeof|true|false|null|undefined|this|async|await)\b)|([A-Za-z_$][\w$]*)(?=\()/g;

/** Just enough highlighting for curated TS, template and diff snippets. */
export function highlight(code: string, diff = false): string {
    if (!diff) {
        return highlightTokens(code);
    }
    return code
        .split("\n")
        .map((line) => {
            if (line.startsWith("+")) return `<span class="tok-add">${escapeHtml(line)}</span>`;
            if (line.startsWith("-")) return `<span class="tok-del">${escapeHtml(line)}</span>`;
            return highlightTokens(line);
        })
        .join("\n");
}

function highlightTokens(code: string): string {
    return escapeHtml(code).replace(TOKENS, (match, comment, str, keyword, call) => {
        if (comment) return `<span class="tok-com">${match}</span>`;
        if (str) return `<span class="tok-str">${match}</span>`;
        if (keyword) return `<span class="tok-kw">${match}</span>`;
        if (call) return `<span class="tok-fn">${match}</span>`;
        return match;
    });
}

function escapeHtml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

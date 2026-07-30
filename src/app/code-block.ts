import { Component, computed, inject, input } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";

import { highlight } from "./highlight";

@Component({
    selector: "code-block",
    template: `<pre class="code-block"><code [innerHTML]="html()"></code></pre>`,
})
export class CodeBlock {
    private readonly sanitizer = inject(DomSanitizer);

    readonly code = input.required<string>();
    readonly diff = input(false);

    // The HTML comes out of our own escape + wrap, never from user input.
    readonly html = computed<SafeHtml>(() =>
        this.sanitizer.bypassSecurityTrustHtml(highlight(this.code(), this.diff())),
    );
}

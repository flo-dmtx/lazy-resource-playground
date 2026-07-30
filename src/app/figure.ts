import { Component, computed, DestroyRef, ElementRef, inject, input, signal } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";

import { CodeBlock } from "./code-block";
import { DEMOS, editorUrl, STACKBLITZ_PROJECT } from "./demo-registry";

type Pane = "demo" | "ts" | "tpl";

/** One switch for the whole page: which syntax every code tab shows. */
export const codeSyntax = signal<"proposal" | "userland">("proposal");

/**
 * A docs-style tab group: the live demo, then its two sides of code. The demo is an
 * embedded demo-page (`/?demo=<name>&embed=1`) with its own network strip docked under
 * it, kept out of the tabs so it stays visible while the demo is manipulated. The same
 * page can be opened alone. Reset reloads the frame.
 */
@Component({
    selector: "app-figure",
    imports: [CodeBlock],
    template: `
        <figure>
            <div class="bar" role="tablist">
                <button
                    role="tab"
                    [attr.aria-selected]="pane() === 'demo'"
                    [class.is-active]="pane() === 'demo'"
                    (click)="pane.set('demo')"
                >
                    Demo
                </button>
                <button
                    role="tab"
                    [attr.aria-selected]="pane() === 'ts'"
                    [class.is-active]="pane() === 'ts'"
                    (click)="pane.set('ts')"
                >
                    component.ts
                </button>
                <button
                    role="tab"
                    [attr.aria-selected]="pane() === 'tpl'"
                    [class.is-active]="pane() === 'tpl'"
                    (click)="pane.set('tpl')"
                >
                    template.html
                </button>

                <div class="syntax" role="group" aria-label="code syntax">
                    <button
                        [class.on]="codeSyntax() === 'proposal'"
                        (click)="codeSyntax.set('proposal')"
                    >
                        lazy: true
                    </button>
                    <button
                        [class.on]="codeSyntax() === 'userland'"
                        (click)="codeSyntax.set('userland')"
                    >
                        lazyRxResource
                    </button>
                </div>
                <a class="tool" [href]="pageUrl()" target="_blank" rel="noopener">open ↗</a>
                @if (editor()) {
                    <a class="tool" [href]="editor()" target="_blank" rel="noopener">edit ↗</a>
                }
                <button class="tool" (click)="reset()">Reset</button>
            </div>

            <div class="demo-pane" [hidden]="pane() !== 'demo'">
                <iframe [src]="frameSrc()" [style.height.px]="frameHeight()" title="live demo"></iframe>
            </div>

            @if (pane() === "ts") {
                <code-block [code]="shownTs()"></code-block>
            }
            @if (pane() === "tpl") {
                <code-block [code]="tpl()"></code-block>
            }
        </figure>
    `,
    styles: `
        figure {
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--surface);
            box-shadow: var(--shadow);
            overflow: hidden;
        }

        .bar {
            display: flex;
            align-items: stretch;
            background: var(--surface-dim);
            border-bottom: 1px solid var(--border);
        }

        .bar > button[role="tab"] {
            font-size: 0.8125rem;
            font-weight: 500;
            color: var(--muted);
            background: none;
            border: none;
            border-right: 1px solid var(--border);
            box-shadow: inset 0 2px 0 transparent;
            padding: 0.55rem 1rem;
        }

        .bar > button[role="tab"]:hover {
            color: var(--text);
        }

        .bar > button[role="tab"].is-active {
            color: var(--text);
            background: var(--surface);
            box-shadow: inset 0 2px 0 var(--accent);
        }

        .bar > button[role="tab"]:nth-of-type(n + 2) {
            font-family: var(--mono);
            font-size: 0.75rem;
        }

        .syntax {
            margin-left: auto;
            align-self: center;
            display: flex;
            border: 1px solid var(--border-strong);
            border-radius: 99px;
            background: var(--surface);
            padding: 0.125rem;
        }

        .syntax button {
            font-family: var(--mono);
            font-size: 0.6875rem;
            font-weight: 500;
            color: var(--muted);
            background: none;
            border: none;
            border-radius: 99px;
            padding: 0.2rem 0.7rem;
        }

        .syntax button.on {
            background: var(--accent);
            color: var(--surface);
        }

        .tool {
            display: flex;
            align-items: center;
            border: none;
            border-left: 1px solid var(--border);
            margin-left: 0.625rem;
            padding: 0 0.875rem;
            background: none;
            font-size: 0.75rem;
            color: var(--faint);
            text-decoration: none;
            white-space: nowrap;
        }

        .tool + .tool {
            margin-left: 0;
        }

        .tool:hover {
            color: var(--text);
        }

        iframe {
            display: block;
            width: 100%;
            border: none;
            transition: height 180ms ease;
        }

        @media (max-width: 48rem) {
            .syntax {
                display: none;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            iframe {
                transition: none;
            }
        }
    `,
})
export class Figure {
    private readonly sanitizer = inject(DomSanitizer);
    private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

    readonly name = input.required<string>();
    readonly ts = input.required<string>();
    readonly tpl = input.required<string>();

    readonly pane = signal<Pane>("demo");
    readonly frameHeight = signal(320);
    readonly codeSyntax = codeSyntax;

    readonly shownTs = computed(() =>
        codeSyntax() === "proposal" ? this.ts() : toUserland(this.ts()),
    );

    // Relative to the page, so the app works hosted under a sub-path (GitHub Pages).
    readonly pageUrl = computed(() => `?demo=${this.name()}`);

    readonly frameSrc = computed(() =>
        this.sanitizer.bypassSecurityTrustResourceUrl(`?demo=${this.name()}&embed=1`),
    );

    readonly editor = computed(() => {
        const entry = DEMOS[this.name()];
        return STACKBLITZ_PROJECT && entry ? editorUrl(entry, this.name()) : "";
    });

    constructor() {
        const onHeight = (event: MessageEvent) => {
            if (event.origin === location.origin && event.data?.demo === this.name()) {
                this.frameHeight.set(event.data.height);
            }
        };
        window.addEventListener("message", onHeight);
        inject(DestroyRef).onDestroy(() => window.removeEventListener("message", onHeight));
    }

    reset(): void {
        this.host.nativeElement.querySelector("iframe")?.contentWindow?.location.reload();
    }
}

/** The userland syntax is the proposal one minus the option, on the dedicated function. */
function toUserland(ts: string): string {
    return ts.replace(/\brxResource(<[^>]*>)?\(\{\n(\s*)lazy: true,\n/g, "lazyRxResource$1({\n");
}

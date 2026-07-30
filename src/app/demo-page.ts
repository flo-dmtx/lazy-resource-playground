import { NgComponentOutlet } from "@angular/common";
import { Component, DestroyRef, inject } from "@angular/core";

import { DEMOS, DemoEntry, editorUrl, STACKBLITZ_PROJECT } from "./demo-registry";
import { NetworkLog } from "./network-log";
import { RequestLog } from "./request-log";

/**
 * One demo, alone on its page: `/?demo=chain`. This is what the figures embed
 * (`&embed=1` hides the standalone chrome and reports the content height to the parent).
 */
@Component({
    // Bootstrapped into the same index.html as App: main.ts picks one of the two.
    selector: "app-root",
    imports: [NgComponentOutlet, NetworkLog],
    providers: [RequestLog],
    template: `
        @if (entry) {
            @if (!embedded) {
                <header>
                    <a class="back" href="/">← the proposal</a>
                    <h1>{{ entry.title }}</h1>
                    <div class="tools">
                        @if (editor) {
                            <a [href]="editor" rel="noopener" target="_blank">edit on StackBlitz ↗</a>
                        }
                        <button class="ghost" (click)="reload()">Reset</button>
                    </div>
                </header>
            }
            <div class="frame" [class.standalone]="!embedded">
                <div class="stage">
                    <ng-container *ngComponentOutlet="entry.component"></ng-container>
                </div>
                <network-log></network-log>
            </div>
        } @else {
            <p class="missing">Unknown demo. <a href="/">Back to the proposal.</a></p>
        }
    `,
    styles: `
        :host {
            display: block;
        }

        header {
            max-width: 54rem;
            margin: 0 auto;
            padding: 1.5rem clamp(1rem, 3vw, 2rem) 0.875rem;
            display: flex;
            align-items: baseline;
            gap: 1.25rem;
        }

        h1 {
            font-size: 1.125rem;
            margin-right: auto;
        }

        .back {
            font-size: 0.8125rem;
            white-space: nowrap;
        }

        .tools {
            display: flex;
            align-items: center;
            gap: 0.875rem;
            font-size: 0.8125rem;
        }

        .frame {
            background: var(--surface);
        }

        .frame.standalone {
            max-width: 54rem;
            margin: 0 auto 3rem;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            overflow: hidden;
        }

        .stage {
            padding: 1.125rem;
        }

        .missing {
            padding: 3rem;
        }
    `,
})
export class DemoPage {
    readonly name = new URLSearchParams(location.search).get("demo") ?? "";
    readonly entry: DemoEntry | undefined = DEMOS[this.name];
    readonly embedded = new URLSearchParams(location.search).has("embed");
    readonly editor = STACKBLITZ_PROJECT && this.entry ? editorUrl(this.entry, this.name) : "";

    constructor() {
        if (this.embedded) {
            reportHeightToParent(this.name, inject(DestroyRef));
        }
    }

    reload(): void {
        location.reload();
    }
}

/** Embedded frames have no scrollbar: the parent figure sizes the iframe to fit. */
function reportHeightToParent(name: string, destroyRef: DestroyRef): void {
    const report = () =>
        window.parent.postMessage(
            // offsetHeight, not scrollHeight: the latter never shrinks below the viewport
            { demo: name, height: document.body.offsetHeight },
            location.origin,
        );
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    destroyRef.onDestroy(() => observer.disconnect());
}

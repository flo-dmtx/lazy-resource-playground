import { Component, inject, signal } from "@angular/core";
import { rxResource } from "@angular/core/rxjs-interop";

import { fakeFetch } from "./fake-api";
import { RequestLog } from "./request-log";

/** Each load takes a fresh measurement, so a re-fetch is visible in the value itself. */
let measurement = 0;

@Component({
    selector: "demo-while-tracked",
    template: `
        <div class="split">
            <div class="card">
                <header class="card-head">
                    <h3><code>load: "whenTracked"</code> <span class="tag">keeps</span></h3>
                    <button class="ghost" (click)="keptOpen.set(!keptOpen())">
                        {{ keptOpen() ? "Close panel" : "Open panel" }}
                    </button>
                </header>
                @if (keptOpen()) {
                    @if (kept.value(); as reading) {
                        <dl class="profile">
                            <dt>reading</dt>
                            <dd>{{ reading }}</dd>
                        </dl>
                        <p class="readout">close and reopen: same reading, no request</p>
                    } @else {
                        <p class="waiting">loading…</p>
                    }
                } @else {
                    <p class="void">Closed. The value, if loaded, is retained for the next open.</p>
                }
            </div>

            <div class="card">
                <header class="card-head">
                    <h3><code>load: "whileTracked"</code> <span class="tag">forgets</span></h3>
                    <div class="controls">
                        <button class="ghost" (click)="panelA.set(!panelA())">
                            {{ panelA() ? "Close A" : "Open A" }}
                        </button>
                        <button class="ghost" (click)="panelB.set(!panelB())">
                            {{ panelB() ? "Close B" : "Open B" }}
                        </button>
                    </div>
                </header>
                @if (panelA()) {
                    <div class="panel">
                        <span class="who">panel A</span>
                        @if (fresh.value(); as reading) {
                            <span>{{ reading }}</span>
                        } @else {
                            <span class="waiting">loading…</span>
                        }
                    </div>
                }
                @if (panelB()) {
                    <div class="panel">
                        <span class="who">panel B</span>
                        @if (fresh.value(); as reading) {
                            <span>{{ reading }}</span>
                        } @else {
                            <span class="waiting">loading…</span>
                        }
                    </div>
                }
                @if (panelA() || panelB()) {
                    <p class="readout">
                        one request for both panels; closing one changes nothing, closing the
                        last drops the value
                    </p>
                } @else {
                    <p class="void">
                        No panel open. Whatever was loaded is gone — and closing the last panel
                        mid-flight cancels the request: watch the network log.
                    </p>
                }
            </div>
        </div>
    `,
    styles: `
        .panel {
            display: flex;
            align-items: baseline;
            gap: 0.625rem;
            border: 1px dashed var(--border-strong);
            border-radius: var(--radius-sm);
            padding: 0.5rem 0.75rem;
        }

        .panel + .panel {
            margin-top: 0.5rem;
        }

        .panel .who {
            font-family: var(--mono);
            font-size: 0.6875rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--faint);
        }
    `,
})
export class WhileTrackedDemo {
    private readonly log = inject(RequestLog);

    readonly keptOpen = signal(false);
    readonly panelA = signal(false);
    readonly panelB = signal(false);

    readonly kept = rxResource({
        load: "whenTracked",
        params: () => "sensor-4",
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/sensors/${params}`, `#${++measurement} · 21.${measurement}°C`, 1400),
    });

    readonly fresh = rxResource({
        load: "whileTracked",
        params: () => "sensor-4",
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/sensors/${params}?fresh`, `#${++measurement} · 21.${measurement}°C`, 1400),
    });
}

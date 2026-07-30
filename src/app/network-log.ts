import { Component, inject } from "@angular/core";

import { RequestLog } from "./request-log";

@Component({
    selector: "network-log",
    template: `
        <div class="panel">
            <header>
                <p class="panel-title">the network saw</p>
                <p class="count" [class.has-traffic]="log.requestCount() > 0">
                    {{ log.requestCount() }}
                    <span class="count-label">request{{ log.requestCount() === 1 ? "" : "s" }}</span>
                </p>
            </header>
            <ol class="lines">
                @for (entry of log.entries(); track entry.id) {
                    <li class="line" [class]="entry.status">
                        <span class="time">{{ entry.time }}</span>
                        <span class="url">{{ entry.url }}</span>
                        <span class="status">{{ entry.status }}</span>
                    </li>
                } @empty {
                    <li class="void-line">Nothing has been requested.</li>
                }
            </ol>
        </div>
    `,
    styles: `
        .panel {
            border-top: 1px solid var(--border);
            background: var(--surface-dim);
        }

        header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 1rem;
            padding: 0.5rem 1.125rem 0.25rem;
        }

        .panel-title {
            font-family: var(--mono);
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            color: var(--faint);
        }

        .count {
            font-family: var(--mono);
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--asleep);
            font-variant-numeric: tabular-nums;
        }

        .count.has-traffic {
            color: var(--wake);
        }

        .count-label {
            font-size: 0.6875rem;
            font-weight: 400;
            color: var(--faint);
        }

        .lines {
            list-style: none;
            max-height: 8.5rem;
            overflow-y: auto;
            font-family: var(--mono);
            font-size: 0.75rem;
            line-height: 1.6;
            padding: 0.25rem 0 0.5rem;
        }

        .line {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 0.625rem;
            align-items: baseline;
            padding: 0.1rem 1.125rem;
            border-left: 2px solid transparent;
        }

        .time {
            color: var(--faint);
        }

        .url {
            overflow-wrap: anywhere;
        }

        .status {
            font-size: 0.6875rem;
            letter-spacing: 0.04em;
        }

        .pending {
            border-left-color: var(--pending);
            background: var(--wake-soft);
        }
        .pending .status {
            color: var(--pending);
            animation: blink 1.1s steps(2, jump-none) infinite;
        }
        .ok {
            border-left-color: color-mix(in srgb, var(--ok) 55%, transparent);
        }
        .ok .status {
            color: var(--ok);
        }
        .cancelled .status,
        .cancelled .url,
        .cancelled .time {
            color: var(--cancelled);
        }
        .cancelled .url {
            text-decoration: line-through;
        }
        .failed {
            border-left-color: var(--failed);
        }
        .failed .status {
            color: var(--failed);
        }

        .void-line {
            padding: 0.1rem 1.125rem;
            color: var(--asleep);
        }

        @keyframes blink {
            50% {
                opacity: 0.35;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .pending .status {
                animation: none;
            }
        }
    `,
})
export class NetworkLog {
    readonly log = inject(RequestLog);
}

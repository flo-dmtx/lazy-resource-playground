import { Component, inject, signal } from "@angular/core";
import { rxResource } from "@angular/core/rxjs-interop";

import { failingFetch, fakeFetch, User, userById } from "./fake-api";
import { RequestLog } from "./request-log";

@Component({
    selector: "demo-contract",
    template: `
        <div class="split">
            <div class="card">
                <header class="card-head">
                    <h3>writes while asleep</h3>
                    @if (awake()) {
                        <span class="badge" [attr.data-status]="profile.status()">{{ profile.status() }}</span>
                    } @else {
                        <span class="tag">unread</span>
                    }
                </header>

                <div class="controls">
                    <button class="ghost" (click)="setDraft()">set(draft)</button>
                    <button class="ghost" (click)="callReload()">reload()</button>
                    @if (!awake()) {
                        <button class="primary" (click)="awake.set(true)">read it</button>
                    }
                </div>

                @if (awake()) {
                    @let user = profile.value();
                    @if (user) {
                        <dl class="profile">
                            <dt>name</dt>
                            <dd>{{ user.name }}</dd>
                            <dt>role</dt>
                            <dd>{{ user.role }}</dd>
                        </dl>
                    } @else {
                        <p class="waiting">loading…</p>
                    }
                } @else if (actions().length === 0) {
                    <p class="void">
                        Nothing in this card reads the resource yet. Try the writes: the network
                        will not move.
                    </p>
                }

                @if (actions().length > 0) {
                    <ol class="acts">
                        @for (action of actions(); track $index) {
                            <li>{{ action }}</li>
                        }
                    </ol>
                }
            </div>

            <div class="card">
                <header class="card-head">
                    <h3>a loader that throws</h3>
                    @if (awakeFlaky()) {
                        <span class="badge" [attr.data-status]="flaky.status()">{{ flaky.status() }}</span>
                    } @else {
                        <span class="tag">unread</span>
                    }
                </header>

                @if (!awakeFlaky()) {
                    <div class="controls">
                        <button class="primary" (click)="awakeFlaky.set(true)">read it</button>
                    </div>
                    <p class="void">A 503 waiting to happen. Asleep, it cannot even fail.</p>
                } @else {
                    @switch (flaky.status()) {
                        @case ("error") {
                            <p class="failure">{{ flaky.error()?.message }}</p>
                            <div class="controls">
                                <button class="ghost" (click)="flaky.set(draft)">recover: set(draft)</button>
                                <button class="ghost" (click)="flaky.reload()">reload()</button>
                            </div>
                        }
                        @case ("local") {
                            <dl class="profile">
                                <dt>name</dt>
                                <dd>{{ flaky.value()?.name }}</dd>
                                <dt>role</dt>
                                <dd>{{ flaky.value()?.role }}</dd>
                            </dl>
                        }
                        @default {
                            <p class="waiting">loading…</p>
                        }
                    }
                }
            </div>
        </div>
    `,
})
export class ContractDemo {
    private readonly log = inject(RequestLog);

    readonly awake = signal(false);
    readonly awakeFlaky = signal(false);
    readonly actions = signal<readonly string[]>([]);
    readonly draft: User = { id: 0, name: "Local draft", role: "never saved", email: "—" };

    readonly profile = rxResource({
        lazy: true,
        params: () => 2,
        stream: ({ params }) => fakeFetch(this.log, `/api/users/${params}`, userById(params)),
    });

    readonly flaky = rxResource<User, number>({
        lazy: true,
        params: () => 9,
        stream: ({ params }) =>
            failingFetch(this.log, `/api/users/${params}`, "503 — user store unavailable"),
    });

    setDraft(): void {
        this.profile.set(this.draft);
        this.note(
            this.awake()
                ? "set(draft): local value, cancels any in-flight load"
                : "set(draft): still unread, no request",
        );
    }

    callReload(): void {
        const accepted = this.profile.reload();
        this.note(
            accepted
                ? this.awake()
                    ? "reload() → true, reloading now"
                    : "reload() → true, deferred to the next read"
                : "reload() → false, never read so nothing to re-run",
        );
    }

    private note(line: string): void {
        this.actions.update((all) => [...all, line]);
    }
}

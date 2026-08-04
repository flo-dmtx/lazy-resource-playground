import { Component, inject, signal } from "@angular/core";
import { rxResource } from "@angular/core/rxjs-interop";

import { fakeFetch, userById } from "./fake-api";
import { RequestLog } from "./request-log";

/** Today's workaround: the fetch lives in the child, deferred through its lifecycle. */
@Component({
    selector: "user-card",
    template: `
        @let user = profile.value();
        @if (user) {
            <dl class="profile">
                <dt>name</dt>
                <dd>{{ user.name }}</dd>
                <dt>role</dt>
                <dd>{{ user.role }}</dd>
                <dt>email</dt>
                <dd>{{ user.email }}</dd>
            </dl>
        } @else {
            <p class="waiting">loading…</p>
        }
    `,
})
export class UserCard {
    private readonly log = inject(RequestLog);

    readonly profile = rxResource({
        params: () => 1,
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/users/${params}?from=user-card`, userById(params)),
    });
}

@Component({
    selector: "demo-lifted",
    imports: [UserCard],
    template: `
        <div class="split">
            <div class="card">
                <header class="card-head">
                    <h3>fetch inside a child component <span class="tag">workaround</span></h3>
                    <button class="ghost" (click)="card.set(card() === 'mounted' ? 'destroyed' : 'mounted')">
                        {{ card() === "mounted" ? "Destroy" : card() === "destroyed" ? "Show again" : "Show" }}
                    </button>
                </header>
                @switch (card()) {
                    @case ("mounted") {
                        <user-card />
                    }
                    @case ("destroyed") {
                        <p class="void">Destroyed. Showing it again will fetch again.</p>
                    }
                    @default {
                        <p class="void">Hidden. The fetch waits on the child lifecycle.</p>
                    }
                }
            </div>

            <div class="card">
                <header class="card-head">
                    <h3>declared here, <code>load: "whenTracked"</code> <span class="tag">proposal</span></h3>
                    <button class="ghost" (click)="panel.set(panel() === 'open' ? 'closed' : 'open')">
                        {{ panel() === "open" ? "Hide" : panel() === "closed" ? "Show again" : "Show" }}
                    </button>
                </header>
                @switch (panel()) {
                    @case ("open") {
                        @let user = profile.value();
                        @if (user) {
                            <dl class="profile">
                                <dt>name</dt>
                                <dd>{{ user.name }}</dd>
                                <dt>role</dt>
                                <dd>{{ user.role }}</dd>
                                <dt>email</dt>
                                <dd>{{ user.email }}</dd>
                            </dl>
                        } @else {
                            <p class="waiting">loading…</p>
                        }
                    }
                    @case ("closed") {
                        <p class="void">Hidden again. The value is kept, no re-fetch.</p>
                    }
                    @default {
                        <p class="void">Hidden. Nothing has been requested yet.</p>
                    }
                }
            </div>
        </div>
    `,
})
export class LiftedDemo {
    private readonly log = inject(RequestLog);

    readonly card = signal<"never" | "mounted" | "destroyed">("never");
    readonly panel = signal<"never" | "open" | "closed">("never");

    readonly profile = rxResource({
        load: "whenTracked",
        params: () => 1,
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/users/${params}?from=the-parent`, userById(params)),
    });
}

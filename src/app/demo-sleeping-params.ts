import { Component, inject, signal } from "@angular/core";
import { rxResource } from "@angular/core/rxjs-interop";

import { fakeFetch, USERS, userById } from "./fake-api";
import { RequestLog } from "./request-log";

@Component({
    selector: "demo-sleeping-params",
    template: `
        <div class="card">
            <div class="controls">
                <label>
                    <span class="field-label">user</span>
                    <select #picker (change)="userId.set(+picker.value)">
                        @for (user of users; track user.id) {
                            <option [value]="user.id">#{{ user.id }} · {{ user.name }}</option>
                        }
                    </select>
                </label>
                <button class="ghost" (click)="open.set(!open())">
                    {{ open() ? "Close panel" : "Open panel" }}
                </button>
            </div>

            @if (open()) {
                @let user = selected.value();
                @if (user) {
                    <dl class="profile">
                        <dt>id</dt>
                        <dd>{{ user.id }}</dd>
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
                <p class="readout">the open panel reads it: changing the user now re-fetches</p>
            } @else {
                <p class="void">Panel closed. Change the user freely, the network will not move.</p>
            }
        </div>
    `,
})
export class SleepingParamsDemo {
    private readonly log = inject(RequestLog);

    readonly users = USERS;
    readonly userId = signal(USERS[0].id);
    readonly open = signal(false);

    readonly selected = rxResource({
        lazy: true,
        params: () => this.userId(),
        stream: ({ params }) => fakeFetch(this.log, `/api/users/${params}`, userById(params)),
    });
}

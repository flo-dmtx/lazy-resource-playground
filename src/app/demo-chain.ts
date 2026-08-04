import { Component, inject, signal } from "@angular/core";
import { rxResource } from "@angular/core/rxjs-interop";

import { fakeFetch, userById } from "./fake-api";
import { RequestLog } from "./request-log";

@Component({
    selector: "demo-chain",
    template: `
        <div class="card">
            <button class="primary" [disabled]="revealed()" (click)="revealed.set(true)">
                Load the posts
            </button>

            @if (revealed()) {
                <ol class="chain">
                    <li>
                        <code>user</code>
                        <span class="badge" [attr.data-status]="user.status()">{{ user.status() }}</span>
                        @if (user.value(); as author) {
                            <span class="derived">{{ author.name }}</span>
                        }
                    </li>
                    <li>
                        <code>posts</code>
                        <span class="badge" [attr.data-status]="posts.status()">{{ posts.status() }}</span>
                    </li>
                </ol>

                @let titles = posts.value();
                @if (titles) {
                    <ul class="feed">
                        @for (title of titles; track $index) {
                            <li>{{ title }}</li>
                        }
                    </ul>
                } @else {
                    <p class="readout">posts waits for user to resolve, then fetches with its id</p>
                }
            } @else {
                <p class="void">
                    Two resources declared: a user, then their posts. Zero requests so far,
                    the chain is asleep end to end.
                </p>
            }
        </div>
    `,
})
export class ChainDemo {
    private readonly log = inject(RequestLog);

    readonly revealed = signal(false);

    readonly user = rxResource({
        load: "whenTracked",
        params: () => 3,
        stream: ({ params }) => fakeFetch(this.log, `/api/users/${params}`, userById(params)),
    });

    readonly posts = rxResource({
        load: "whenTracked",
        // chain() only returns once the dependency is resolved; until then it reports its status.
        params: (ctx) => ctx.chain(this.user)!.id,
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/users/${params}/posts`, [
                "On computable numbers, revisited",
                "Notes on machine intelligence",
                "A cipher worth its latency",
            ]),
    });
}

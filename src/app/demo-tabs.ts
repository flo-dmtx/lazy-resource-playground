import { Component, inject, signal } from "@angular/core";
import { rxResource } from "@angular/core/rxjs-interop";

import { fakeFetch } from "./fake-api";
import { RequestLog } from "./request-log";

type TabId = "overview" | "comments" | "activity";

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "comments", label: "Comments" },
    { id: "activity", label: "Activity" },
];

@Component({
    selector: "demo-tabs",
    template: `
        <div class="card">
            <div class="tabs" role="tablist">
                @for (item of tabs; track item.id) {
                    <button
                        role="tab"
                        [attr.aria-selected]="tab() === item.id"
                        [class.is-active]="tab() === item.id"
                        (click)="tab.set(item.id)"
                    >
                        {{ item.label }}
                    </button>
                }
            </div>

            <div class="tab-body">
                @switch (tab()) {
                    @case ("overview") {
                        @let post = overview.value();
                        @if (post) {
                            <p class="lead">{{ post.title }}</p>
                            <p class="body-text">{{ post.summary }}</p>
                        } @else {
                            <p class="waiting">loading…</p>
                        }
                    }
                    @case ("comments") {
                        @let thread = comments.value();
                        @if (thread) {
                            <ul class="feed">
                                @for (comment of thread; track comment.author) {
                                    <li>
                                        <span class="who">{{ comment.author }}</span>
                                        {{ comment.body }}
                                    </li>
                                }
                            </ul>
                        } @else {
                            <p class="waiting">loading…</p>
                        }
                    }
                    @case ("activity") {
                        @let events = activity.value();
                        @if (events) {
                            <ul class="feed">
                                @for (event of events; track $index) {
                                    <li>{{ event }}</li>
                                }
                            </ul>
                        } @else {
                            <p class="waiting">loading…</p>
                        }
                    }
                    @default {
                        <p class="void">No tab open. Three resources declared, zero requests.</p>
                    }
                }
            </div>
        </div>
    `,
})
export class TabsDemo {
    private readonly log = inject(RequestLog);

    readonly tabs = TABS;
    readonly tab = signal<TabId | null>(null);

    readonly overview = rxResource({
        load: "whenTracked",
        params: () => 42,
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/posts/${params}`, {
                title: "Laziness as a scheduling decision",
                summary:
                    "A resource that loads from an effect answers a question nobody asked. Moving the trigger to the read makes the component tree itself the scheduler.",
            }),
    });

    readonly comments = rxResource({
        load: "whenTracked",
        params: () => 42,
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/posts/${params}/comments`, [
                { author: "grace", body: "Works out of the box behind @defer too." },
                { author: "radia", body: "Finally, a tab that costs nothing until it is opened." },
                { author: "alan", body: "Same contract, different trigger. Nothing else to learn." },
            ]),
    });

    readonly activity = rxResource({
        load: "whenTracked",
        params: () => 42,
        stream: ({ params }) =>
            fakeFetch(this.log, `/api/posts/${params}/activity`, [
                "10:02 — draft created",
                "11:47 — reviewed by grace",
                "14:15 — published",
            ]),
    });
}

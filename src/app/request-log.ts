import { computed, Injectable, signal } from "@angular/core";

export type LogStatus = "pending" | "ok" | "cancelled" | "failed";

export interface LogEntry {
    readonly id: number;
    readonly time: string;
    readonly method: "GET";
    readonly url: string;
    readonly status: LogStatus;
}

/** The fake network's console: every request the demos cause shows up here, and nowhere else. */
@Injectable({ providedIn: "root" })
export class RequestLog {
    private nextId = 1;

    readonly entries = signal<readonly LogEntry[]>([]);
    readonly requestCount = computed(() => this.entries().length);

    open(url: string): number {
        const id = this.nextId++;
        this.entries.update((entries) => [
            ...entries,
            { id, time: timestamp(), method: "GET", url, status: "pending" },
        ]);
        return id;
    }

    resolve(id: number): void {
        this.settle(id, "ok");
    }

    cancel(id: number): void {
        this.settle(id, "cancelled");
    }

    fail(id: number): void {
        this.settle(id, "failed");
    }

    clear(): void {
        this.entries.set([]);
    }

    // Only a pending entry settles, so the teardown that follows a delivered response cannot
    // relabel it as cancelled.
    private settle(id: number, status: LogStatus): void {
        this.entries.update((entries) =>
            entries.map((entry) =>
                entry.id === id && entry.status === "pending" ? { ...entry, status } : entry,
            ),
        );
    }
}

function timestamp(): string {
    return new Date().toISOString().slice(11, 23);
}

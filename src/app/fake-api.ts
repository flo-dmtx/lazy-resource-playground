import { map, Observable, timer } from "rxjs";

import { RequestLog } from "./request-log";

export interface User {
    readonly id: number;
    readonly name: string;
    readonly role: string;
    readonly email: string;
}

export const USERS: readonly User[] = [
    { id: 1, name: "Ada Lovelace", role: "Analyst", email: "ada@example.dev" },
    { id: 2, name: "Grace Hopper", role: "Compiler lead", email: "grace@example.dev" },
    { id: 3, name: "Alan Turing", role: "Cryptanalyst", email: "alan@example.dev" },
    { id: 4, name: "Radia Perlman", role: "Network architect", email: "radia@example.dev" },
];

export function userById(id: number): User {
    return USERS.find((user) => user.id === id) ?? USERS[0];
}

/**
 * A request whose every consequence is visible: pending on subscribe, ok when it delivers,
 * cancelled when it is torn down before delivering.
 */
export function fakeFetch<T>(log: RequestLog, url: string, result: T, delayMs = 800): Observable<T> {
    return new Observable<T>((subscriber) => {
        const id = log.open(url);
        const inFlight = timer(delayMs)
            .pipe(map(() => result))
            .subscribe((value) => {
                log.resolve(id);
                subscriber.next(value);
                subscriber.complete();
            });
        return () => {
            inFlight.unsubscribe();
            log.cancel(id);
        };
    });
}

export function failingFetch(log: RequestLog, url: string, message: string, delayMs = 800): Observable<never> {
    return new Observable<never>((subscriber) => {
        const id = log.open(url);
        const inFlight = timer(delayMs).subscribe(() => {
            log.fail(id);
            subscriber.error(new Error(message));
        });
        return () => {
            inFlight.unsubscribe();
            log.cancel(id);
        };
    });
}

import {
    assertInInjectionContext,
    computed,
    DestroyRef,
    effect,
    EffectRef,
    inject,
    Injector,
    linkedSignal,
    PendingTasks,
    Resource,
    ResourceDependencyError,
    ResourceLoaderParams,
    ResourceOptions,
    ResourceParamsContext,
    ResourceParamsStatus,
    ResourceRef,
    ResourceSnapshot,
    ResourceStatus,
    ResourceStreamItem,
    Signal,
    signal,
    untracked,
    ValueEqualityFn,
    WritableSignal,
} from "@angular/core";
import {
    consumerDestroy,
    producerAccessed,
    REACTIVE_NODE,
    ReactiveNode,
    SIGNAL,
} from "@angular/core/primitives/signals";
import type { RxResourceOptions } from "@angular/core/rxjs-interop";

/**
 * `lazyResource` and `lazyRxResource`: like the native `resource` and `rxResource`, but the
 * request starts from being listened to rather than from construction.
 *
 * A resource is a reactive stream, and there are exactly two ways to consume one. Listening — a
 * live reactive context (a template or an effect, directly or through any depth of `computed`s)
 * tracking one of its signals — is what demand means: the first listener wakes a lazy resource.
 * Every other read is a photograph: outside a reactive context (including inside `untracked()`)
 * a read reports the current state at that instant and starts nothing, so a dormant resource
 * truthfully reads `idle`. One invariant follows: no load ever runs while nothing tracks the
 * resource. An `@if` that is false, a tab that is not open, a `@defer` that has not triggered
 * never listen, so never fetch.
 *
 * Two strategies, differing only in what happens when the last listener leaves:
 *
 * - `load: "whenTracked"` (the default): the settled value is retained — coming back to a closed
 *   tab shows what was already loaded instead of downloading it again (until the params change,
 *   which invalidates the value as usual).
 * - `load: "whileTracked"`: the resource lives exactly while listened to — an in-flight load is
 *   cancelled, the value is dropped (local values included) and the next listener starts over.
 *   For data that should not outlive the screen showing it.
 *
 * Shared rules: params changes while dormant are tracked but never fetched (the first listener
 * uses the latest value); while listened to, the resource behaves exactly like a native one
 * (params → refetch, `reload()`, statuses, errors, cancellation); `set()` goes `local` without
 * loading; `reload()` while dormant never starts a load (it returns `false` when nothing ever
 * settled, and otherwise marks the settled value for a refetch by the next listener); a dormant
 * resource never blocks application stability. Options and the `ResourceRef` surface are the
 * native ones (`params` with `chain` support, a promise `loader` for `lazyResource` or a
 * `stream` for `lazyRxResource`, `defaultValue`, `equal`, `injector`).
 *
 * Usage: copy this file into your project and swap the constructor.
 *
 * ```ts
 * readonly user = lazyRxResource({
 *     params: () => this.userId(),
 *     stream: ({ params }) => this.api.user(params),
 * });
 * // nothing fetches until a template or an effect tracks user.value(), user.status(), ...
 * ```
 *
 * This file is the userland twin of a proposal to add lazy load strategies to Angular's own
 * resources (feature request angular/angular#70036, proposal v2: `load: 'eager' | 'whenTracked'
 * | 'whileTracked'`). Detecting listeners is the one part core gets for free and userland
 * cannot reach cleanly: "the first live consumer arrived / the last one left" is the reactive
 * graph's own bookkeeping, with no public API. The twin observes it by turning the `consumers`
 * field of its own reactive node into an accessor property (see `createTrackNode`); this works,
 * but it is exactly the kind of non-contractual coupling that argues for core support, where the
 * same transitions are two hooks mirroring the TC39 Signals proposal's `watched`/`unwatched`.
 * - feature request: https://github.com/angular/angular/issues/70036
 * - interactive proposal: https://flo-dmtx.github.io/lazy-resource-playground/
 * - playground source (edit on StackBlitz): https://github.com/flo-dmtx/lazy-resource-playground
 * - native implementation, tested: https://github.com/flo-dmtx/angular/tree/feat/lazy-resource-v2
 */
export type LazyLoadStrategy = "whenTracked" | "whileTracked";

export function lazyResource<T, R>(
    options: ResourceOptions<T, R> & { defaultValue: NoInfer<T>; load?: LazyLoadStrategy },
): ResourceRef<T>;
export function lazyResource<T, R>(
    options: ResourceOptions<T, R> & { load?: LazyLoadStrategy },
): ResourceRef<T | undefined>;
export function lazyResource<T, R>(
    options: ResourceOptions<T, R> & { load?: LazyLoadStrategy },
): ResourceRef<T | undefined> {
    if (!options.injector) {
        assertInInjectionContext(lazyResource);
    }
    if (!("loader" in options) || options.loader === undefined) {
        throw new Error("lazyResource only supports a promise `loader`; for streams, use lazyRxResource.");
    }
    // The cast bridges the branded native types (WritableSignal brand, hasValue's `this`
    // predicate) that userland cannot name; the class implements the full behavioral contract.
    return new LazyResourceImpl<T, R>({
        ...options,
        connect: connectLoader(options.loader),
    }) as unknown as ResourceRef<T | undefined>;
}

export function lazyRxResource<T, R>(
    options: RxResourceOptions<T, R> & { defaultValue: NoInfer<T>; load?: LazyLoadStrategy },
): ResourceRef<T>;
export function lazyRxResource<T, R>(
    options: RxResourceOptions<T, R> & { load?: LazyLoadStrategy },
): ResourceRef<T | undefined>;
export function lazyRxResource<T, R>(
    options: RxResourceOptions<T, R> & { load?: LazyLoadStrategy },
): ResourceRef<T | undefined> {
    if (!options.injector) {
        assertInInjectionContext(lazyRxResource);
    }
    return new LazyResourceImpl<T, R>({
        ...options,
        connect: connectStream(options.stream),
    }) as unknown as ResourceRef<T | undefined>;
}

interface ExtRequest<R> {
    readonly request?: R;
    readonly status?: "idle" | "loading";
    readonly error?: unknown;
    readonly reload: number;
}

interface LoaderState<T, R> {
    readonly extRequest: ExtRequest<R>;
    // Raw machine status; `reloading` and `error` are projected from it, never stored.
    readonly status: "idle" | "loading" | "resolved" | "local";
    readonly previousStatus: ResourceStatus;
    readonly stream: Signal<ResourceStreamItem<T | undefined>> | undefined;
}

interface LazyResourceInternalOptions<T, R> {
    readonly params?: (ctx: ResourceParamsContext) => R;
    readonly equal?: ValueEqualityFn<T>;
    readonly defaultValue?: T;
    readonly injector?: Injector;
    readonly load?: LazyLoadStrategy;
    readonly connect: Connect<T, R>;
}

class LazyResourceImpl<T, R> implements Resource<T | undefined> {
    private readonly connect: Connect<T, R>;
    private readonly equal: ValueEqualityFn<T | undefined> | undefined;
    private readonly pendingTasks: PendingTasks;
    private readonly unregisterOnDestroy: () => void;
    private readonly injector: Injector;
    private readonly dropOnSleep: boolean;

    private destroyed = false;
    private pendingController: AbortController | undefined;
    private resolvePendingTask: (() => void) | undefined;
    private loadEffect: EffectRef | undefined;

    // What the params function asked for, plus a reload generation. Thrown ResourceParamsStatus
    // codes and errors are captured as alternate variants instead of request values.
    private readonly extRequest = linkedSignal<ExtRequest<R>>(() => {
        try {
            return { request: (this.paramsFn ?? (() => null as R))(paramsContext), reload: 0 };
        } catch (error) {
            if (error === ResourceParamsStatus.IDLE) return { status: "idle", reload: 0 };
            if (error === ResourceParamsStatus.LOADING) return { status: "loading", reload: 0 };
            return { error, reload: 0 };
        }
    });
    private readonly paramsFn: ((ctx: ResourceParamsContext) => R) | undefined;

    // The state machine, recomputed from extRequest and locally overwritten by loads and set().
    // Keeping the previous stream when the request is unchanged is what makes `reloading` keep
    // showing the old value.
    private readonly state = linkedSignal<ExtRequest<R>, LoaderState<T, R>>({
        source: () => this.extRequest(),
        computation: (extRequest, previous) => computeState(extRequest, previous?.value),
    });

    // Whether the load effect exists. Read by the status projection, so a listener that saw a
    // dormant `idle` is notified when waking turns it into `loading`.
    private readonly awake = signal(false);

    // The liveness sensor: every public signal registers this node as a dependency, so a live
    // listener reaches it through the graph, and its watched/unwatched transitions drive the
    // lazy lifecycle.
    private readonly node = createTrackNode({
        watched: () => this.scheduleWake(),
        unwatched: () => this.scheduleSleep(),
    });

    readonly value: WritableSignal<T | undefined>;
    readonly status: Signal<ResourceStatus>;
    readonly error: Signal<Error | undefined>;
    readonly isLoading: Signal<boolean>;
    readonly snapshot: Signal<ResourceSnapshot<T | undefined>>;

    private readonly isValueDefined: Signal<boolean>;

    constructor(options: LazyResourceInternalOptions<T, R>) {
        this.paramsFn = options.params;
        this.connect = options.connect;
        this.equal = options.equal ? wrapEqualityFn(options.equal as ValueEqualityFn<T | undefined>) : undefined;
        this.dropOnSleep = options.load === "whileTracked";
        const defaultValue = options.defaultValue;

        const injector = (this.injector = options.injector ?? inject(Injector));
        this.pendingTasks = injector.get(PendingTasks);
        this.unregisterOnDestroy = injector.get(DestroyRef).onDestroy(() => this.destroy());

        const value = computed(() => (this.track(), this.computeValue(this.state(), defaultValue)), {
            equal: this.equal,
        });
        this.value = Object.assign(value, {
            set: (newValue: T | undefined) => this.set(newValue),
            update: (updater: (current: T | undefined) => T | undefined) => this.update(updater),
            asReadonly: () => value,
        }) as unknown as WritableSignal<T | undefined>;

        this.status = computed(() => {
            // A destroyed resource stays idle: without this, a params change after destroy()
            // would recompute the state to "loading" even though nothing will ever load.
            if (this.destroyed) return "idle";
            this.track();
            const status = projectStatusOfState(this.state());
            // While dormant, the internal state speculates about the load that waking would
            // start; no load is actually running, so the resource truthfully reports idle.
            if (!this.awake() && (status === "loading" || status === "reloading")) return "idle";
            return status;
        });
        this.error = computed(() => {
            this.track();
            const streamValue = this.state().stream?.();
            return streamValue && "error" in streamValue ? streamValue.error : undefined;
        });
        this.isLoading = computed(() => this.status() === "loading" || this.status() === "reloading");
        this.snapshot = computed(() => {
            const status = this.status();
            return status === "error"
                ? { status, error: this.error()! }
                : ({ status, value: this.value() } as ResourceSnapshot<T | undefined>);
        });
        this.isValueDefined = computed(() => this.status() !== "error" && this.value() !== undefined);
    }

    hasValue(): this is Resource<Exclude<T | undefined, undefined>>;
    hasValue(): boolean {
        return this.isValueDefined();
    }

    set(value: T | undefined): void {
        if (this.destroyed) return;
        const state = untracked(this.state);
        const streamValue = state.stream && untracked(state.stream);
        const hasError = streamValue !== undefined && "error" in streamValue;
        if (!hasError && state.status === "local") {
            const current = untracked(() => this.computeValue(state, undefined));
            if (this.equal ? this.equal(current, value) : current === value) return;
        }
        this.state.set({
            extRequest: state.extRequest,
            status: "local",
            previousStatus: "local",
            stream: signal({ value }),
        });
        this.abortInProgressLoad();
    }

    update(updater: (value: T | undefined) => T | undefined): void {
        this.set(updater(untracked(() => this.computeValue(untracked(this.state), undefined))));
    }

    asReadonly(): Resource<T | undefined> {
        return this;
    }

    reload(): boolean {
        const { status } = untracked(this.state);
        if (status === "idle" || status === "loading") return false;
        this.extRequest.update(({ request, reload }) => ({ request, reload: reload + 1 }));
        return true;
    }

    destroy(): void {
        this.destroyed = true;
        this.unregisterOnDestroy();
        this.loadEffect?.destroy();
        this.loadEffect = undefined;
        consumerDestroy(this.node);
        this.abortInProgressLoad();
        this.state.set({
            extRequest: { request: undefined, reload: 0 },
            status: "idle",
            previousStatus: "idle",
            stream: undefined,
        });
    }

    // Registers the tracking node as a dependency of the calling reactive context: this is how a
    // listener's liveness reaches the node. A read outside any reactive context registers
    // nothing, so wakes nothing.
    private track(): void {
        if (this.destroyed) return;
        producerAccessed(this.node);
    }

    /**
     * The resource gained its first listener: wake up. Deferred to a microtask because the
     * transition fires in the middle of a graph mutation; skipped if every listener already left
     * in the meantime. Waking is creating the load effect — the only place a load ever starts.
     */
    private scheduleWake(): void {
        queueMicrotask(() => {
            if (this.destroyed || untracked(this.awake) || this.node.consumers === undefined) return;
            this.awake.set(true);
            this.loadEffect = effect(
                () => {
                    const extRequest = this.extRequest();
                    untracked(() => this.loadIfNeeded(extRequest));
                },
                { injector: this.injector, manualCleanup: true },
            );
        });
    }

    /**
     * The last listener left, go back to sleep: no load may run while nothing tracks the
     * resource, so the load effect is torn down and any in-flight load aborted. `whenTracked`
     * keeps a settled value for the next listener; `whileTracked` additionally forgets, by
     * recomputing the state from the current params as if fresh — the next listener starts over.
     * Skipped if something started listening again in the meantime.
     */
    private scheduleSleep(): void {
        queueMicrotask(() => {
            if (this.destroyed || !untracked(this.awake) || this.node.consumers !== undefined) return;
            this.loadEffect?.destroy();
            this.loadEffect = undefined;
            this.abortInProgressLoad();
            this.awake.set(false);
            if (this.dropOnSleep) {
                this.state.set(computeState(untracked(this.extRequest)));
            }
        });
    }

    private computeValue(state: LoaderState<T, R>, defaultValue: T | undefined): T | undefined {
        const streamValue = state.stream?.();
        if (!streamValue) return defaultValue;
        // A fresh load after an error: report the default rather than throwing a stale error.
        if (state.status === "loading" && "error" in streamValue) return defaultValue;
        if ("error" in streamValue) throw new ResourceValueError(streamValue.error);
        return streamValue.value;
    }

    private loadIfNeeded(extRequest: ExtRequest<R>): void {
        if (this.destroyed || extRequest.request === undefined) return;
        const { status, previousStatus } = untracked(this.state);
        if (status !== "loading") return;

        this.abortInProgressLoad();
        const resolvePendingTask = (this.resolvePendingTask = this.pendingTasks.add());
        const controller = (this.pendingController = new AbortController());
        const abortSignal = controller.signal;
        const shouldDiscard = () => abortSignal.aborted || untracked(this.extRequest) !== extRequest;

        // Mirrors the native loaders' bridge, without its promise indirection: the first settle
        // publishes the stream (a synchronous source settles during this very call), later
        // emissions flow through the same stream signal.
        const stream = signal<ResourceStreamItem<T | undefined>>({ value: undefined });
        let settled = false;
        const settle = () => {
            if (settled) return;
            settled = true;
            if (!shouldDiscard()) {
                this.state.set({ extRequest, status: "resolved", previousStatus: "resolved", stream });
            }
            resolvePendingTask();
        };

        let teardown: (() => void) | void;
        const onAbort = () => {
            abortSignal.removeEventListener("abort", onAbort);
            teardown?.();
            settle();
        };
        abortSignal.addEventListener("abort", onAbort);

        try {
            teardown = this.connect(
                {
                    params: extRequest.request as Exclude<R, undefined>,
                    abortSignal,
                    previous: { status: previousStatus },
                } as ResourceLoaderParams<R>,
                {
                    next: (value) => {
                        stream.set({ value });
                        settle();
                    },
                    fail: (error) => {
                        stream.set({ error: encapsulateError(error) });
                        settle();
                    },
                    done: () => settle(),
                },
            );
        } catch (error) {
            stream.set({ error: encapsulateError(error) });
            settle();
        }
    }

    private abortInProgressLoad(): void {
        untracked(() => this.pendingController?.abort());
        this.pendingController = undefined;
        this.resolvePendingTask?.();
        this.resolvePendingTask = undefined;
    }
}

// Mark the impl so devtools-style introspection sees a reactive producer, not a plain object.
Object.defineProperty(LazyResourceImpl.prototype, SIGNAL, { value: undefined, writable: true });

// ----------------------------
// Internal helpers
// ----------------------------

interface ConnectSink<T> {
    next(value: T): void;
    fail(error: unknown): void;
    done(): void;
}

/** Bridges one load attempt to its source; may return a teardown, run when the load is aborted. */
type Connect<T, R> = (params: ResourceLoaderParams<R>, sink: ConnectSink<T>) => (() => void) | void;

/**
 * A passive producer node: it never recomputes and never notifies, it only exists to be tracked.
 * The graph maintains its live-consumer list through the `consumers` head pointer, and only ever
 * writes that field on the transitions that matter here: empty → non-empty when the first live
 * consumer arrives (directly, or by liveness cascading down through computeds), non-empty →
 * empty when the last one leaves. Turning the field into an accessor property is how userland
 * observes what the core proposal exposes as `producerOnWatched`/`producerOnUnwatched` hooks —
 * it works, but nothing contracts the graph to keep this exact bookkeeping.
 */
function createTrackNode(hooks: { watched(): void; unwatched(): void }): ReactiveNode {
    const node = Object.create(REACTIVE_NODE) as ReactiveNode;
    node.producerMustRecompute = () => false;
    node.producerRecomputeValue = () => {};
    let consumers: ReactiveNode["consumers"];
    Object.defineProperty(node, "consumers", {
        get: () => consumers,
        set: (link: ReactiveNode["consumers"]) => {
            const wasWatched = consumers !== undefined;
            consumers = link;
            if (!wasWatched && link !== undefined) hooks.watched();
            if (wasWatched && link === undefined) hooks.unwatched();
        },
    });
    return node;
}

/**
 * Derives the machine state from what the params asked for. Called with no previous state, it
 * also says what "fresh" means — which is why the `whileTracked` sleep reuses it to forget: an
 * abandoned resource is indistinguishable from one that never loaded.
 */
function computeState<T, R>(extRequest: ExtRequest<R>, previous?: LoaderState<T, R>): LoaderState<T, R> {
    let status: LoaderState<T, R>["status"];
    let stream: LoaderState<T, R>["stream"];
    if (extRequest.error !== undefined) {
        status = "resolved";
        stream = signal({ error: encapsulateError(extRequest.error) });
    } else {
        status = extRequest.status ?? (extRequest.request === undefined ? "idle" : "loading");
        if (previous && previous.extRequest.request === extRequest.request) {
            stream = previous.stream;
        }
    }
    return {
        extRequest,
        status,
        previousStatus: previous ? projectStatusOfState(previous) : "idle",
        stream,
    };
}

function connectLoader<T, R>(loader: (params: ResourceLoaderParams<R>) => PromiseLike<T>): Connect<T, R> {
    return (params, sink) => {
        loader(params).then(
            (value) => sink.next(value),
            (error: unknown) => sink.fail(error),
        );
    };
}

function connectStream<T, R>(stream: RxResourceOptions<T, R>["stream"]): Connect<T, R> {
    return (params, sink) => {
        const subscription = stream(params).subscribe({
            next: (value) => sink.next(value),
            error: (error: unknown) => sink.fail(error),
            complete: () => sink.done(),
        });
        return () => subscription.unsubscribe();
    };
}

const paramsContext: ResourceParamsContext = {
    chain: <T>(resource: Resource<T>): T => {
        switch (resource.status()) {
            case "idle":
                throw ResourceParamsStatus.IDLE;
            case "error":
                throw new ResourceDependencyError(resource);
            case "loading":
            case "reloading":
                throw ResourceParamsStatus.LOADING;
        }
        return resource.value();
    },
};

function projectStatusOfState<T, R>(state: LoaderState<T, R>): ResourceStatus {
    switch (state.status) {
        case "loading":
            return state.extRequest.reload === 0 ? "loading" : "reloading";
        case "resolved":
            return state.stream && "error" in state.stream() ? "error" : "resolved";
        default:
            return state.status;
    }
}

// `undefined` never goes through a custom equal: it marks "no value" states, and treating it like
// a value would let a custom equality conflate "no value yet" with a real one.
function wrapEqualityFn<T>(equal: ValueEqualityFn<T>): ValueEqualityFn<T | undefined> {
    return (a, b) => (a === undefined || b === undefined ? a === b : equal(a, b));
}

function encapsulateError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error), { cause: error });
}

class ResourceValueError extends Error {
    constructor(error: Error) {
        super(`Resource is currently in an error state (see Error.cause for details): ${error.message}`, {
            cause: error,
        });
    }
}

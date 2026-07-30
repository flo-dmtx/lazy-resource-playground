import {
    assertInInjectionContext,
    computed,
    DestroyRef,
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
    consumerAfterComputation,
    consumerBeforeComputation,
    consumerDestroy,
    producerAccessed,
    producerUpdateValueVersion,
    REACTIVE_NODE,
    ReactiveNode,
    setActiveConsumer,
    SIGNAL,
} from "@angular/core/primitives/signals";
import type { RxResourceOptions } from "@angular/core/rxjs-interop";

/**
 * `lazyResource` and `lazyRxResource`: like the native `resource` and `rxResource`, but the
 * request starts from being read rather than from an effect.
 *
 * Angular's own resource schedules an effect at construction, so it fetches whether or not
 * anything displays it; the only way to hold it back is to feed it params it cannot use. Here
 * there is no effect at all: a producer node is asked to recompute when something reads any of
 * the resource's signals, and that is where the load starts. An `@if` that is false, a tab that
 * is not open, a `@defer` that has not triggered never ask, so never fetch.
 *
 * Unlike an observable behind the async pipe, the answer outlives the reader: coming back to a
 * closed tab shows what was already loaded instead of downloading it again.
 *
 * Everything else mirrors the native contract: same options (`params` with `chain` support, a
 * promise `loader` for `lazyResource` or a `stream` receiving `{params, abortSignal, previous}`
 * for `lazyRxResource`, `defaultValue`, `equal`, `injector`), same `ResourceRef` surface
 * (`value` writable, `set`/`update` going `local`, `reload`, `destroy`, `hasValue`), same status
 * projection (`idle`/`loading`/`reloading`/`resolved`/`local`/`error`). One deliberate
 * improvement over native: a synchronous source resolves during the very read that started it,
 * instead of a microtask later.
 */
export function lazyResource<T, R>(
    options: ResourceOptions<T, R> & { defaultValue: NoInfer<T> },
): ResourceRef<T>;
export function lazyResource<T, R>(options: ResourceOptions<T, R>): ResourceRef<T | undefined>;
export function lazyResource<T, R>(options: ResourceOptions<T, R>): ResourceRef<T | undefined> {
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
    options: RxResourceOptions<T, R> & { defaultValue: NoInfer<T> },
): ResourceRef<T>;
export function lazyRxResource<T, R>(options: RxResourceOptions<T, R>): ResourceRef<T | undefined>;
export function lazyRxResource<T, R>(options: RxResourceOptions<T, R>): ResourceRef<T | undefined> {
    if (!options.injector) {
        assertInInjectionContext(lazyRxResource);
    }
    return new LazyResourceImpl<T, R>({
        ...options,
        connect: connectStream(options.stream),
    }) as unknown as ResourceRef<T | undefined>;
}

const UNSET = Symbol("unset");

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
    readonly connect: Connect<T, R>;
}

class LazyResourceImpl<T, R> implements Resource<T | undefined> {
    private readonly connect: Connect<T, R>;
    private readonly equal: ValueEqualityFn<T | undefined> | undefined;
    private readonly pendingTasks: PendingTasks;
    private readonly unregisterOnDestroy: () => void;

    private destroyed = false;
    private pendingController: AbortController | undefined;
    private resolvePendingTask: (() => void) | undefined;

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
        computation: (extRequest, previous) => {
            let status: LoaderState<T, R>["status"];
            let stream: LoaderState<T, R>["stream"];
            if (extRequest.error !== undefined) {
                status = "resolved";
                stream = signal({ error: encapsulateError(extRequest.error) });
            } else {
                status = extRequest.status ?? (extRequest.request === undefined ? "idle" : "loading");
                if (previous && previous.value.extRequest.request === extRequest.request) {
                    stream = previous.value.stream;
                }
            }
            return {
                extRequest,
                status,
                previousStatus: previous ? projectStatusOfState(previous.value) : "idle",
                stream,
            };
        },
    });

    // The lazy trigger. Reading any public signal pulls this node; the node tracks extRequest, so
    // it recomputes on the first read and again whenever the params or the reload generation
    // change - and recomputing is where the load side effect lives.
    private readonly node: ReactiveNode & { value: unknown } = Object.assign(
        Object.create(REACTIVE_NODE) as ReactiveNode,
        {
            value: UNSET as unknown,
            dirty: true,
            // A node that has never computed has no tracked dependency to have changed, so nothing
            // else would make producerUpdateValueVersion run the computation a first time.
            producerMustRecompute: () => this.node.value === UNSET,
            producerRecomputeValue: () => {
                const previousConsumer = consumerBeforeComputation(this.node);
                try {
                    const extRequest = this.extRequest();
                    // Record the pull before loading: a stream that synchronously reads back one
                    // of the resource's own signals must not re-enter this computation.
                    this.node.value = extRequest;
                    this.node.version++;
                    // Starting the request is a side effect, and a synchronous stream resolves the
                    // state right here - hence outside the reactive context, and before consumers
                    // read the state, so this very pass already sees what a synchronous source
                    // produced.
                    const consumer = setActiveConsumer(null);
                    try {
                        this.loadIfNeeded(extRequest);
                    } finally {
                        setActiveConsumer(consumer);
                    }
                } finally {
                    consumerAfterComputation(this.node, previousConsumer);
                }
            },
        },
    );

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
        const defaultValue = options.defaultValue;

        const injector = options.injector ?? inject(Injector);
        this.pendingTasks = injector.get(PendingTasks);
        this.unregisterOnDestroy = injector.get(DestroyRef).onDestroy(() => this.destroy());

        const value = computed(() => (this.pull(), this.computeValue(this.state(), defaultValue)), {
            equal: this.equal,
        });
        this.value = Object.assign(value, {
            set: (newValue: T | undefined) => this.set(newValue),
            update: (updater: (current: T | undefined) => T | undefined) => this.update(updater),
            asReadonly: () => value,
        }) as unknown as WritableSignal<T | undefined>;

        this.status = computed(() =>
            // A destroyed resource stays idle: without this, a params change after destroy()
            // would recompute the state to "loading" even though nothing will ever load.
            this.destroyed ? "idle" : (this.pull(), projectStatusOfState(this.state())),
        );
        this.error = computed(() => {
            this.pull();
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
        consumerDestroy(this.node);
        this.abortInProgressLoad();
        this.state.set({
            extRequest: { request: undefined, reload: 0 },
            status: "idle",
            previousStatus: "idle",
            stream: undefined,
        });
    }

    private pull(): void {
        producerUpdateValueVersion(this.node);
        producerAccessed(this.node);
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

// Mark the pull node so devtools-style introspection sees a reactive producer, not a plain object.
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

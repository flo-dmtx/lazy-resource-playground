/**
 * The two sides of each figure's code, trimmed to what carries the argument.
 * Demo snippets are written in the proposal syntax; the figure derives the
 * userland one (`lazyRxResource`) from them for the syntax toggle.
 */

export const USAGE_TS = `readonly user = resource({
    load: "whenTracked",                         // the only new line
    params: () => this.userId(),
    loader: ({ params }) => fetchUser(params),
});

// load: "whileTracked" also exists: same trigger, but the value
// is dropped when the last listener leaves.
// rxResource({ load: ..., ... }) inherits both, no other change`;

export const WORKAROUND_TS = `// this component exists to defer one fetch
class UserCard {
    readonly user = rxResource({
        params: () => 1,
        stream: ({ params }) => api.user(params),
    });
}

<!-- created: fetches. destroyed: forgets.
     shown again: fetches again. -->
@if (showCard()) {
    <user-card />
}`;

export const LIFTED_TS = `// today's workaround: wrap the fetch in a child
// component, defer through its lifecycle
class UserCard {
    readonly user = rxResource({
        params: () => 1,
        stream: ({ params }) => api.user(params),
    });
}

// lifted: declared up here, deferred by laziness
readonly profile = rxResource({
    load: "whenTracked",
    params: () => 1,
    stream: ({ params }) => api.user(params),
});`;

export const LIFTED_TPL = `@if (showCard()) {
    <!-- destroy + recreate: fetches every time -->
    <user-card />
}

@if (showPanel()) {
    <!-- the first listener fetches once; reopening is free -->
    @let user = profile.value();
    <dl>... {{ user.name }} ...</dl>
}`;

export const TABS_TS = `readonly comments = rxResource({
    load: "whenTracked",
    params: () => 42,
    stream: ({ params }) => api.comments(params),
});
// + overview, activity: three resources, zero requests`;

export const TABS_TPL = `@switch (tab()) {
    @case ("comments") {
        <!-- first open fetches, coming back does not -->
        @let thread = comments.value();
        ...
    }
}`;

export const PARAMS_TS = `readonly userId = signal(1);

readonly selected = rxResource({
    load: "whenTracked",
    // tracked while asleep, live once awake
    params: () => this.userId(),
    stream: ({ params }) => api.user(params),
});`;

export const PARAMS_TPL = `<select (change)="userId.set(+picker.value)">
    ...
</select>

@if (open()) {
    <!-- the open panel listens: from here on,
         a params change re-fetches -->
    @let user = selected.value();
    ...
} @else {
    <!-- nothing listens: params changes are
         remembered, the network stays idle -->
    <p>Panel closed.</p>
}`;

export const WHILE_TRACKED_TS = `readonly reading = rxResource({
    load: "whileTracked",
    params: () => "sensor-4",
    stream: ({ params }) => api.reading(params),
});
// lives exactly while listened to: the LAST listener
// leaving cancels the load and drops the value`;

export const WHILE_TRACKED_TPL = `<!-- two listeners, one resource, one request -->
@if (panelA()) {
    {{ reading.value() }}
}
@if (panelB()) {
    <!-- closing A alone changes nothing: B still
         listens. closing the last panel forgets;
         mid-flight, it aborts the request -->
    {{ reading.value() }}
}`;

export const CHAIN_TS = `readonly user = rxResource({
    load: "whenTracked",
    params: () => 3,
    stream: ({ params }) => api.user(params),
});

readonly posts = rxResource({
    load: "whenTracked",
    // chain() waits for user to resolve
    params: (ctx) => ctx.chain(this.user)!.id,
    stream: ({ params }) => api.posts(params),
});`;

export const CHAIN_TPL = `<button (click)="revealed.set(true)">
    Load the posts
</button>

@if (revealed()) {
    <!-- the template tracks the end of the chain:
         user wakes, then posts, never in parallel -->
    {{ posts.value() }}
}`;

export const CONTRACT_TS = `readonly profile = rxResource({
    load: "whenTracked",
    params: () => 2,
    stream: ({ params }) => api.user(params),
});

// neither of these wakes it:

// → status 'local', the loader never runs
profile.set(draft);

// → returns false: nothing ever loaded,
//   so there is nothing to re-run
profile.reload();`;

export const CONTRACT_TPL = `@if (shown()) {
    <!-- this render is the first listener -->
    <span class="badge">{{ profile.status() }}</span>
    {{ profile.value()?.name }}
} @else {
    <button (click)="shown.set(true)">
        display it
    </button>
}`;

/* ---- implementation section: condensed from the real diff (branch feat/lazy-resource-v2) ---- */

export const API_DIFF = ` export interface BaseResourceOptions<T, R> {
   ...
+  /**
+   * When the resource loads: eagerly at creation
+   * (the default), or driven by being tracked.
+   */
+  load?: 'eager' | 'whenTracked' | 'whileTracked';
 }`;

export const HOOKS_DIFF = ` export interface ReactiveNode {
   ...
+  /** This producer gained its first live consumer.
+   *  Mirrors TC39 Signals' \`watched\`. */
+  producerOnWatched?(node: unknown): void;
+
+  /** This producer lost its last live consumer.
+   *  Mirrors TC39 Signals' \`unwatched\`. */
+  producerOnUnwatched?(node: unknown): void;
 }

 function producerAddLiveConsumer(node, link) {
   ...
+  if (consumersTail === undefined) {
+    node.producerOnWatched?.(node);
+  }
 }

 function producerRemoveLiveConsumerLink(link) {
   ...
+  if (nextConsumer === undefined) {
+    producer.producerOnUnwatched?.(producer);
+  }
 }`;

export const CONSTRUCT_DIFF = ` constructor(
   ...
+  loadStrategy: ResourceLoadStrategy = 'eager',
 ) {
   ...
+  this.awake = signal(loadStrategy === 'eager');
+  if (loadStrategy !== 'eager') {
+    const node = Object.create(RESOURCE_TRACK_NODE);
+    node.producerOnWatched = () => this.scheduleWake();
+    node.producerOnUnwatched = () =>
+      this.scheduleSleep(loadStrategy === 'whileTracked');
+    this.trackNode = node;
+  } else {
+    this.effectRef = effect(this.loadEffect.bind(this), {
+      injector,
+      manualCleanup: true,
+    });
+  }`;

export const WAKE_SLEEP_TS = `// the first listener arrived: create the load effect —
// the only place a load ever starts
private scheduleWake(): void {
  queueMicrotask(() => {
    if (this.destroyed || untracked(this.awake) ||
        this.trackNode.consumers === undefined) return;
    this.awake.set(true);
    this.loadEffectRef = effect(this.loadEffect.bind(this),
      { injector: this.injector, manualCleanup: true });
  });
}

// the last listener left: no load may run unlistened,
// so the effect goes down and the flight is aborted
private scheduleSleep(dropValue: boolean): void {
  queueMicrotask(() => {
    if (this.destroyed || !untracked(this.awake) ||
        this.trackNode.consumers !== undefined) return;
    this.loadEffectRef?.destroy();
    this.abortInProgressLoad();
    this.awake.set(false);
    if (dropValue) {
      // whileTracked: forget = recompute the state from
      // the current request as if fresh, no history —
      // an abandoned resource is indistinguishable from
      // one that never loaded
      this.state.set(computeState(
        untracked(this.extRequest), undefined, undefined));
    }
  });
}`;

export const READS_DIFF = ` readonly value = computed(() => {
+  this.track();
   return projectValueOfState(this.state());
 });

+// registers the tracking node as a dependency of the
+// calling reactive context; a read outside any live
+// context registers nothing, so wakes nothing
+private track(): void {
+  if (this.trackNode === undefined || this.destroyed) {
+    return;
+  }
+  producerAccessed(this.trackNode);
+}

 readonly status = computed(() => {
+  this.track();
   const status = projectStatusOfState(this.state());
+  // dormant: no load is actually running — report the
+  // truth, not the load that listening would start
+  if (!this.awake() && status === 'loading') {
+    return 'idle';
+  }
   return status;
 });`;

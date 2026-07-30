/**
 * The two sides of each figure's code, trimmed to what carries the argument.
 * Demo snippets are written in the proposal syntax; the figure derives the
 * userland one (`lazyRxResource`) from them for the syntax toggle.
 */

export const USAGE_TS = `readonly user = resource({
    lazy: true,                                  // the only new line
    params: () => this.userId(),
    loader: ({ params }) => fetchUser(params),
});

// rxResource({ lazy: true, ... }) inherits it, no other change`;

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
    lazy: true,
    params: () => 1,
    stream: ({ params }) => api.user(params),
});`;

export const LIFTED_TPL = `@if (showCard()) {
    <!-- destroy + recreate: fetches every time -->
    <user-card />
}

@if (showPanel()) {
    <!-- first read fetches once; reopening is free -->
    @let user = profile.value();
    <dl>... {{ user.name }} ...</dl>
}`;

export const TABS_TS = `readonly comments = rxResource({
    lazy: true,
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
    lazy: true,
    // tracked while asleep, live once awake
    params: () => this.userId(),
    stream: ({ params }) => api.user(params),
});`;

export const PARAMS_TPL = `<select (change)="userId.set(+picker.value)">
    ...
</select>

@if (open()) {
    <!-- the open panel reads it: from here on,
         a params change re-fetches -->
    @let user = selected.value();
    ...
} @else {
    <!-- nothing reads it: params changes are
         remembered, the network stays idle -->
    <p>Panel closed.</p>
}`;

export const CHAIN_TS = `readonly user = rxResource({
    lazy: true,
    params: () => 3,
    stream: ({ params }) => api.user(params),
});

readonly posts = rxResource({
    lazy: true,
    // chain() waits for user to resolve
    params: (ctx) => ctx.chain(this.user)!.id,
    stream: ({ params }) => api.posts(params),
});`;

export const CHAIN_TPL = `<button (click)="revealed.set(true)">
    Load the posts
</button>

@if (revealed()) {
    <!-- the only read on the page: wakes user,
         then posts, in order, never in parallel -->
    {{ posts.value() }}
}`;

export const CONTRACT_TS = `readonly profile = rxResource({
    lazy: true,
    params: () => 2,
    stream: ({ params }) => api.user(params),
});

// neither of these wakes it:

// → status 'local', the loader never runs
profile.set(draft);

// → returns false before any read;
//   the load waits for the next read
profile.reload();`;

export const CONTRACT_TPL = `@if (awake()) {
    <!-- these are the first reads -->
    <span class="badge">{{ profile.status() }}</span>
    {{ profile.value()?.name }}
} @else {
    <button (click)="awake.set(true)">
        read it
    </button>
}`;

/* ---- implementation section: condensed from the real diff (commit ade5b9e) ---- */

export const API_DIFF = ` export interface BaseResourceOptions<T, R> {
   ...
+  /**
+   * Whether the resource defers loading until the first
+   * time one of its signals is read.
+   * Defaults to \`false\`.
+   */
+  lazy?: boolean;
 }`;

export const CONSTRUCT_DIFF = ` export function resource<T, R>(options) {
   return new ResourceImpl<T, R>(
     ...
+    options.lazy ? 'lazy' : 'eager',
   );
 }

 constructor(
   ...
+  loadStrategy: 'eager' | 'lazy' = 'eager',
 ) {
   ...
-  this.effectRef = effect(this.loadEffect.bind(this), {
-    injector,
-    manualCleanup: true,
-  });
+  if (loadStrategy === 'lazy') {
+    const node = Object.create(RESOURCE_PULL_NODE);
+    node.readExtRequest = () => this.extRequest();
+    node.load = () => {
+      if (!this.destroyed) this.loadEffect();
+    };
+    this.pullNode = node;
+  } else {
+    this.effectRef = effect(this.loadEffect.bind(this), {
+      injector,
+      manualCleanup: true,
+    });
+  }`;

export const PULL_NODE_TS = `const RESOURCE_PULL_NODE = {
  ...REACTIVE_NODE,
  value: UNSET_PULL,
  dirty: true,
  // a node that has never computed must compute on the first pull
  producerMustRecompute: (node) => node.value === UNSET_PULL,
  producerRecomputeValue: (node) => {
    // track extRequest: a params change re-dirties the node
    const prev = consumerBeforeComputation(node);
    try {
      // record the pull before loading, so a loader that
      // reads the resource back cannot re-enter
      node.value = node.readExtRequest();
      node.version++;
      // the load runs untracked: it is the side effect
      node.load();
    } finally {
      consumerAfterComputation(node, prev);
    }
  },
};`;

export const READS_DIFF = ` readonly value = computed(() => {
+  this.pull();
   return projectValueOfState(this.state());
 });

+private pull(): void {
+  if (this.pullNode === undefined || this.destroyed) {
+    return;
+  }
+  // recompute if the params moved while asleep
+  producerUpdateValueVersion(this.pullNode);
+  // and keep following them from now on
+  producerAccessed(this.pullNode);
+}`;

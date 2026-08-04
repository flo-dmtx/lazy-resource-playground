import { Component } from "@angular/core";

import { CodeBlock } from "./code-block";
import { Figure } from "./figure";
import * as snip from "./snippets";

@Component({
    selector: "app-root",
    imports: [Figure, CodeBlock],
    template: `
        <div class="doc">
            <nav class="toc" aria-label="Contents">
                <label class="version">
                    <span>version</span>
                    <select aria-label="Proposal version" #version (change)="openVersion(version.value)">
                        <option value="v2">v2 — current</option>
                        <option value="v1">v1 — outdated</option>
                    </select>
                </label>
                <a href="#description">Description</a>
                <a href="#solution">Proposed solution</a>
                <a href="#alternatives">Alternatives</a>
                <a href="#use-cases">Use cases</a>
                <a href="#tests">Tests</a>
                <a href="#implementation">Implementation</a>
                <a href="#links">Links</a>
            </nav>

            <main>
                <header class="head">
                    <h1>Lazy load strategies for Angular resources</h1>
                    <p class="standfirst">
                        <code>resource(&#123; load: 'whenTracked' &#125;)</code>: the loader waits
                        for the first listener; what renders is what fetches.
                    </p>
                    <p class="aside">
                        This page shows <strong>proposal v2</strong> (tracking-driven), reshaped by
                        the discussion on the feature request. The issue body still describes v1
                        (<code>lazy: true</code>, any read wakes); what changed and why is in the
                        thread. The v1 page is frozen, demos included:
                        <a href="v1/" rel="noopener">view the outdated v1 page</a>.
                    </p>
                    <p class="head-links">
                        <a href="https://github.com/angular/angular/issues/70036" rel="noopener"
                            >feature request #70036</a
                        >
                        ·
                        <a
                            href="https://dev.to/flodmtx/resource-lazy-true-the-laziness-we-lost-when-we-left-the-async-pipe-5e70"
                            rel="noopener"
                            >article</a
                        >
                        ·
                        <a
                            href="https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900"
                            rel="noopener"
                            >gist</a
                        >
                        ·
                        <a
                            href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource-v2"
                            rel="noopener"
                            >native branch</a
                        >
                        ·
                        <a
                            href="https://stackblitz.com/~/github.com/flo-dmtx/lazy-resource-playground"
                            rel="noopener"
                            >StackBlitz</a
                        >
                    </p>
                </header>

                <section id="description">
                    <h2>Description</h2>
                    <p>
                        <strong>Context.</strong> For loading async data into a screen, today
                        there is:
                    </p>
                    <ul class="rules">
                        <li>
                            <code>resource()</code> and <code>rxResource()</code>: the
                            <code>params</code> describe what to fetch, a loader fetches it, and
                            templates read the result through <code>value()</code>,
                            <code>status()</code> and the other signals. Loading is eager by
                            design: it starts at construction and runs again on every params
                            change, whether or not anything displays the data.
                        </li>
                        <li>
                            <code>&#64;defer</code>: it defers a block of the view. On its trigger
                            the chunk loads and the block renders; it says nothing about data.
                        </li>
                    </ul>
                    <p>As far as I know, nothing today defers the data itself.</p>
                    <p>
                        <strong>Problem.</strong> Not everything a screen declares is needed right
                        away: detail panels, tabs, previews. With eager-only resources, there are
                        two ways out, always the same two:
                    </p>
                    <ul class="rules">
                        <li>
                            fetch everything up front, and pay for requests that may never be
                            looked at;
                        </li>
                        <li>
                            or push each request into a component that only exists once the UI
                            shows it, behind an <code>&#64;if</code> or a <code>&#64;defer</code>,
                            so its lifecycle stands in for the missing laziness.
                        </li>
                    </ul>
                    <code-block [code]="snip.WORKAROUND_TS"></code-block>
                    <p>
                        The second option works, and it is what I write today, but it has real
                        costs. The value dies with the component, so every recreation fetches
                        again. Data fetching scatters down the tree, away from the routes and
                        services that own the screen, and some components exist only to wrap a
                        request. What is missing is a resource declared where the data belongs,
                        that does not load until something reads it.
                    </p>
                    <p>
                        <strong>Prior issue.</strong>
                        <a href="https://github.com/angular/angular/issues/58422" rel="noopener"
                            >#58422</a
                        >
                        asked for a <code>lazy</code> option and was closed with a clear position:
                        render-driven data fetching invites request waterfalls, and data is better
                        lifted up to routes. I agree with that concern. My point is that the
                        waterfalls are already here: without a lazy primitive, deferring a fetch
                        means tying it to a component lifecycle — render-driven fetching in its
                        most fragile form. A lazy resource pulls in the opposite direction:
                    </p>
                    <ul class="rules">
                        <li>the declaration moves up, next to the rest of the screen's data;</li>
                        <li>the trigger is the first listener, and it fires only once;</li>
                        <li>
                            the loaded value outlives its listeners, so showing the same UI again
                            does not refetch.
                        </li>
                    </ul>
                    <p>
                        The waterfall the issue worried about has nowhere to repeat, and since
                        the option is opt-in, eager resources are strictly untouched. It composes
                        with <code>&#64;defer</code> instead of competing with it: the deferred
                        view brings the code, the lazy resource in the parent brings the data,
                        and nothing is paid before it is needed.
                    </p>
                </section>

                <section id="solution">
                    <h2>Proposed solution</h2>
                    <h3>The model</h3>
                    <p>A resource is a reactive stream, and there are exactly two ways to consume one:</p>
                    <ul class="rules">
                        <li>
                            <strong>Listen to it</strong> — a live reactive context (a template or
                            an effect, directly or through <code>computed</code>s) tracks one of
                            its signals.
                        </li>
                        <li>
                            <strong>Photograph it</strong> — any read outside a reactive context,
                            including inside <code>untracked()</code>, returns the current state
                            at that instant and starts nothing. A dormant resource truthfully
                            reads <code>&#123;status: 'idle', value: defaultValue&#125;</code>, so
                            <code>loading</code> only ever means a request is actually running.
                        </li>
                    </ul>
                    <p>
                        One invariant follows:
                        <strong>no load ever runs while nothing tracks the resource.</strong>
                    </p>
                    <h3>The API</h3>
                    <code-block [code]="snip.USAGE_TS"></code-block>
                    <p>
                        <code>load?: 'eager' | 'whenTracked' | 'whileTracked'</code>, defaulting
                        to <code>'eager'</code>, which is the existing behavior, strictly
                        untouched. No new methods and no new types: <code>ResourceRef</code> is
                        unchanged, and this one option is the entire public API surface of the
                        proposal.
                    </p>
                    <ul class="rules">
                        <li>
                            <code>'whenTracked'</code> — dormant until its first listener, and
                            that listener starts the load. The settled value is retained when
                            listeners leave, so showing the same UI again does not re-fetch, until
                            <code>params</code> change and invalidate the value as usual.
                        </li>
                        <li>
                            <code>'whileTracked'</code> — lives exactly while listened to. The
                            first listener starts the load; when the last listener leaves, any
                            in-flight load is cancelled, the value is dropped (local values
                            included) and the resource returns to <code>idle</code>. The next
                            listener starts over. For data that should not outlive the screen
                            showing it.
                        </li>
                    </ul>
                    <p>
                        In practice, here is the same hidden panel twice: a fetch wrapped in a
                        child component, which pays again on every recreation, next to a resource
                        declared in the parent with <code>load: "whenTracked"</code>.
                    </p>
                    <app-figure
                        name="lifted"
                        [ts]="snip.LIFTED_TS"
                        [tpl]="snip.LIFTED_TPL"
                    ></app-figure>
                    <h3>Shared behavior, both strategies</h3>
                    <ul class="rules">
                        <li>
                            <code>params</code> changes while dormant are tracked but never
                            fetched, and the first listener uses the latest value. While listened
                            to, the resource behaves exactly like an eager one: params refetch,
                            <code>reload()</code>, statuses, errors, cancellation.
                        </li>
                        <li>
                            <code>untracked(() => r.value())</code> is the way to inspect a lazy
                            resource without waking it: reads inside <code>untracked()</code> are
                            snapshots like any other non-reactive read, so a reactive context can
                            consult the current state without becoming a listener.
                        </li>
                        <li>
                            Writes never wake it. <code>set()</code> goes to <code>local</code>
                            without loading, and a later listener does not overwrite that local
                            value.
                        </li>
                        <li>
                            <code>reload()</code> while dormant never starts a load. It returns
                            <code>false</code> when nothing has ever been loaded, and on a
                            retained settled value it invalidates that value and defers the
                            refetch to the next listener, which is the same rule as dormant
                            params: remembered now, fetched when someone listens.
                        </li>
                        <li>
                            A dormant resource never affects application stability, so SSR does
                            not wait for it — and combining a lazy strategy with <code>id</code>
                            is documented as discouraged, since the hydration window has usually
                            closed by the first listener.
                        </li>
                        <li>
                            Composition is transparent. Wrapping a lazy resource
                            (<code>resourceFromSnapshots</code>, <code>computed</code> chains,
                            <code>params</code> chaining) stays dormant end to end, and listening
                            to the wrapper wakes the source through every layer, because interest
                            is the reactive graph's own liveness.
                        </li>
                    </ul>
                    <h3>Why tracking and not reading</h3>
                    <p>
                        v1 woke the resource on any read. Two arguments changed my mind, both of
                        them coming out of the discussion:
                    </p>
                    <ol class="rules">
                        <li>
                            <strong>The missing handle.</strong> A non-reactive read that triggers
                            a load never benefits its caller: it returns <code>undefined</code>
                            and nothing will ever notify it. A tracked read leaves a subscriber
                            behind. Only when a read is tracked it is worth loading the value.
                        </li>
                        <li>
                            <strong>The wrong primitive.</strong> I had sketched an imperative
                            escape hatch returning a promise (<code>toPromise()</code>, the
                            counterpart of the <code>loadValue()</code> suggested in the thread).
                            But a promise is the primitive for one value and a resource is a
                            stream: callers either want to react to it, which means being
                            reactive, or want the data itself, in which case they can call the API
                            their loader wraps. For the rare genuine need the existing bridges
                            compose: <code>firstValueFrom(toObservable(...))</code>.
                        </li>
                    </ol>
                    <p>
                        With both gone, non-reactive reads have exactly one coherent meaning, a
                        snapshot, and the API needs no <code>peek()</code> either, since a read
                        outside a reactive context already is one by construction.
                        <code>&#64;if (r.hasValue())</code> cannot deadlock, because a template
                        read is a tracked read: it wakes the resource.
                    </p>
                    <p class="aside">
                        Two implementations exist: a
                        <a
                            href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource-v2"
                            rel="noopener"
                            >PR-ready fork</a
                        >
                        with the native option, tested with the repo's own suite (see Tests and
                        Implementation below), and a userland twin,
                        <a
                            href="https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900"
                            rel="noopener"
                            ><code>lazyRxResource</code></a
                        >, to copy until this lands. The demos on this page run the fork's
                        change itself: the project pins <code>&#64;angular/core</code> and applies
                        the same diff to the published bundle through patch-package, so every
                        figure executes the native
                        <code>rxResource(&#123; load: '…' &#125;)</code>. The
                        <strong>load: '…' / lazyRxResource</strong> toggle in each figure
                        switches the code tabs between the two syntaxes.
                    </p>
                </section>

                <section id="alternatives">
                    <h2>Alternatives considered</h2>
                    <p>
                        Before proposing a change to core, I tried to obtain these semantics from
                        userland, on top of the public API. To compare the attempts I wrote a
                        parameterized contract suite: the sleeping rules, plus everything a
                        native resource must keep doing once awake (statuses, errors,
                        cancellation, SSR stability) — 39 observable behaviors in v1 semantics,
                        mirrored as 44 specs for v2. Each attempt is scored against the contract
                        it targets.
                    </p>
                    <table class="bench">
                        <thead>
                            <tr>
                                <th>strategy</th>
                                <th>lines</th>
                                <th>contract</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>gate the params on a "shown" flag</td>
                                <td class="num">~60</td>
                                <td class="num bad">18/39</td>
                            </tr>
                            <tr>
                                <td>
                                    reimplement as new functions (<code>lazyResource</code>,
                                    <code>lazyRxResource</code>)
                                </td>
                                <td class="num">~560</td>
                                <td class="num good">44/44</td>
                            </tr>
                            <tr class="native-row">
                                <td>the native option (this proposal)</td>
                                <td class="num">~210</td>
                                <td class="num good">by construction</td>
                            </tr>
                        </tbody>
                    </table>
                    <p class="aside">
                        Gating the params on a "shown" flag is the workaround commonly found in
                        applications; it defers the first load but misses most of the sleeping
                        rules (18/39 on the v1 suite). I also tried driving core's private
                        <code>loadEffect</code>: it gets much closer, but stalls at 34/39 and
                        depends on two private fields, which is not something I would want anyone
                        to ship. The only userland shape that passes a whole contract is a
                        reimplementation of the resource machinery beside core — today about 560
                        lines implementing v2, green on a 44-spec mirror of the branch's suite —
                        that has to follow core on every release. The same semantics fits in
                        about 210 lines inside core, graph hooks included, and that difference is
                        why I am proposing the option upstream.
                    </p>
                    <p class="aside">
                        For v2 the argument got sharper. The reimplementation now implements the
                        v2 contract (a dedicated 44-spec suite mirrors the branch's), but its
                        trigger has to be stolen: "the first live consumer arrived / the last one
                        left" is the reactive graph's private bookkeeping, with no public API. The
                        twin observes it by turning the <code>consumers</code> field of its own
                        node into an accessor property — it works and it is tested, but nothing
                        contracts Angular to keep that bookkeeping, which is precisely the case
                        for core support. It is published as a
                        <a
                            href="https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900"
                            rel="noopener"
                            >single-file gist</a
                        >.
                    </p>
                </section>

                <section id="use-cases">
                    <h2>Use cases</h2>

                    <div class="case">
                        <p class="case-tag">the motivating case</p>
                        <h3>Tabs, each with their own data</h3>
                        <p>
                            Three resources declared where the data model lives, zero requests.
                            Each tab fetches on first open, and coming back is free because the
                            value outlives its reader.
                        </p>
                        <app-figure
                            name="tabs"
                            [ts]="snip.TABS_TS"
                            [tpl]="snip.TABS_TPL"
                        ></app-figure>
                    </div>

                    <div class="case">
                        <p class="case-tag">advanced</p>
                        <h3>Pick the params before opening</h3>
                        <p>
                            There are two phases. While the panel is closed, nothing reads the
                            resource: change the user
                            as often as you like, the selection is remembered and no request
                            leaves. Open it: one request, with the latest pick. From then on the
                            open panel reads it, so changing the user re-fetches. Close it again
                            and the params go back to being only remembered.
                        </p>
                        <app-figure
                            name="params"
                            [ts]="snip.PARAMS_TS"
                            [tpl]="snip.PARAMS_TPL"
                        ></app-figure>
                    </div>

                    <div class="case">
                        <p class="case-tag">new in v2</p>
                        <h3>A value that should not outlive its screen</h3>
                        <p>
                            Same resource, two strategies. With <code>whenTracked</code> a single
                            panel is enough to show the point: closing it keeps the reading, and
                            reopening shows the same value, for free.
                            <code>whileTracked</code> lives exactly while listened to, and two
                            panels read it here — opening either one wakes it, and closing one
                            while the other stays open costs nothing. Closing the last one
                            abandons the resource: an in-flight request is cancelled, watch the
                            network log, a settled value is dropped, and the next open starts from
                            cold with a fresh measurement.
                        </p>
                        <app-figure
                            name="reset"
                            [ts]="snip.WHILE_TRACKED_TS"
                            [tpl]="snip.WHILE_TRACKED_TPL"
                        ></app-figure>
                    </div>

                    <div class="case">
                        <p class="case-tag">advanced</p>
                        <h3>One resource depending on another</h3>
                        <p>
                            <code>posts</code> needs the id that <code>user</code> will resolve.
                            Both stay asleep until one button displays the end of the chain; then
                            they wake in order, never in parallel: watch the two requests leave
                            one after the other. Liveness propagates through the reactive graph,
                            so <code>computed()</code> and wrappers compose the same way.
                        </p>
                        <app-figure
                            name="chain"
                            [ts]="snip.CHAIN_TS"
                            [tpl]="snip.CHAIN_TPL"
                        ></app-figure>
                    </div>

                    <div class="case">
                        <p class="case-tag">edge cases</p>
                        <h3>Writes and errors on a never-displayed resource</h3>
                        <p>
                            Nothing in either card displays its resource until you press
                            <em>display it</em>; that render is the first listener. One card calls
                            <code>set()</code> and <code>reload()</code> before that: the network
                            stays empty, and the action log shows what each call returned. The
                            other card holds a loader that throws: it only gets to throw once
                            something listens, and <code>set()</code> recovers from the error.
                        </p>
                        <app-figure
                            name="contract"
                            [ts]="snip.CONTRACT_TS"
                            [tpl]="snip.CONTRACT_TPL"
                        ></app-figure>
                    </div>
                </section>

                <section id="tests">
                    <h2>Tests</h2>
                    <ul class="facts">
                        <li>
                            <span class="fact-num">109/109</span> on
                            <code>//packages/core/test/resource</code>: the lazy suite rewritten
                            for v2 (43 specs, the shared contract run for both strategies), plus
                            every pre-existing spec passing unchanged
                        </li>
                        <li>
                            <span class="fact-num">76/76</span> on <code>rxjs-interop</code>,
                            including <code>rx_resource_spec</code>
                        </li>
                        <li>
                            <span class="fact-num">✓</span> <code>signals</code> and
                            <code>render3</code> primitives suites (the two graph hooks), and
                            public API goldens, verified with the repo's own tooling
                        </li>
                    </ul>
                    <details class="test-list">
                        <summary>the new suite, spec by spec</summary>
                        <div class="test-groups">
                            @for (group of tests; track group.name) {
                                <div class="test-group">
                                    <h4>{{ group.name }}</h4>
                                    <ul>
                                        @for (spec of group.specs; track spec) {
                                            <li><span class="check">✓</span>{{ spec }}</li>
                                        }
                                    </ul>
                                </div>
                            }
                        </div>
                    </details>
                </section>

                <section id="implementation">
                    <h2>Implementation</h2>
                    <p>
                        A single commit on
                        <a
                            href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource-v2"
                            rel="noopener"
                            >flo-dmtx/angular</a
                        >, rebased on current main — v1 keeps
                        <a
                            href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource"
                            rel="noopener"
                            >its own branch</a
                        >, so the two designs stay side by side. The v2 shape: 22 lines in
                        <code>graph.ts</code>, ~190 in <code>resource.ts</code>, the option in
                        <code>api.ts</code>, a 577-line spec. It reads in four steps:
                    </p>

                    <div class="step">
                        <h3>1 · One optional field</h3>
                        <p>
                            The option lands on <code>BaseResourceOptions</code>. <code>rxResource</code> already
                            spreads its options into <code>resource()</code>, so it inherits the
                            option without any interop code change.
                        </p>
                        <code-block [code]="snip.API_DIFF" [diff]="true"></code-block>
                    </div>

                    <div class="step">
                        <h3>2 · Two hooks the graph already knows how to fire</h3>
                        <p>
                            The reactive graph maintains, for every producer, the list of its live
                            consumers. Two optional hooks surface the transitions of that list —
                            they mirror the <code>watched</code>/<code>unwatched</code> callbacks
                            of the TC39 Signals proposal, so this is infrastructure Angular will
                            likely want anyway.
                        </p>
                        <code-block [code]="snip.HOOKS_DIFF" [diff]="true"></code-block>
                    </div>

                    <div class="step">
                        <h3>3 · The load effect only exists while listened to</h3>
                        <p>
                            In a lazy strategy, a passive tracking node replaces the load effect
                            at construction. Its <code>watched</code> transition creates the
                            effect — the only place a load ever starts — and its
                            <code>unwatched</code> transition tears it down, cancelling any
                            in-flight request.
                        </p>
                        <code-block [code]="snip.CONSTRUCT_DIFF" [diff]="true"></code-block>
                        <code-block [code]="snip.WAKE_SLEEP_TS"></code-block>
                    </div>

                    <div class="step">
                        <h3>4 · Tracking is the trigger</h3>
                        <p>
                            Every public signal registers the tracking node as a dependency, so a
                            listener's liveness reaches it through any depth of computeds — that
                            is what makes composition work. A read outside a reactive context
                            registers nothing, so wakes nothing, and a dormant resource reports
                            the truth: <code>idle</code>.
                        </p>
                        <code-block [code]="snip.READS_DIFF" [diff]="true"></code-block>
                    </div>

                    <p>
                        Two supporting changes come with it: <code>set()</code> reads the raw
                        state, so a write can never wake the resource; <code>destroy()</code>
                        tears the tracking node down, so a destroyed resource can never load
                        again. Until it lands, the same semantics is available as one userland
                        file: copy <code>src/app/lazy-resource.ts</code> out of this project, or
                        grab it from
                        <a
                            href="https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900"
                            rel="noopener"
                            >the gist</a
                        >.
                    </p>
                </section>

                <section id="links">
                    <h2>Links</h2>
                    <ul class="rules">
                        <li>
                            Support the proposal:
                            <a
                                href="https://github.com/angular/angular/issues/70036"
                                rel="noopener"
                                >feature request angular/angular#70036</a
                            >, and the story behind it:
                            <a
                                href="https://dev.to/flodmtx/resource-lazy-true-the-laziness-we-lost-when-we-left-the-async-pipe-5e70"
                                rel="noopener"
                                >article on dev.to</a
                            >.
                        </li>
                        <li>
                            Use it today, one file:
                            <a
                                href="https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900"
                                rel="noopener"
                                >the <code>lazyResource</code> / <code>lazyRxResource</code> gist</a
                            >.
                        </li>
                        <li>
                            The native implementation, tested with the repo's own suite:
                            <a
                                href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource-v2"
                                rel="noopener"
                                >branch <code>feat/lazy-resource-v2</code></a
                            >.
                        </li>
                        <li>
                            This page:
                            <a
                                href="https://github.com/flo-dmtx/lazy-resource-playground"
                                rel="noopener"
                                >source on GitHub</a
                            >,
                            <a
                                href="https://stackblitz.com/~/github.com/flo-dmtx/lazy-resource-playground"
                                rel="noopener"
                                >editable on StackBlitz</a
                            >.
                        </li>
                        <li>
                            The prior discussion:
                            <a
                                href="https://github.com/angular/angular/issues/58422"
                                rel="noopener"
                                >angular/angular#58422</a
                            >.
                        </li>
                    </ul>
                </section>

                <footer class="foot">
                    Every request on this page goes through a small fake network; the panel under
                    each demo shows everything it sees, and nothing else.
                </footer>
            </main>
        </div>
    `,
    styles: `
        .doc {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            justify-content: center;
        }

        main {
            width: min(100%, 54rem);
            justify-self: center;
            padding: 3rem clamp(1.25rem, 4vw, 2.5rem) 5rem;
            display: grid;
            gap: 3rem;
        }

        main > section {
            display: grid;
            gap: 0.875rem;
            scroll-margin-top: 1.5rem;
        }

        p,
        li {
            text-align: justify;
        }

        /* toc */

        .toc {
            position: fixed;
            top: 3.25rem;
            right: max(1rem, calc(50vw - 27rem - 11rem));
            width: 9.5rem;
            display: grid;
            gap: 0.375rem;
            font-size: 0.78125rem;
        }

        .toc a {
            color: var(--faint);
            text-decoration: none;
        }

        .toc a:hover {
            color: var(--text);
        }

        .toc .version {
            display: grid;
            gap: 0.3125rem;
            padding-bottom: 0.875rem;
            margin-bottom: 0.5rem;
            border-bottom: 1px solid var(--border);
        }

        .toc .version span {
            font-family: var(--mono);
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--faint);
        }

        .toc .version select {
            font-family: var(--mono);
            font-size: 0.71875rem;
            color: var(--text);
            background: var(--surface);
            border: 1px solid var(--border-strong);
            border-radius: var(--radius-sm);
            padding: 0.35rem 0.5rem;
            width: 100%;
        }

        @media (max-width: 78rem) {
            .toc {
                display: none;
            }
        }

        /* header */

        .head {
            display: grid;
            gap: 0.75rem;
        }

        h1 {
            font-size: clamp(1.5rem, 3.5vw, 2.25rem);
        }

        h1 code {
            background: none;
            border: none;
            padding: 0;
            font-size: inherit;
            white-space: normal;
        }

        .standfirst {
            font-size: 1.0625rem;
            color: var(--muted);
        }

        .head-links {
            font-size: 0.8125rem;
            color: var(--faint);
        }

        h2 {
            font-size: 1.25rem;
        }

        .aside {
            font-size: 0.875rem;
            color: var(--muted);
        }

        /* solution */

        #solution h3 {
            font-size: 1rem;
            margin-top: 0.375rem;
        }

        .rules {
            display: grid;
            gap: 0.5rem;
            padding-left: 1.25rem;
            font-size: 0.9375rem;
        }

        /* alternatives */

        .bench {
            border-collapse: collapse;
            font-size: 0.875rem;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            overflow: hidden;
        }

        .bench th {
            font-family: var(--mono);
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--faint);
            text-align: left;
            font-weight: 500;
            padding: 0.625rem 1rem;
            border-bottom: 1px solid var(--border);
        }

        .bench td {
            padding: 0.625rem 1rem;
            border-bottom: 1px solid var(--border);
            color: var(--muted);
        }

        .bench tbody tr:last-child td {
            border-bottom: none;
        }

        .num {
            font-family: var(--mono);
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        .bad { color: var(--failed); }
        .mid { color: var(--pending); }
        .good { color: var(--ok); }

        .native-row td {
            background: var(--wake-soft);
            color: var(--text);
        }

        /* use cases */

        .case {
            display: grid;
            gap: 0.5rem;
            border-top: 1px solid var(--border);
            padding-top: 1.25rem;
        }

        .case + .case {
            margin-top: 1rem;
        }

        .case-tag {
            font-family: var(--mono);
            font-size: 0.6875rem;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--wake);
        }

        .case h3 {
            font-size: 1rem;
        }

        .case p {
            font-size: 0.9375rem;
        }

        .case app-figure {
            margin-top: 0.5rem;
        }

        /* tests */

        .facts {
            list-style: none;
            display: grid;
            gap: 0.5rem;
        }

        .facts li {
            display: flex;
            align-items: baseline;
            gap: 0.75rem;
            font-size: 0.9375rem;
        }

        .fact-num {
            font-family: var(--mono);
            font-size: 1rem;
            font-weight: 600;
            color: var(--ok);
            min-width: 3.5rem;
            text-align: right;
            white-space: nowrap;
        }

        .test-list {
            margin-top: 0.375rem;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--surface);
            overflow: hidden;
        }

        summary {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            padding: 0.625rem 1rem;
            background: var(--surface-dim);
            font-size: 0.8125rem;
            font-weight: 500;
            cursor: pointer;
            list-style: none;
        }

        summary::-webkit-details-marker {
            display: none;
        }

        summary::before {
            content: "";
            flex-shrink: 0;
            width: 0.375rem;
            height: 0.375rem;
            border-right: 1.5px solid var(--faint);
            border-bottom: 1.5px solid var(--faint);
            transform: rotate(-45deg);
            transition: transform 150ms ease;
        }

        details[open] summary::before {
            transform: rotate(45deg);
        }

        details[open] summary {
            border-bottom: 1px solid var(--border);
        }

        .test-groups {
            padding: 1rem 1.25rem;
            display: grid;
            gap: 1rem;
        }

        .test-group h4 {
            font-family: var(--mono);
            font-size: 0.6875rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--faint);
            margin-bottom: 0.25rem;
        }

        .test-group ul {
            list-style: none;
            display: grid;
            gap: 0.15rem;
        }

        .test-group li {
            font-family: var(--mono);
            font-size: 0.78125rem;
            color: var(--muted);
        }

        .check {
            color: var(--ok);
            margin-right: 0.5rem;
        }

        /* implementation */

        .step {
            display: grid;
            gap: 0.5rem;
            margin-top: 0.5rem;
        }

        .step h3 {
            font-size: 0.9375rem;
        }

        .step p {
            font-size: 0.9375rem;
        }

        .foot {
            border-top: 1px solid var(--border);
            padding-top: 1.25rem;
            font-size: 0.8125rem;
            color: var(--faint);
        }
    `,
})
export class App {
    readonly snip = snip;
    readonly tests = TESTS;

    openVersion(version: string): void {
        if (version === "v1") {
            location.href = "v1/";
        }
    }
}

/** The `it()` names of resource_lazy_spec.ts, verbatim. */
const TESTS = [
    {
        name: "shared lazy contract — run for both 'whenTracked' and 'whileTracked'",
        specs: [
            "should not load at creation",
            "should not wake from reads outside a reactive context",
            "should wake when an effect starts tracking it",
            "should wake when a template renders it",
            "should not deadlock behind a hasValue() guard",
            "should never fetch params changes while dormant, then use the latest",
            "should react to params changes while tracked",
            "should stay dormant behind a computed until a listener reads the computed",
            "should keep a local value set before any listener, without loading",
            "should refuse reload() while dormant",
            "should surface a rejected loader through the listener",
            "should abort the in-flight load when the params change while tracked",
            "should return the defaultValue while dormant and while loading",
            "should never load once destroyed, even with a listener",
            "should chain laziness: listening to the parent wakes the chain in order",
            "should compose through resourceFromSnapshots: listening to the wrapper wakes the source",
            "should keep the application stable while dormant",
        ],
    },
    {
        name: "retention (load: 'whenTracked')",
        specs: [
            "should keep the value when the last listener leaves, and not refetch on the next one",
            "should defer params changes while untracked to the next listener",
        ],
    },
    {
        name: "reset (load: 'whileTracked')",
        specs: [
            "should drop the value and return to idle when the last listener leaves",
            "should cancel the in-flight load and forget when abandoned mid-load",
            "should keep the value while at least one listener remains",
            "should also drop a local value on abandon",
            "should re-derive a params error after abandon instead of blanking it",
        ],
    },
    {
        name: "the eager path, unchanged",
        specs: [
            "should load eagerly when load is not set",
            "should load eagerly when load is explicitly 'eager'",
        ],
    },
];

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
                    <h1>A lazy option for Angular resources</h1>
                    <p class="standfirst">
                        <code>resource(&#123; lazy: true &#125;)</code>: the loader waits for the
                        first read; what renders is what fetches.
                    </p>
                </header>

                <section id="description">
                    <h2>Description</h2>
                    <p>
                        <strong>Context.</strong> For loading async data into a screen today, we
                        have:
                    </p>
                    <ul class="rules">
                        <li>
                            <code>resource()</code> and <code>rxResource()</code>: the
                            <code>params</code> describe what to fetch, a loader fetches it, and
                            templates read the result through <code>value()</code>,
                            <code>status()</code> and the other signals. Loading is eager by
                            design: it starts at construction, and runs again whenever the params
                            change, whether something displays the data or not.
                        </li>
                        <li>
                            <code>&#64;defer</code>: it defers a block of the view. The code chunk
                            loads and the block renders on its trigger; it says nothing about
                            data.
                        </li>
                    </ul>
                    <p>As far as I know, nothing today defers the data itself.</p>
                    <p>
                        <strong>Problem.</strong> Not everything a screen declares is needed right
                        away: detail panels, tabs, previews. With eager-only resources, we keep
                        facing the same two options:
                    </p>
                    <ul class="rules">
                        <li>
                            fetch everything up front, and pay for requests that may never be
                            looked at;
                        </li>
                        <li>
                            or push each request down into a component that only exists once the
                            UI shows it, behind an <code>&#64;if</code> or inside a
                            <code>&#64;defer</code> block, so that its lifecycle plays the part of
                            the missing laziness.
                        </li>
                    </ul>
                    <code-block [code]="snip.WORKAROUND_TS"></code-block>
                    <p>
                        The second option works, and it is what we do today, but it has real
                        costs. The value dies with the component, so every recreation fetches
                        again. Data fetching scatters down the tree, away from the routes and
                        services that own the screen. And some components exist for no other
                        reason than wrapping a request. What seems to be missing is a resource
                        that can be declared where the data belongs, yet does not evaluate until
                        something actually reads it.
                    </p>
                    <p>
                        <strong>Prior issue.</strong>
                        <a href="https://github.com/angular/angular/issues/58422" rel="noopener"
                            >#58422</a
                        >
                        asked for a <code>lazy</code> option and was closed with a clear position:
                        render-driven data fetching invites request waterfalls, and data is better
                        lifted up to routes. I agree with that concern. My point is that the
                        waterfalls are already here, because deferring a fetch without a lazy
                        primitive means tying it to a component lifecycle, which is render-driven
                        fetching in its most fragile form. A lazy resource pulls in the opposite
                        direction:
                    </p>
                    <ul class="rules">
                        <li>the declaration moves up, next to the rest of the screen's data;</li>
                        <li>the trigger is the first read, and it fires only once;</li>
                        <li>
                            the loaded value outlives its readers, so showing the same UI again
                            does not refetch.
                        </li>
                    </ul>
                    <p>
                        The waterfall the issue worried about has nowhere to repeat. And since the
                        option is opt-in, eager resources are left strictly untouched. It also
                        composes with <code>&#64;defer</code> rather than competing with it: the
                        deferred view brings the code, the lazy resource in the parent brings the
                        data, and neither pays before the other needs it.
                    </p>
                </section>

                <section id="solution">
                    <h2>Proposed solution</h2>
                    <code-block [code]="snip.USAGE_TS"></code-block>
                    <ul class="rules">
                        <li>
                            The first read of any of its signals starts the load, and nothing else
                            does. That includes <code>value()</code>, <code>status()</code>,
                            <code>hasValue()</code>, and reads made inside
                            <code>untracked()</code>.
                        </li>
                        <li>
                            While asleep, <code>params</code> changes are tracked but never
                            fetched; the first read uses the latest value.
                        </li>
                        <li>
                            Writes never wake it: <code>set()</code> before any read goes
                            <code>local</code> without fetching, and <code>reload()</code> defers
                            the load to the next read.
                        </li>
                        <li>
                            Once awake, it behaves exactly like an eager resource: same statuses,
                            errors, cancellation and SSR stability. Combining <code>lazy</code>
                            with <code>id</code> is documented as discouraged, since the hydration
                            window has usually closed by the first read.
                        </li>
                    </ul>
                    <p>
                        In practice, here is the same hidden panel twice: a fetch wrapped in a
                        child component, which pays again on every recreation, next to a resource
                        declared in the parent with <code>lazy: true</code>.
                    </p>
                    <app-figure
                        name="lifted"
                            [ts]="snip.LIFTED_TS"
                        [tpl]="snip.LIFTED_TPL"
                    ></app-figure>
                    <p class="aside">
                        Why does every read wake it, even inside <code>untracked()</code>?
                        Because otherwise <code>&#64;if (r.hasValue())</code> could stay false
                        forever: nothing reactive changes, so no change detection cycle comes back
                        to ask again. A non-waking <code>peek()</code> is left as a follow-up.
                    </p>
                    <p class="aside">
                        Two implementations exist: a
                        <a
                            href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource"
                            rel="noopener"
                            >PR-ready fork</a
                        >
                        with the native option, tested with the repo's own suite (see Tests and
                        Implementation below), and a userland twin,
                        <a
                            href="https://gist.github.com/flo-dmtx/e8c9ff69bec58adf85e902eab9f7d900"
                            rel="noopener"
                            ><code>lazyRxResource</code></a
                        >, that can be copied until this lands. The demos on this page run the fork's
                        change itself: the project pins <code>&#64;angular/core</code> and applies
                        the same diff to the published bundle through patch-package, so every
                        figure executes the native
                        <code>rxResource(&#123; lazy: true &#125;)</code>. The
                        <strong>lazy: true / lazyRxResource</strong> toggle in each figure
                        switches the code tabs between the two syntaxes.
                    </p>
                </section>

                <section id="alternatives">
                    <h2>Alternatives considered</h2>
                    <p>
                        Before proposing a change to core, I tried to obtain these semantics from
                        userland, on top of the public API. To compare the attempts I wrote a
                        parameterized suite describing 39 observable behaviors of a lazy resource:
                        the sleeping rules above, plus everything a native resource must keep
                        doing once awake (statuses, errors, cancellation, SSR stability). Each
                        attempt is scored against that suite.
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
                                <td class="num">~370</td>
                                <td class="num good">39/39</td>
                            </tr>
                            <tr class="native-row">
                                <td>the native option (this proposal)</td>
                                <td class="num">~90</td>
                                <td class="num good">by construction</td>
                            </tr>
                        </tbody>
                    </table>
                    <p class="aside">
                        Gating the params on a "shown" flag is the workaround commonly found in
                        applications; it defers the first load but misses most of the sleeping
                        rules. I also tried driving core's private <code>loadEffect</code>: it
                        gets much closer, but stalls at 34/39 and depends on two private fields,
                        which is not something I would want anyone to ship. The only userland
                        shape that passes the whole suite is a reimplementation of the resource
                        machinery beside core, about 370 lines that have to follow core on every
                        release. The same semantics fits in about 90 lines inside
                        <code>ResourceImpl</code>, and that difference is why I am proposing the
                        option upstream. The reimplementation is published as a
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
                        <p class="case-tag">advanced</p>
                        <h3>One resource depending on another</h3>
                        <p>
                            <code>posts</code> needs the id that <code>user</code> will resolve.
                            Both stay asleep until one button reads the end of the chain; then
                            they wake in order, never in parallel: watch the two requests leave
                            one after the other. <code>computed()</code> composes the same way.
                        </p>
                        <app-figure
                            name="chain"
                            [ts]="snip.CHAIN_TS"
                            [tpl]="snip.CHAIN_TPL"
                        ></app-figure>
                    </div>

                    <div class="case">
                        <p class="case-tag">edge cases</p>
                        <h3>Writes and errors on a never-read resource</h3>
                        <p>
                            Nothing in either card reads its resource until you press
                            <em>read it</em>; that press is the first read. One card calls
                            <code>set()</code> and <code>reload()</code> before that: the network
                            stays empty, and the action log shows what each call returned. The
                            other card holds a loader that throws: it only gets to throw once
                            something reads it, and <code>set()</code> recovers from the error.
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
                            <span class="fact-num">91/91</span> on
                            <code>//packages/core/test/resource</code>: the new lazy suite, plus
                            every pre-existing spec passing unchanged
                        </li>
                        <li>
                            <span class="fact-num">76/76</span> on <code>rxjs-interop</code>,
                            including <code>rx_resource_spec</code>
                        </li>
                        <li>
                            <span class="fact-num">✓</span> public API goldens verified with the
                            repo's own tooling
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
                        One commit on
                        <a
                            href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource"
                            rel="noopener"
                            >flo-dmtx/angular</a
                        >: 129 lines in <code>resource.ts</code>, 15 in <code>api.ts</code>, a
                        500-line spec, and the documentation. It reads in four steps:
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
                        <h3>2 · When lazy, the load effect is not created</h3>
                        <p>
                            The boolean becomes a <code>loadStrategy</code> at the constructor's
                            single call site, since a positional bare <code>true</code> would say
                            nothing, and it defaults to eager for the internals that never pass it.
                            In lazy mode a reactive pull node is built instead of the load effect.
                        </p>
                        <code-block [code]="snip.CONSTRUCT_DIFF" [diff]="true"></code-block>
                    </div>

                    <div class="step">
                        <h3>3 · The pull node</h3>
                        <p>
                            It tracks the wrapped request, and recomputing is where the load
                            starts: on the first pull, then on params and reload changes.
                        </p>
                        <code-block [code]="snip.PULL_NODE_TS"></code-block>
                    </div>

                    <div class="step">
                        <h3>4 · Reading is the trigger</h3>
                        <p>
                            <code>value</code>, <code>status</code> and <code>error</code> pull
                            the node; every other signal derives from those.
                        </p>
                        <code-block [code]="snip.READS_DIFF" [diff]="true"></code-block>
                    </div>

                    <p>
                        Two supporting changes come with it: <code>set()</code> now reads the raw state, so a
                        write can never wake the resource; <code>destroy()</code> tears the pull
                        node down, so a destroyed resource can never load again. Until it lands,
                        the same semantics is available as one userland file: copy
                        <code>src/app/lazy-resource.ts</code> out of this project, or grab it from
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
                                href="https://github.com/flo-dmtx/angular/tree/feat/lazy-resource"
                                rel="noopener"
                                >branch <code>feat/lazy-resource</code></a
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
                                href="https://stackblitz.com/github/flo-dmtx/lazy-resource-playground"
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

        h2 {
            font-size: 1.25rem;
        }

        .aside {
            font-size: 0.875rem;
            color: var(--muted);
        }

        /* solution */

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
}

/** The `it()` names of resource_lazy_spec.ts, verbatim. */
const TESTS = [
    {
        name: "waking",
        specs: [
            "should not load at creation and should load on the first read",
            "should wake from a read of any of its signals",
            "should resolve during the waking read when the stream settles synchronously",
            "should return the defaultValue from the read that wakes it",
        ],
    },
    {
        name: "params",
        specs: [
            "should not load on params changes while unread, then should use the latest params",
            "should not reload when re-read with unchanged params",
            "should react to params changes after waking",
            "should keep updating a template that reads it when the params change",
            "should stay idle while the params are undefined and load once they are set",
            "should abort the in-flight load when the params change",
        ],
    },
    {
        name: "errors & stability",
        specs: [
            "should surface a rejected loader through error, status, hasValue and value",
            "should keep the application stable while unread",
        ],
    },
    {
        name: "writes",
        specs: [
            "should never load when set() is called before any read",
            "should not load when equal set() calls deduplicate before any read",
            "should replace a local value with a fresh load when the params change",
            "should not initiate a load from reload() before any read",
            "should defer the load requested by reload() to the next read",
        ],
    },
    {
        name: "destroy",
        specs: [
            "should leave a destroyed resource idle without ever loading",
            "should not load when the params change after destroy()",
            "should abort the in-flight load when destroyed after waking",
        ],
    },
    {
        name: "composition",
        specs: [
            "should stay asleep behind a computed until the computed itself is read",
            "should chain laziness through ctx.chain",
            "should propagate a chained child error to the lazy parent",
        ],
    },
    {
        name: "the eager path, unchanged",
        specs: [
            "should load eagerly when lazy is not set",
            "should load eagerly when lazy is explicitly false",
        ],
    },
];
